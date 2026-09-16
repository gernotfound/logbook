import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { DB } from '../../lib/db';
import { UserDataSchema } from '../../lib/schema';
import { hasUserData, mergeUserData } from '../../lib/merge';
import { useAppStore } from '../../store/useAppStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../../lib/catalog/catalogService';
import { replicateJournal } from '../../lib/sync/replicateJournal';
import { getResolvedDefaultUserData } from './defaultUserData';

type MigrateGuestAccountOptions = {
    user: User;
    guestData: UserData | null;
    policy: string;
    setUserData: (data: UserData) => void;
    setSyncing: (value: boolean) => void;
};

export async function migrateGuestAccount({
    user,
    guestData,
    policy,
    setUserData,
    setSyncing,
}: MigrateGuestAccountOptions): Promise<void> {
    try {
        setSyncing(true);
        const cloudPayload = await DB.loadCloudPayload({ allMonths: true });
        const cloudData = cloudPayload?.data || null;

        const cloudHasData = hasUserData(cloudData);
        const guestHasData = hasUserData(guestData);

        if (policy === 'skip') {
            if (cloudHasData) {
                const { hydrateLocal } = await import('../../lib/sync/localRepository');
                const owner = user.uid;
                const hydratedEnv = await hydrateLocal(owner, cloudData!, cloudPayload!.completeMonths, cloudPayload!.cloudDocuments, 'all');
                setUserData(hydratedEnv.data);
                useAppStore.getState().setLocalWorkout(hydratedEnv.data.activeWorkout || null);
            } else {
                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                const fallbackData = getResolvedDefaultUserData(catalog);
                const parsedFallback = UserDataSchema.parse(fallbackData) as unknown as UserData;
                const { hydrateLocal } = await import('../../lib/sync/localRepository');
                const hydratedEnv = await hydrateLocal(user.uid, cloudData || parsedFallback, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all');
                setUserData(hydratedEnv.data);
                useAppStore.getState().setLocalWorkout(null);
            }
        } else if (cloudHasData && !guestHasData) {
            const { hydrateLocal } = await import('../../lib/sync/localRepository');
            const hydratedEnv = await hydrateLocal(user.uid, cloudData!, cloudPayload!.completeMonths, cloudPayload!.cloudDocuments, 'all');
            setUserData(hydratedEnv.data);
            useAppStore.getState().setLocalWorkout(hydratedEnv.data.activeWorkout || null);
        } else if (guestHasData) {
            const { hydrateLocal, commitLocal, readLocal } = await import('../../lib/sync/localRepository');
            const hydratedEnv = await hydrateLocal(user.uid, cloudData!, cloudPayload!.completeMonths, cloudPayload!.cloudDocuments, 'all');
            const mergedData = mergeUserData(hydratedEnv.data, guestData);
            await commitLocal(user.uid, mergedData, hydratedEnv.data);

            const syncResult = await replicateJournal();
            if (syncResult.status === 'rejected' || syncResult.status === 'failed') {
                throw syncResult.error instanceof Error
                    ? syncResult.error
                    : new Error('Sincronizzazione della migrazione guest non riuscita', { cause: syncResult.error });
            }

            if (syncResult.status === 'local-pending') {
                const pendingEnv = await readLocal(user.uid);
                const pendingData = pendingEnv?.data ?? mergedData;
                setUserData(pendingData);
                useAppStore.getState().setLocalWorkout(pendingData.activeWorkout || null);
            } else {
                const resolvedPayload = await DB.loadCloudPayload();
                const resolvedData = resolvedPayload?.data || mergedData;
                const hydratedFinal = await hydrateLocal(user.uid, resolvedData, resolvedPayload?.completeMonths || [], resolvedPayload?.cloudDocuments);
                setUserData(hydratedFinal.data);
                useAppStore.getState().setLocalWorkout(hydratedFinal.data.activeWorkout || null);
            }
        } else {
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            const fallbackData = getResolvedDefaultUserData(catalog);
            const parsedFallback = UserDataSchema.parse(fallbackData) as unknown as UserData;
            const { hydrateLocal } = await import('../../lib/sync/localRepository');
            const hydratedEnv = await hydrateLocal(user.uid, cloudData || parsedFallback, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all');
            setUserData(hydratedEnv.data);
            useAppStore.getState().setLocalWorkout(hydratedEnv.data.activeWorkout || null);
        }
    } catch (error) {
        console.warn('Errore sincronizzazione iniziale post-link:', error);
        try {
            const { readLocal } = await import('../../lib/sync/localRepository');
            const preserved = await readLocal(user.uid);
            if (preserved) {
                setUserData(preserved.data);
                useAppStore.getState().setLocalWorkout(preserved.data.activeWorkout || null);
            } else if (guestData) {
                setUserData(guestData);
                useAppStore.getState().setLocalWorkout(guestData.activeWorkout || null);
            }
        } catch {
            if (guestData) {
                setUserData(guestData);
                useAppStore.getState().setLocalWorkout(guestData.activeWorkout || null);
            }
        }
    } finally {
        setSyncing(false);
    }
}
