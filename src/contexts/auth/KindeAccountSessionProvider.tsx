import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useKindeAccountSession } from './useKindeAccountSession';

type KindeAccountSession = ReturnType<typeof useKindeAccountSession>;

/**
 * Observes the Kinde browser session once per live React tree. The identity
 * is only a UI/presence witness: it must not install authenticatedIdentitySource,
 * create an account owner, unlock a vault or confer fitness permissions.
 */
export const KindeAccountSessionContext = createContext<KindeAccountSession | null>(null);

export function useSharedKindeAccountSession(): KindeAccountSession | null {
    return useContext(KindeAccountSessionContext);
}

export function KindeAccountSessionProvider({ children }: { children: ReactNode }) {
    const { isGuest } = useAuth();
    const session = useKindeAccountSession({
        guestArchivePresent: isGuest,
        identityOnly: true,
    });
    return (
        <KindeAccountSessionContext.Provider value={session}>
            {children}
        </KindeAccountSessionContext.Provider>
    );
}
