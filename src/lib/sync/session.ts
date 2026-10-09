import { auth } from '../firebase';
import { readBrowserValueStrict, writeBrowserValue } from './browserStorage';
import { userOwner } from './owner';
import { readAuthenticatedOwnerHint } from './authOwnerHint';

export { userOwner } from './owner';

export const GUEST_SESSION_KEY = 'logbook_guest_session_id_v1';
export const GUEST_REVOCATION_KEY = 'logbook_guest_revoked_v1';

let epoch = 0;
// Realm-bound: a suspended old tab cannot adopt a newer guest login merely by
// reading its shared localStorage. Explicit login is the only reactivation path.
let realmGuestSessionId: string | null | undefined;
function currentRealmGuestId(): string | null {
    if (realmGuestSessionId === undefined) realmGuestSessionId = readBrowserValueStrict(GUEST_SESSION_KEY);
    return realmGuestSessionId;
}

export function activateGuestSession(id: string): void {
    realmGuestSessionId = id;
    invalidateSession();
}

export function revokeGuestSession(): void {
    // Durable revocation must precede purge and reach every same-origin tab.
    const random = crypto.getRandomValues(new Uint8Array(16));
    writeBrowserValue(GUEST_REVOCATION_KEY, Array.from(random, byte => byte.toString(16).padStart(2, '0')).join(''));
    invalidateSession();
}

export function isActiveGuestSession(): boolean {
    try {
        return readBrowserValueStrict('logbook_is_guest') === 'true'
            && readBrowserValueStrict(GUEST_REVOCATION_KEY) === null
            && currentRealmGuestId() === readBrowserValueStrict(GUEST_SESSION_KEY);
    } catch {
        // A security boundary never interprets unreadable storage as permission.
        return false;
    }
}
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
export type SessionSnapshot = { owner: string; epoch: number; guestSessionId?: string | null };

export const captureSessionForOwner = (owner: string): SessionSnapshot => ({
    owner, epoch, ...(owner === 'guest' ? { guestSessionId: currentRealmGuestId() } : {}),
});
export const captureSession = (): SessionSnapshot => captureSessionForOwner(storageOwner());
export const isCurrentSession = (session: SessionSnapshot): boolean => {
    try {
        return session.epoch === epoch
            && session.owner === storageOwner()
            && (session.owner !== 'guest'
                || (session.guestSessionId === currentRealmGuestId() && isActiveGuestSession()));
    } catch {
        return false;
    }
};
export const invalidateSession = () => { epoch += 1; };
