import { type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useKindeAccountSession } from './useKindeAccountSession';
import { KindeAccountSessionContext } from './kindeAccountSessionContext';

/**
 * Observes the Kinde browser session once per live React tree. This presence
 * witness must not install an owner reader, unlock a vault or grant fitness.
 */
export function KindeAccountSessionProvider({ children }: { children: ReactNode }) {
    const { isGuest } = useAuth();
    const session = useKindeAccountSession({
        guestArchivePresent: isGuest,
        identityOnly: true,
        candidatePreparationEnabled: false,
    });
    return (
        <KindeAccountSessionContext.Provider value={session}>
            {children}
        </KindeAccountSessionContext.Provider>
    );
}
