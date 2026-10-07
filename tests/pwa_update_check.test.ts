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
});
