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
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
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

  it('does not navigate if worker activation cannot be confirmed', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeServiceWorker() as FakeServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
      worker.state = 'installed';
      worker.postMessage = vi.fn();
      const registration = { waiting: worker, installing: null } as unknown as ServiceWorkerRegistration;
      const reload = vi.fn();
      const result = applyPWAUpdate(fakeContainer(registration), reload, 80);
      await vi.advanceTimersByTimeAsync(80);
      await expect(result).rejects.toThrow('non confermata');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
      await vi.advanceTimersByTimeAsync(80);
      await expect(result).rejects.toThrow('Verifica aggiornamento');
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
