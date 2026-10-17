import { useCallback } from 'react';
import { auth, signOut } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { prepareForReload } from '../../lib/sync/reloadBarrier';
import { lockVault } from '../../lib/sync/secureArchiveSession';
import { userOwner } from '../../lib/sync/session';

type ContinuationDependencies = {
    isGuestActiveStrict: () => boolean;
    loginAsGuest: () => Promise<void>;
};

// A pending verification is not consent to purge authenticated data.
// Preserve its owner-scoped archive and migration intent across local handoff.
export function useUnverifiedLocalContinuation({
    isGuestActiveStrict, loginAsGuest,
}: ContinuationDependencies) {
    const continueUnverifiedLocally = useCallback(async () => {
        const user = auth.currentUser;
        if (!user || user.emailVerified !== false) {
            throw new Error('Nessuna verifica email in attesa.');
        }
        // Reconcile any in-memory edits and device-critical drafts before switching
        // owner; a failed durability check must leave the account session intact.
        const current = useAppStore.getState();
        if (current.userData !== null || current.localWorkout !== null) {
            await prepareForReload();
        }
        // Sign out without the authenticated purge path: local owner envelopes and
        // any guest migration intent must survive until an explicit verified login.
        await signOut(auth);
        lockVault(userOwner(user.uid));
        if (!isGuestActiveStrict()) {
            // Never seed a fresh guest from another authenticated user's in-memory data.
            // resetStore does not delete the authenticated IndexedDB envelope.
            useAppStore.getState().resetStore({ force: true });
            await loginAsGuest();
        }
    }, [isGuestActiveStrict, loginAsGuest]);

    return continueUnverifiedLocally;
}
