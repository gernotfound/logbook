import { useCallback } from 'react';
import { auth, signOut } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { captureAuthAttemptGuard } from '../../lib/auth/authAttemptGuard';
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
        const originalAttempt = captureAuthAttemptGuard(isGuestActiveStrict());
        const isCurrentContinuation = () => originalAttempt() && user.emailVerified === false;
        // Reconcile any in-memory edits and device-critical drafts before switching
        // owner; a failed durability check must leave the account session intact.
        const current = useAppStore.getState();
        if (current.userData !== null || current.localWorkout !== null) {
            try {
                await prepareForReload();
            } catch (error) {
                if (isCurrentContinuation()) throw error;
                return;
            }
        }
        if (!isCurrentContinuation()) return;
        // Sign out without the authenticated purge path: local owner envelopes and
        // any guest migration intent must survive until an explicit verified login.
        try {
            await signOut(auth);
        } catch (error) {
            if (isCurrentContinuation()) throw error;
            return;
        }
        // Sign-out changes its own Auth epoch. A later sign-in still owns the
        // page; never lock its vault or reset its data from this old callback.
        if (auth.currentUser !== null) return;
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
