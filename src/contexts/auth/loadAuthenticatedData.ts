import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { auth } from '../../lib/firebase';
import { DB } from '../../lib/db';
import { UserDataSchema } from '../../lib/schema';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';
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

const loadGenerationByOwner = new Map<string, number>();

export async function loadAuthenticatedData({
    user,
    isGuestActive,
    setUserData,
    setSyncing,
    setSaveError,
}: LoadAuthenticatedDataOptions): Promise<void> {
    if (!user) return;

    const session = captureSession();
    const expectedOwner = userOwner(user.uid);
    const generation = (loadGenerationByOwner.get(expectedOwner) ?? 0) + 1;
    loadGenerationByOwner.set(expectedOwner, generation);
    const isCurrent = () => session.owner === expectedOwner
        && isCurrentSession(session)
        && loadGenerationByOwner.get(expectedOwner) === generation
        && auth.currentUser?.uid === user.uid
        && !isGuestActive();

    if (!isCurrent()) return;

    const currentData = useAppStore.getState().userData;
    if (!currentData) setSyncing(true);

    try {
        const payload = await DB.loadCloudPayload();
        if (!isCurrent()) return;

        if (payload) {
            const cloudData = payload.data;
            try {
                const { hydrateLocal } = await import('../../lib/sync/localRepository');
                if (!isCurrent()) return;
                const hydratedEnv = await hydrateLocal(
                    user.uid,
                    cloudData,
                    payload.completeMonths,
                    payload.cloudDocuments,
                    'window',
                    isCurrent
                );
                if (!isCurrent()) return;
                setUserData(hydratedEnv.data);
            } catch (mergeError) {
                if (!isCurrent()) return;
                console.error('Zod parse failed during hydration merge, preserving local valid state:', mergeError);
            }
        }
    } catch (error: any) {
        if (!isCurrent()) return;
        console.warn('Errore caricamento dati in AuthContext (uso dati locali/offline):', error);
        if (error?.code === 'unavailable' || !navigator.onLine) {
            setSaveError('📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.');
        }
        const latestData = useAppStore.getState().userData;
        if (!latestData) {
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            if (!isCurrent()) return;
            const fallbackData = getResolvedDefaultUserData(catalog);
            if (!isCurrent()) return;
            setUserData(UserDataSchema.parse(fallbackData) as unknown as UserData);
        }
    } finally {
        if (isCurrent()) setSyncing(false);
    }
}
