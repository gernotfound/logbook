import { describe, expect, it, vi } from 'vitest';
import { checkForWaitingServiceWorker } from '../src/lib/pwaUpdate';

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
