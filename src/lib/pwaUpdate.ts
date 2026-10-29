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

type ActivationOptions = {
  signal?: AbortSignal;
  onActivationDelayed?: () => void;
};

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aggiornamento annullato.', 'AbortError');
}

function activateWaitingWorker(
  worker: ServiceWorker,
  container: ServiceWorkerContainer,
  timeoutMs: number,
  options: ActivationOptions,
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
      clearTimeout(slowTimer);
      worker.removeEventListener('statechange', onWorkerStateChange);
      container.removeEventListener('controllerchange', onControllerChange);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onWorkerStateChange = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') {
        finish(new Error('Il nuovo service worker è stato sostituito. Riprova.'));
      }
    };
    // A different registration can emit controllerchange. Only the targeted
    // worker becoming active or taking control authorizes the eventual reload.
    const onControllerChange = () => {
      if (container.controller === worker || worker.state === 'activated') finish();
    };
    const onAbort = () => finish(new DOMException('Aggiornamento annullato.', 'AbortError'));
    // Five seconds is a UX threshold, not proof of failed activation. Some
    // browsers activate later; retain listeners until success, replacement or
    // explicit cancellation rather than reporting failure before a real reload.
    const slowTimer = setTimeout(() => {
      if (!settled) options.onActivationDelayed?.();
    }, timeoutMs);
    worker.addEventListener('statechange', onWorkerStateChange);
    container.addEventListener('controllerchange', onControllerChange);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    onWorkerStateChange();
    onControllerChange();
    if (settled) return;
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
      onWorkerStateChange();
      onControllerChange();
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
  reload: () => void | Promise<void>,
  timeoutMs = DEFAULT_ACTIVATION_TIMEOUT_MS,
  options: ActivationOptions = {},
): Promise<void> {
  throwIfCancelled(options.signal);
  if (container && typeof container.getRegistration === 'function') {
    const registration = await boundedUpdateStep(container.getRegistration(), timeoutMs);
    if (registration) {
      if (!registration.waiting) {
        await boundedUpdateStep(checkForWaitingServiceWorker(registration, timeoutMs), timeoutMs);
      }
      throwIfCancelled(options.signal);
      if (registration.waiting) {
        await activateWaitingWorker(registration.waiting, container, timeoutMs, options);
      } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // A stale prompt with no installed replacement is not a reason to
        // reload an offline tab: the existing cached shell may be its only
        // working copy. Keep data in place and allow a later retry.
        throw new Error('Sei offline e la nuova versione non è ancora installata. Riprova quando torni online.');
      }
    }
  }
  throwIfCancelled(options.signal);
  await reload();
}
