const DEFAULT_UPDATE_SETTLE_TIMEOUT_MS = 5000;

function waitForWorkerStateChange(worker: ServiceWorker, timeoutMs: number): Promise<void> {
  if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('statechange', handleStateChange);
      resolve();
    };
    const handleStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });
}

/**
 * Ask the browser to check for a new service worker and wait for an installing
 * worker to reach a stable state before deciding whether an update is waiting.
 * ServiceWorkerRegistration.update() can resolve while the new worker is still
 * installing, so checking registration.waiting immediately can produce a false
 * "up to date" result.
 */
export async function checkForWaitingServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = DEFAULT_UPDATE_SETTLE_TIMEOUT_MS,
): Promise<boolean> {
  if (registration.waiting) return true;

  await registration.update();
  if (registration.waiting) return true;

  const candidate = registration.installing;
  if (!candidate) return false;

  await waitForWorkerStateChange(candidate, timeoutMs);
  return Boolean(registration.waiting);
}
