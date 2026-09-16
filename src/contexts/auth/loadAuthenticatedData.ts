import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { auth } from '../../lib/firebase';
import { DB } from '../../lib/db';
import { UserDataSchema } from '../../lib/schema';
import { useAppStore } from '../../store/useAppStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../../lib/catalog/catalogService';
import { getResolvedDefaultUserData } from './defaultUserData';

type LoadAuthenticatedDataOptions = {
    user: User;
    isGuestActive: () => boolean;
    setUserData: (data: UserData) => void;
    setSyncing: (value: boolean) => void;
    setSaveError: (value: string | null) => void;
};

export async function loadAuthenticatedData({
    user,
    isGuestActive,
    setUserData,
    setSyncing,
    setSaveError,
}: LoadAuthenticatedDataOptions): Promise<void> {
    if (!user) return;
    const currentData = useAppStore.getState().userData;
    if (!currentData) {
        setSyncing(true);
    }
    try {
        const payload = await DB.loadCloudPayload();

        // Discard a stale hydration after an auth/guest mode transition.
        if (auth.currentUser?.uid !== user.uid || isGuestActive()) {
            return;
        }

        if (payload) {
            const cloudData = payload.data;
            try {
                const { hydrateLocal } = await import('../../lib/sync/localRepository');
                const owner = user.uid;
                const hydratedEnv = await hydrateLocal(owner, cloudData, payload.completeMonths, payload.cloudDocuments);
                setUserData(hydratedEnv.data);
            } catch (mergeError) {
                console.error('Zod parse failed during hydration merge, preserving local valid state:', mergeError);
            }
        }
    } catch (error: any) {
        console.warn('Errore caricamento dati in AuthContext (uso dati locali/offline):', error);
        if (error?.code === 'unavailable' || !navigator.onLine) {
            setSaveError('📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.');
        }
        const latestData = useAppStore.getState().userData;
        if (!latestData) {
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            const fallbackData = getResolvedDefaultUserData(catalog);
            setUserData(UserDataSchema.parse(fallbackData) as unknown as UserData);
        }
    } finally {
        setSyncing(false);
    }
}
