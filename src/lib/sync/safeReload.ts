import { prepareForReload } from './reloadBarrier';
import { isCurrentSession } from './session';

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
