import { createContext, useContext } from 'react';
import type { useKindeAccountSession } from './useKindeAccountSession';

type KindeAccountSession = ReturnType<typeof useKindeAccountSession>;

/** Read-only observed session plus UI actions, not a fitness authorization. */
export const KindeAccountSessionContext = createContext<KindeAccountSession | null>(null);

export function useSharedKindeAccountSession(): KindeAccountSession | null {
    return useContext(KindeAccountSessionContext);
}
