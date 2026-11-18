import { findPendingAccountDeletion } from '../sync/accountGate';
import { readBrowserValueStrict } from '../sync/browserStorage';
import { isLocalPurgePending } from '../sync/localPurgeFence';
import { purgeOwnerLocalData } from './ownerLocalPurge';
import { assertPurgeIdentitySafe } from './ownerPurgeIdentityFence';

const GUEST = 'guest';

/**
 * The guest's physical purge is independent of any account identity SDK.
 * The same owner and account-deletion fences are checked under the vault lock;
 * an interrupted purge resumes without requiring ciphertext already removed.
 */
export function purgeGuestLocalData(): Promise<void> {
    if (isLocalPurgePending(GUEST)) {
        return purgeOwnerLocalData(GUEST, true, {
            preflight: async () => {},
            afterFence: async () => { assertPurgeIdentitySafe(GUEST, true); },
            assertStillSafe: () => assertPurgeIdentitySafe(GUEST, true),
        });
    }
    return purgeOwnerLocalData(GUEST, false, {
        preflight: async () => {
            assertPurgeIdentitySafe(GUEST, false);
            // A pending withdrawal is the only durable evidence of a decision
            // that cannot be discarded with an ordinary guest logout.
            const consent = readBrowserValueStrict('logbook:v2:guest:health-consent-withdrawal');
            if (consent !== null && consent !== 'withdrawn') {
                throw new Error('La revoca o la nuova accettazione dei dati salute non è ancora riconciliata. Per non perdere la richiesta, completa la verifica prima di uscire.');
            }
            // No active guest: a pending account deletion may still own shared
            // device drafts, so absent Auth is not permission to erase them.
            if (readBrowserValueStrict('logbook_is_guest') !== 'true' && findPendingAccountDeletion()) {
                throw new Error('Recupero cancellazione account in sospeso: impossibile azzerare i dati locali.');
            }
        },
        afterFence: async () => { assertPurgeIdentitySafe(GUEST, false); },
        assertStillSafe: () => assertPurgeIdentitySafe(GUEST, false),
    });
}
