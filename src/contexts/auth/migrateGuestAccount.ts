import type { User } from 'firebase/auth';
import type { SyncResult, UserData } from '../../types';
import { DB } from '../../lib/db';
import { UserDataSchema } from '../../lib/schema';
import { hasUserData, mergeUserData } from '../../lib/merge';
import { useAppStore } from '../../store/useAppStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../../lib/catalog/catalogService';
import { replicateJournal } from '../../lib/sync/replicateJournal';
import { getResolvedDefaultUserData } from './defaultUserData';

type GuestMigrationPolicy = 'merge' | 'skip';

type MigrateGuestAccountOptions = {
    user: User;
    guestData: UserData | null;
    policy: GuestMigrationPolicy;
    setUserData: (data: UserData) => void;
    setSyncing: (value: boolean) => void;
    onLocalReady: () => void;
};

export async function migrateGuestAccount({
    user,
    guestData,
    policy,
    setUserData,
    setSyncing,
    onLocalReady,
}: MigrateGuestAccountOptions): Promise<SyncResult> {
    let localReady = false;

    const markLocalReady = () => {
        localReady = true;
        onLocalReady();
    };

    const applyLocalData = (data: UserData) => {
        setUserData(data);
        useAppStore.getState().setLocalWorkout(data.activeWorkout || null);
    };

    const restoreAfterFailure = async () => {
        if (!localReady && guestData) {
            applyLocalData(guestData);
            return;
        }

        try {
            const { readLocal } = await import('../../lib/sync/localRepository');
            const preserved = await readLocal(user.uid);
            if (preserved) {
                applyLocalData(preserved.data);
                return;
            }
        } catch {
            // Best effort only: the original failure remains authoritative.
        }

        if (guestData) {
            applyLocalData(guestData);
        }
    };

    try {
        setSyncing(true);
        const cloudPayload = await DB.loadCloudPayload({ allMonths: true });
        const cloudData = cloudPayload?.data || null;

        const cloudHasData = hasUserData(cloudData);
        const guestHasData = hasUserData(guestData);

        if (policy === 'skip') {
            if (cloudHasData) {
                const { hydrateLocal } = await import('../../lib/sync/localRepository');
                const hydratedEnv = await hydrateLocal(
                    user.uid,
                    cloudData!,
                    cloudPayload!.completeMonths,
                    cloudPayload!.cloudDocuments,
                    'all'
                );
                markLocalReady();
                applyLocalData(hydratedEnv.data);
            } else {
                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                const fallbackData = getResolvedDefaultUserData(catalog);
                const parsedFallback = UserDataSchema.parse(fallbackData) as unknown as UserData;
                const { hydrateLocal } = await import('../../lib/sync/localRepository');
                const hydratedEnv = await hydrateLocal(
                    user.uid,
                    cloudData || parsedFallback,
                    cloudPayload?.completeMonths || [],
                    cloudPayload?.cloudDocuments,
                    'all'
                );
                markLocalReady();
                applyLocalData(hydratedEnv.data);
            }
            return { ok: true, status: 'synced' };
        }

        if (cloudHasData && !guestHasData) {
            const { hydrateLocal } = await import('../../lib/sync/localRepository');
            const hydratedEnv = await hydrateLocal(
                user.uid,
                cloudData!,
                cloudPayload!.completeMonths,
                cloudPayload!.cloudDocuments,
                'all'
            );
            markLocalReady();
            applyLocalData(hydratedEnv.data);
            return { ok: true, status: 'synced' };
        }

        if (guestHasData) {
            const { hydrateLocal, commitLocal, readLocal } = await import('../../lib/sync/localRepository');
            const hydratedEnv = await hydrateLocal(
                user.uid,
                cloudData!,
                cloudPayload!.completeMonths,
                cloudPayload!.cloudDocuments,
                'all'
            );
            const mergedData = mergeUserData(hydratedEnv.data, guestData);
            await commitLocal(user.uid, mergedData, hydratedEnv.data);

            // The authenticated envelope is now durable. Only now may AuthContext
            // retire the guest recovery marker and let replication target this UID.
            markLocalReady();

            const syncResult = await replicateJournal();

            if (syncResult.status === 'local-pending') {
                const pendingEnv = await readLocal(user.uid);
                applyLocalData(pendingEnv?.data ?? mergedData);
                return syncResult;
            }

            if (syncResult.status === 'rejected' || syncResult.status === 'failed') {
                const preservedEnv = await readLocal(user.uid);
                applyLocalData(preservedEnv?.data ?? mergedData);
                return syncResult;
            }

            const resolvedPayload = await DB.loadCloudPayload();
            const resolvedData = resolvedPayload?.data || mergedData;
            const hydratedFinal = await hydrateLocal(
                user.uid,
                resolvedData,
                resolvedPayload?.completeMonths || [],
                resolvedPayload?.cloudDocuments
            );
            applyLocalData(hydratedFinal.data);
            return syncResult;
        }

        const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
        const fallbackData = getResolvedDefaultUserData(catalog);
        const parsedFallback = UserDataSchema.parse(fallbackData) as unknown as UserData;
        const { hydrateLocal } = await import('../../lib/sync/localRepository');
        const hydratedEnv = await hydrateLocal(
            user.uid,
            cloudData || parsedFallback,
            cloudPayload?.completeMonths || [],
            cloudPayload?.cloudDocuments,
            'all'
        );
        markLocalReady();
        applyLocalData(hydratedEnv.data);
        return { ok: true, status: 'synced' };
    } catch (error) {
        console.warn('Errore sincronizzazione iniziale post-link:', error);
        await restoreAfterFailure();

        if (!localReady) {
            throw error;
        }

        return { ok: false, status: 'failed', error };
    } finally {
        setSyncing(false);
    }
}
