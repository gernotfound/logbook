import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from '../sync/browserStorage';

/**
 * Recovery is an owner-scoped handoff: a different account must never replace
 * or consume the proof for this UID, even across concurrently running tabs.
 */
export const guestMigrationSyncRecoveryKey = (uid: string): string =>
    `logbook:v2:user:${uid}:guest-migration-sync-recovery`;

export function readGuestMigrationSyncRecovery(uid: string): boolean {
    const stored = readBrowserValueStrict(guestMigrationSyncRecoveryKey(uid));
    if (stored !== null && stored !== uid) {
        throw new Error('Prova di recupero migrazione account non valida.');
    }
    return stored === uid;
}

export function markGuestMigrationSyncRecovery(uid: string): void {
    writeBrowserValue(guestMigrationSyncRecoveryKey(uid), uid);
}

export function clearGuestMigrationSyncRecovery(uid: string): void {
    if (readGuestMigrationSyncRecovery(uid)) {
        removeBrowserValue(guestMigrationSyncRecoveryKey(uid));
    }
}
