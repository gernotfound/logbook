import type { Dispatch, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { beginHealthConsentVerification } from '../../lib/healthConsent';
import { rememberAuthenticatedOwner } from '../../lib/sync/authOwnerHint';
import { tryRemoveBrowserValue } from '../../lib/sync/browserStorage';
import { userOwner } from '../../lib/sync/session';
import { useAppStore } from '../../store/useAppStore';

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type BootstrapGateDependencies = {
    awaitingRedirectKey: string;
    isGuestActiveStrict: () => boolean;
    setCurrentUser: Dispatch<SetStateAction<User | null>>;
    setEmailVerificationRequired: Dispatch<SetStateAction<boolean>>;
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    setLoading: Dispatch<SetStateAction<boolean>>;
};

// Synchronous fail-closed boundary preceding vault unlock and consent refresh.
export function guardAuthenticatedBootstrap(
    user: User,
    { awaitingRedirectKey, isGuestActiveStrict, setCurrentUser,
      setEmailVerificationRequired, setGuestMigrationStatus, setLoading }: BootstrapGateDependencies,
): boolean {
    if (user.emailVerified === false) {
        // Account creation signs users in before they verify their inbox.
        // Do not claim an owner, hydrate cloud data or transfer guest data
        // until verification is complete; preserve the guest migration intent.
        const current = useAppStore.getState();
        if (!isGuestActiveStrict() && (current.userData !== null || current.localWorkout !== null) && current.dataOwner !== userOwner(user.uid)) {
            // Discard only the stale in-memory owner; retain both IndexedDB archives.
            useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
        }
        setGuestMigrationStatus('idle');
        setCurrentUser(user);
        setEmailVerificationRequired(true);
        setLoading(false);
        return true;
    }
    {
        beginHealthConsentVerification(user.uid);
        tryRemoveBrowserValue(awaitingRedirectKey);
        const expectedOwner = userOwner(user.uid);
        const current = useAppStore.getState();
        const guestActiveBeforeAuth = isGuestActiveStrict();
        if (!guestActiveBeforeAuth && (current.userData !== null || current.localWorkout !== null) && current.dataOwner !== expectedOwner) {
            useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
        }
        try {
            rememberAuthenticatedOwner(user.uid);
        } catch (error) {
            console.error('Owner autenticato locale non persistibile:', error);
            useAppStore.setState({
                userData: null,
                dataOwner: null,
                localWorkout: null,
                localPersistenceBlocked: true,
                syncHealth: 'failed',
                saveError: 'Archivio del dispositivo non disponibile. Riprova prima di continuare.',
            });
            setCurrentUser(user);
            setLoading(false);
            return true;
        }
    }
    return false;
}
