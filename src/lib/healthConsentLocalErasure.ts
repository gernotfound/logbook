import { del, get } from 'idb-keyval';
import { isAccountDeletionPending } from './sync/accountGate';
import { readHealthConsentRevocation } from './healthConsentRevocation';
import { storageOwner, GUEST_SESSION_KEY } from './sync/session';
import { readBrowserValueStrict } from './sync/browserStorage';

const MAX_PASSES = 6;
const legacyBusinessKeys = [
    'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start',
    'logbook_timer_accumulated', 'draft_measurement', 'draft_exercise',
    'draft_routine', 'logbook_telemetry_queue', 'guest_migration_intent_v1',
    'guest_migration_policy',
] as const;
const idbBusinessKeys = (owner: string) => [
    'logbook:v2:' + owner,
    'logbook_cached_user_data',
    'pending_sync_token',
    'pending_sync_payload',
    'sync_failed',
];

/**
 * Purges owner-scoped tracking data on the active device after an explicit
 * withdrawal. The durable withdrawal fence, auth session, and account-deletion
 * recovery receipt are deliberately not part of the business-data purge.
 *
 * Re-running after an interrupted operation is safe. Each launch/other tab must
 * repeat the check: an already-running IndexedDB transaction in a stale tab
 * might finish after an earlier sweep.
 */
export async function eraseWithdrawnLocalTracking(owner: string): Promise<void> {
    if (owner !== 'guest' && !/^user:[^/]+$/.test(owner)) throw new Error('Owner non valido.');
    const initialGuestId = owner === 'guest' ? readBrowserValueStrict(GUEST_SESSION_KEY) : null;

    const assertAllowed = () => {
        if (storageOwner() !== owner) throw new Error('Sessione cambiata: pulizia locale interrotta.');
        if (owner === 'guest' && readBrowserValueStrict(GUEST_SESSION_KEY) !== initialGuestId) {
            throw new Error('Sessione ospite cambiata: pulizia interrotta.');
        }
        if (readHealthConsentRevocation(owner) === 'none') throw new Error('Revoca non registrata: pulizia impedita.');
        if (isAccountDeletionPending(owner)) throw new Error('Eliminazione account già in corso: recupero conservato.');
    };

    const privatePrefix = 'logbook:v2:' + owner + ':';
    const preserved = new Set([
        privatePrefix + 'health-consent-revocation-v1',
        privatePrefix + 'account-deletion',
    ]);
    const businessKeys = () => {
        const keys = new Set<string>();
        for (const key of legacyBusinessKeys) {
            if (localStorage.getItem(key) !== null) keys.add(key);
        }
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(privatePrefix) && !preserved.has(key)) keys.add(key);
        }
        return keys;
    };

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        assertAllowed();
        for (const key of idbBusinessKeys(owner)) {
            assertAllowed();
            await del(key);
        }
        for (const key of businessKeys()) {
            assertAllowed();
            localStorage.removeItem(key);
        }
        assertAllowed();
        let idbEmpty = true;
        for (const key of idbBusinessKeys(owner)) {
            assertAllowed();
            if ((await get(key)) !== undefined) idbEmpty = false;
        }
        if (idbEmpty && businessKeys().size === 0) return;
    }
    throw new Error('Pulizia locale incompleta: i dati residui richiedono un nuovo tentativo.');
}
