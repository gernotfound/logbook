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

const DEFAULT_ACTIVATION_TIMEOUT_MS = 5000;

function boundedUpdateStep<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Verifica aggiornamento PWA non disponibile. Riprova.')), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

function activateWaitingWorker(
  worker: ServiceWorker,
  container: ServiceWorkerContainer,
  timeoutMs: number,
): Promise<void> {
  if (worker.state === 'redundant') {
    return Promise.reject(new Error('Aggiornamento PWA non più disponibile. Riprova.'));
  }
  if (worker.state === 'activated') return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeEventListener('statechange', onWorkerStateChange);
      container.removeEventListener('controllerchange', onControllerChange);
      if (error) reject(error);
      else resolve();
    };
    const onWorkerStateChange = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') {
        finish(new Error('Il nuovo service worker è stato sostituito. Riprova.'));
      }
    };
    const onControllerChange = () => finish();
    const timeout = setTimeout(
      () => finish(new Error('Attivazione della nuova versione non confermata. Riprova.')),
      timeoutMs,
    );
    worker.addEventListener('statechange', onWorkerStateChange);
    container.addEventListener('controllerchange', onControllerChange);
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
      onWorkerStateChange();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Attivazione PWA non disponibile.'));
    }
  });
}

/**
 * A manually discovered waiting worker does not necessarily trigger Workbox's
 * internal "waiting" event. In that case updateServiceWorker() can resolve
 * without scheduling a page reload. Activate the observed registration directly
 * and reload after confirmed activation. If the banner is stale and no worker
 * is waiting, refresh the app shell after the caller's durable reload barrier.
 *
 * Only the caller decides whether reload is safe; this helper NEVER clears
 * browser storage or bypasses the owner-bound persistence barrier.
 */
export async function applyPWAUpdate(
  container: ServiceWorkerContainer | undefined,
  reload: () => void,
  timeoutMs = DEFAULT_ACTIVATION_TIMEOUT_MS,
): Promise<void> {
  if (container && typeof container.getRegistration === 'function') {
    const registration = await boundedUpdateStep(container.getRegistration(), timeoutMs);
    if (registration) {
      if (!registration.waiting) {
        await boundedUpdateStep(checkForWaitingServiceWorker(registration, timeoutMs), timeoutMs);
      }
      if (registration.waiting) {
        await activateWaitingWorker(registration.waiting, container, timeoutMs);
      }
    }
  }
  reload();
}
