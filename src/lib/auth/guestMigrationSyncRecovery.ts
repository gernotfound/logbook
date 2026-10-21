import { readBrowserValueStrict, removeBrowserValue, writeBrowserJson } from '../sync/browserStorage';
import { GUEST_SESSION_KEY } from '../sync/sessionKeys';

// Both the UID and the precise guest generation belong to this handoff.
// The random attempt id prevents a stale retry for the same UID from
// clearing a newer handoff after an asynchronous journal flush.
export type GuestMigrationSyncWitness = {
    version: 1;
    uid: string;
    guestSessionId: string | null;
    id: string;
};

export const guestMigrationSyncRecoveryKey = (uid: string): string =>
    `logbook:v2:user:${uid}:guest-migration-sync-recovery`;

export function readGuestMigrationSyncWitness(uid: string): GuestMigrationSyncWitness | null {
    const raw = readBrowserValueStrict(guestMigrationSyncRecoveryKey(uid));
    if (raw === null) return null;
    let value: Partial<GuestMigrationSyncWitness>;
    try {
        value = JSON.parse(raw) as Partial<GuestMigrationSyncWitness>;
    } catch {
        throw new Error('Prova di recupero migrazione account non valida.');
    }
    if (value.version !== 1 || value.uid !== uid
        || typeof value.id !== 'string' || !value.id
        || !(value.guestSessionId === null || (typeof value.guestSessionId === 'string' && value.guestSessionId))) {
        throw new Error('Prova di recupero migrazione account non valida.');
    }
    return value as GuestMigrationSyncWitness;
}

export function readGuestMigrationSyncRecovery(uid: string): boolean {
    return readGuestMigrationSyncWitness(uid) !== null;
}

export function markGuestMigrationSyncRecovery(uid: string): string {
    const sessionId = readBrowserValueStrict(GUEST_SESSION_KEY);
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    writeBrowserJson(guestMigrationSyncRecoveryKey(uid), {
        version: 1, uid, guestSessionId: sessionId, id,
    } satisfies GuestMigrationSyncWitness);
    return id;
}

// Call only while holding the guest lifecycle lock; the expected id must
// be captured before any asynchronous replication. An unknown/new witness
// cannot be consumed by a previous retry, even for the same account.
export function clearGuestMigrationSyncRecovery(uid: string, expectedId: string): void {
    const current = readGuestMigrationSyncWitness(uid);
    if (!current) return;
    if (current.id !== expectedId) {
        throw new Error('La prova di recupero è stata sostituita da una migrazione successiva.');
    }
    removeBrowserValue(guestMigrationSyncRecoveryKey(uid));
}
