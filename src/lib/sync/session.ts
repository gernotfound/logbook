import { auth } from '../firebase';
import { readBrowserValueStrict } from './browserStorage';
import { userOwner } from './owner';
import { readAuthenticatedOwnerHint } from './authOwnerHint';

export { userOwner } from './owner';

let epoch = 0;
export function storageOwner(): string {
    const guest = readBrowserValueStrict('logbook_is_guest') === 'true';
    const recoveryUid = readBrowserValueStrict('logbook_guest_migration_sync_recovery');

    const uid = auth.currentUser?.uid;
    // Once the authenticated envelope is durable, the recovery marker is the
    // authoritative owner handoff. This prevents store hydration during crash
    // recovery from persisting authenticated data back into the guest archive.
    if (uid && recoveryUid === uid) return userOwner(uid);
    if (guest) return 'guest';
    if (uid) return userOwner(uid);
    // During authenticated cold boot Firebase Auth may still be refreshing over the
    // network. Keep the same locally fenced owner used by main.tsx so early offline
    // mutations cannot fall through into the guest envelope.
    return readAuthenticatedOwnerHint() ?? 'guest';
}
export type SessionSnapshot = { owner: string; epoch: number };

export const captureSessionForOwner = (owner: string): SessionSnapshot => ({ owner, epoch });
export const captureSession = (): SessionSnapshot => captureSessionForOwner(storageOwner());
export const isCurrentSession = (session: SessionSnapshot) => session.epoch === epoch && session.owner === storageOwner();
export const invalidateSession = () => { epoch += 1; };
