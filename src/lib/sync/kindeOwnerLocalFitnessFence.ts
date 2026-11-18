import { readBrowserValueStrict } from './browserStorage';
import { isAccountDeletionPending } from './accountGate';

/**
 * Local negative evidence fences fitness even when a previous server response
 * still reports active consent. Pending revocation/deletion cannot be
 * overridden by a delayed authenticated reply or by a re-login to the same UID.
 * Rights and erasure use separate paths; this is a fitness-only predicate.
 */
export function isKindeAccountLocalFitnessClear(owner: string, consentRevision: number): boolean {
    try {
        if (!owner.startsWith('user:') || !Number.isSafeInteger(consentRevision)
            || consentRevision < 1 || isAccountDeletionPending(owner)) return false;
        const guest = readBrowserValueStrict('logbook_is_guest');
        if (guest !== null && guest !== 'false') return false;
        if (readBrowserValueStrict(`logbook:v2:${owner}:health-consent-withdrawal`) !== null) {
            return false;
        }
        const generation = readBrowserValueStrict(`logbook:v2:${owner}:health-consent-generation`);
        return generation === null || generation === String(consentRevision);
    } catch {
        return false;
    }
}
