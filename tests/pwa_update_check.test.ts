import { describe, expect, it, vi } from 'vitest';
import { applyPWAUpdate, checkForWaitingServiceWorker } from '../src/lib/pwaUpdate';

class FakeServiceWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
}

describe('PWA update settling', () => {
  it('waits for an installing worker before deciding that an update is waiting', async () => {
    const worker = new FakeServiceWorker();
    const registration = {
      waiting: null,
      installing: null,
      update: vi.fn(async () => {
        (registration as any).installing = worker;
        queueMicrotask(() => {
          (registration as any).waiting = worker;
          worker.state = 'installed';
          worker.dispatchEvent(new Event('statechange'));
        });
        return registration;
      }),
    } as unknown as ServiceWorkerRegistration;

    await expect(checkForWaitingServiceWorker(registration, 100)).resolves.toBe(true);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('returns false when the update check produces no installing or waiting worker', async () => {
    const registration = {
      waiting: null,
      installing: null,
      update: vi.fn(async () => registration),
    } as unknown as ServiceWorkerRegistration;

    await expect(checkForWaitingServiceWorker(registration, 10)).resolves.toBe(false);
  });

  it('does not trigger a redundant update when a worker is already waiting', async () => {
    const registration = {
      waiting: new FakeServiceWorker(),
      installing: null,
      update: vi.fn(),
    } as unknown as ServiceWorkerRegistration;

    await expect(checkForWaitingServiceWorker(registration, 10)).resolves.toBe(true);
    expect(registration.update).not.toHaveBeenCalled();
  });
  it('returns false when an installing worker becomes redundant without waiting', async () => {
    const worker = new FakeServiceWorker();
    const registration = {
      waiting: null,
      installing: worker,
      update: vi.fn(async () => registration),
    } as unknown as ServiceWorkerRegistration;
    const check = checkForWaitingServiceWorker(registration, 100);
    await Promise.resolve();
    worker.state = 'redundant';
    worker.dispatchEvent(new Event('statechange'));
    await expect(check).resolves.toBe(false);
    expect(registration.update).toHaveBeenCalledOnce();
  });

  it('settles a stalled installation at the timeout rather than hanging the update screen', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeServiceWorker();
      const registration = {
        waiting: null,
        installing: worker,
        update: vi.fn(async () => registration),
      } as unknown as ServiceWorkerRegistration;

      const check = checkForWaitingServiceWorker(registration, 50);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      await expect(check).resolves.toBe(false);
      expect(registration.update).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a service-worker update rejection to the caller', async () => {
    const failure = new Error('network unavailable');
    const registration = {
      waiting: null,
      installing: null,
      update: vi.fn().mockRejectedValue(failure),
    } as unknown as ServiceWorkerRegistration;
    await expect(checkForWaitingServiceWorker(registration, 50)).rejects.toBe(failure);
  });

});

describe('PWA update activation and navigation', () => {
  function fakeContainer(registration: ServiceWorkerRegistration) {
    const container = new EventTarget() as ServiceWorkerContainer & EventTarget;
    Object.defineProperty(container, 'getRegistration', {
      value: vi.fn(async () => registration), configurable: true,
    });
    return container;
  }

  it('activates a waiting worker discovered outside Workbox and reloads only after confirmation', async () => {
    const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
    worker.state = 'installed';
    worker.postMessage = vi.fn();
    const registration = { waiting: worker, installing: null, update: vi.fn() } as unknown as ServiceWorkerRegistration;
    const container = fakeContainer(registration);
    const reload = vi.fn();
    const update = applyPWAUpdate(container, reload, 1000);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
    expect(reload).not.toHaveBeenCalled();
    worker.state = 'activated';
    worker.dispatchEvent(new Event('statechange'));
    await update;
    expect(reload).toHaveBeenCalledOnce();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('handles a stale manual prompt when no worker is waiting by safely reloading the shell', async () => {
    const registration = { waiting: null, installing: null, update: vi.fn(async () => registration) } as unknown as ServiceWorkerRegistration;
    const reload = vi.fn();
    await applyPWAUpdate(fakeContainer(registration), reload);
    expect(registration.update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('waits for an installing worker to become waiting before activating', async () => {
    const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
    worker.postMessage = vi.fn();
    const registration = {
      waiting: null as ServiceWorker | null,
      installing: worker,
      update: vi.fn(async () => registration),
    } as unknown as ServiceWorkerRegistration;
    const reload = vi.fn();
    const apply = applyPWAUpdate(fakeContainer(registration), reload, 1000);
    await Promise.resolve();
    await Promise.resolve();
    (registration as any).waiting = worker;
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    expect(reload).not.toHaveBeenCalled();
    worker.state = 'activated';
    worker.dispatchEvent(new Event('statechange'));
    await apply;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not mistake an unrelated controllerchange for target worker activation', async () => {
    const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
    worker.state = 'installed';
    worker.postMessage = vi.fn();
    const anotherWorker = new FakeServiceWorker();
    const registration = { waiting: worker, installing: null } as unknown as ServiceWorkerRegistration;
    const container = fakeContainer(registration);
    Object.defineProperty(container, 'controller', { value: anotherWorker, configurable: true });
    const reload = vi.fn();
    const result = applyPWAUpdate(container, reload, 1000);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(container, 'controller', { value: worker, configurable: true });
    container.dispatchEvent(new Event('controllerchange'));
    await result;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('preserves offline tab when a stale update notice has no waiting worker', async () => {
    const registration = { waiting: null, installing: null, update: vi.fn(async () => registration) } as unknown as ServiceWorkerRegistration;
    const container = fakeContainer(registration);
    const reload = vi.fn();
    const online = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await expect(applyPWAUpdate(container, reload)).rejects.toThrow('Sei offline');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      if (online) Object.defineProperty(navigator, 'onLine', online);
      else Reflect.deleteProperty(navigator, 'onLine');
    }
  });

  it('keeps waiting after the slow-activation notice and reloads only when that worker activates', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
      worker.state = 'installed';
      worker.postMessage = vi.fn();
      const registration = { waiting: worker, installing: null } as unknown as ServiceWorkerRegistration;
      const reload = vi.fn();
      const onActivationDelayed = vi.fn();
      const result = applyPWAUpdate(fakeContainer(registration), reload, 80, { onActivationDelayed });
      await vi.advanceTimersByTimeAsync(80);
      expect(onActivationDelayed).toHaveBeenCalledOnce();
      expect(reload).not.toHaveBeenCalled();
      worker.state = 'activated';
      worker.dispatchEvent(new Event('statechange'));
      await result;
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an unconfirmed activation without reloading if the worker activates later', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
      worker.state = 'installed';
      worker.postMessage = vi.fn();
      const registration = { waiting: worker } as unknown as ServiceWorkerRegistration;
      const reload = vi.fn();
      const abort = new AbortController();
      const onActivationDelayed = vi.fn();
      const result = applyPWAUpdate(fakeContainer(registration), reload, 80, {
        signal: abort.signal, onActivationDelayed,
      });
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(80);
      expect(onActivationDelayed).toHaveBeenCalledOnce();
      abort.abort();
      await rejected;
      worker.state = 'activated';
      worker.dispatchEvent(new Event('statechange'));
      await vi.advanceTimersByTimeAsync(100);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects worker replacement and failed skipWaiting without navigating', async () => {
    const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
    worker.state = 'installed';
    worker.postMessage = vi.fn();
    const registration = { waiting: worker } as unknown as ServiceWorkerRegistration;
    const reload = vi.fn();
    const result = applyPWAUpdate(fakeContainer(registration), reload, 100);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    worker.state = 'redundant';
    worker.dispatchEvent(new Event('statechange'));
    await expect(result).rejects.toThrow('sostituito');
    expect(reload).not.toHaveBeenCalled();

    const failingWorker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
    failingWorker.state = 'installed';
    failingWorker.postMessage = vi.fn(() => { throw new Error('postMessage blocked'); });
    const failingRegistration = { waiting: failingWorker } as unknown as ServiceWorkerRegistration;
    await expect(applyPWAUpdate(fakeContainer(failingRegistration), reload, 100))
      .rejects.toThrow('postMessage blocked');
    expect(reload).not.toHaveBeenCalled();
  });

  it('awaits the final reload barrier and propagates its failure', async () => {
    const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
    worker.state = 'activated';
    worker.postMessage = vi.fn();
    const registration = { waiting: worker } as unknown as ServiceWorkerRegistration;
    const reload = vi.fn(async () => { throw new Error('data changed during activation'); });
    await expect(applyPWAUpdate(fakeContainer(registration), reload)).rejects.toThrow('data changed');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('fails visibly when the browser cannot resolve its registration', async () => {
    vi.useFakeTimers();
    try {
      const container = new EventTarget() as ServiceWorkerContainer;
      Object.defineProperty(container, 'getRegistration', {
        value: vi.fn(() => new Promise(() => {})),
      });
      const reload = vi.fn();
      const result = applyPWAUpdate(container, reload, 80);
      const rejection = expect(result).rejects.toThrow('Verifica aggiornamento');
      await vi.advanceTimersByTimeAsync(80);
      await rejection;
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to a protected reload when no service worker is supported', async () => {
    const reload = vi.fn();
    await applyPWAUpdate(undefined, reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});
