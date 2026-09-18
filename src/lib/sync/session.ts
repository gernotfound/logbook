import { auth } from '../firebase';
import { userOwner } from './owner';

export { userOwner, normalizeStorageOwner } from './owner';

let epoch = 0;
export function storageOwner(): string {
    let guest = false;
    let recoveryUid: string | null = null;
    try {
        guest = localStorage.getItem('logbook_is_guest') === 'true';
        recoveryUid = localStorage.getItem('logbook_guest_migration_sync_recovery');
    } catch { /* No local ownership markers available. */ }

    const uid = auth.currentUser?.uid;
    // Once the authenticated envelope is durable, the recovery marker is the
    // authoritative owner handoff. This prevents store hydration during crash
    // recovery from persisting authenticated data back into the guest archive.
    if (uid && recoveryUid === uid) return userOwner(uid);
    return !guest && uid ? userOwner(uid) : 'guest';
}
export const captureSession = () => ({ owner: storageOwner(), epoch });
export const isCurrentSession = (session: ReturnType<typeof captureSession>) => session.epoch === epoch && session.owner === storageOwner();
export const invalidateSession = () => { epoch += 1; };
