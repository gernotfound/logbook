import { prepareForReload, prepareForRequiredUpdateReload } from './reloadBarrier';
import { isCurrentSession } from './session';

const REQUIRED_UPDATE_SW_TIMEOUT_MS = 3000;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function refreshServiceWorkerForRequiredUpdate(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
        const registration = await Promise.race([
            navigator.serviceWorker.getRegistration(),
            delay(REQUIRED_UPDATE_SW_TIMEOUT_MS).then(() => undefined),
        ]);
        if (!registration) return;

        await Promise.race([
            registration.update().then(() => undefined),
            delay(REQUIRED_UPDATE_SW_TIMEOUT_MS),
        ]);

        const waiting = registration.waiting;
        if (!waiting) return;

        const controllerChanged = navigator.serviceWorker.controller
            ? new Promise<void>(resolve => {
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
            })
            : Promise.resolve();

        waiting.postMessage({ type: 'SKIP_WAITING' });
        await Promise.race([controllerChanged, delay(REQUIRED_UPDATE_SW_TIMEOUT_MS)]);
    } catch {
        // The update check is best-effort. A navigation reload still gives the browser
        // a chance to refresh the app shell when connectivity is available.
    }
}

/**
 * Performs a hard browser reload only after the current session has been
 * durably reconciled with the local IndexedDB envelope and synchronous
 * device-critical state.
 *
 * The reload callback is injectable so the safety contract can be tested
 * without mutating jsdom's Location object.
 */
export async function safeHardReload(reload: () => void = () => window.location.reload()): Promise<void> {
    const session = await prepareForReload();
    if (!isCurrentSession(session)) {
        throw new Error('Sessione cambiata. Ripeti l’operazione.');
    }
    reload();
}

export async function requiredUpdateHardReload(reload: () => void = () => window.location.reload()): Promise<void> {
    // A future persisted schema cannot be parsed safely by the normal reload barrier.
    // Preserve only the owner-scoped device-critical workout snapshot, then attempt to
    // activate a waiting service worker before reloading into the newer application.
    const session = prepareForRequiredUpdateReload();
    await refreshServiceWorkerForRequiredUpdate();
    if (!isCurrentSession(session)) {
        throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    }
    reload();
}
