import { authenticatedIdentitySource } from '../sync/authenticatedIdentitySource';
import { readAuthenticatedOwnerHint } from '../sync/authOwnerHint';
import { readBrowserValueStrict } from '../sync/browserStorage';
import { GUEST_REVOCATION_KEY } from '../sync/session';

/**
 * Never erase an owner archive while another authenticated principal or an
 * active guest generation may own shared device state. The current provider's
 * identity source is the only synchronous UID witness; a local owner hint is
 * a separate conservative fence, not a session credential.
 *
 * This guard is repeated under the storage lock and after asynchronous purge
 * operations. A corrupt identity reader or unreadable storage must fail closed.
 */
export function assertPurgeIdentitySafe(owner: string, resuming: boolean): void {
    const guestActive = readBrowserValueStrict('logbook_is_guest') === 'true';
    const activeUid = authenticatedIdentitySource.readUid();
    const ownerHint = readAuthenticatedOwnerHint();
    const competingIdentity = owner === 'guest'
        ? Boolean(activeUid || ownerHint || (resuming && guestActive
            && readBrowserValueStrict(GUEST_REVOCATION_KEY) === null))
        : guestActive || Boolean((activeUid && owner !== 'user:' + activeUid)
            || (ownerHint && ownerHint !== owner));
    if (competingIdentity) {
        throw new Error('Un altro account o una sessione ospite è diventata attiva. La pulizia locale resta sospesa.');
    }
}
