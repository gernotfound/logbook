import type { User } from 'firebase/auth';
import type { SyncResult, UserData } from '../../types';
import { DB } from '../../lib/db';
import { UserDataSchema } from '../../lib/schema';
import { hasUserData, mergeUserData } from '../../lib/merge';
import { useAppStore } from '../../store/useAppStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../../lib/catalog/catalogService';
import { replicateJournal } from '../../lib/sync/replicateJournal';
import { userOwner } from '../../lib/sync/session';
import { getResolvedDefaultUserData } from './defaultUserData';

type GuestMigrationPolicy = 'merge' | 'skip';

class StaleGuestMigrationError extends Error {
    constructor() {
        super('Migrazione guest invalidata da un cambio sessione');
        this.name = 'StaleGuestMigrationError';
    }
}

type MigrateGuestAccountOptions = {
    user: User;
    guestData: UserData | null;
    policy: GuestMigrationPolicy;
    setUserData: (data: UserData) => void;
    setSyncing: (value: boolean) => void;
    onLocalReady: () => void;
    isCurrent: () => boolean;
};

export async function migrateGuestAccount({ user, guestData, policy, setUserData, setSyncing, onLocalReady, isCurrent }: MigrateGuestAccountOptions): Promise<SyncResult> {
    let localReady = false;
    const assertCurrent = () => { if (!isCurrent()) throw new StaleGuestMigrationError(); };
    const markLocalReady = () => { assertCurrent(); localReady = true; onLocalReady(); };
    const applyLocalData = (data: UserData) => {
        assertCurrent();
        setUserData(data);
        useAppStore.getState().setLocalWorkout(data.activeWorkout || null);
    };
    const restoreAfterFailure = async () => {
        if (!isCurrent()) return;
        if (!localReady && guestData) { applyLocalData(guestData); return; }
        try {
            const { readLocal } = await import('../../lib/sync/localRepository');
            assertCurrent();
            const preserved = await readLocal(user.uid);
            assertCurrent();
            if (preserved) { applyLocalData(preserved.data); return; }
        } catch (error) {
            if (error instanceof StaleGuestMigrationError) throw error;
        }
        if (guestData && isCurrent()) applyLocalData(guestData);
    };

    try {
        assertCurrent();
        setSyncing(true);
        const cloudPayload = await DB.loadCloudPayload({ allMonths: true });
        assertCurrent();
        const cloudData = cloudPayload?.data || null;
        const cloudHasData = hasUserData(cloudData);
        const guestHasData = hasUserData(guestData);
        const resolveAuthenticatedBase = async (): Promise<UserData> => {
            assertCurrent();
            if (cloudData) return cloudData;
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            assertCurrent();
            return UserDataSchema.parse(getResolvedDefaultUserData(catalog)) as unknown as UserData;
        };

        if (policy === 'skip') {
            const { hydrateLocal } = await import('../../lib/sync/localRepository');
            assertCurrent();
            const authenticatedBase = await resolveAuthenticatedBase();
            const hydratedEnv = await hydrateLocal(user.uid, authenticatedBase, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all', isCurrent);
            assertCurrent();
            markLocalReady();
            applyLocalData(hydratedEnv.data);
            return { ok: true, status: 'synced' };
        }

        if (cloudHasData && !guestHasData) {
            const { hydrateLocal } = await import('../../lib/sync/localRepository');
            assertCurrent();
            const hydratedEnv = await hydrateLocal(user.uid, cloudData!, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all', isCurrent);
            assertCurrent();
            markLocalReady();
            applyLocalData(hydratedEnv.data);
            return { ok: true, status: 'synced' };
        }

        if (guestHasData) {
            const { hydrateLocal, commitLocal, readLocal } = await import('../../lib/sync/localRepository');
            assertCurrent();
            const authenticatedBase = await resolveAuthenticatedBase();
            const hydratedEnv = await hydrateLocal(user.uid, authenticatedBase, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all', isCurrent);
            assertCurrent();
            const mergedData = mergeUserData(hydratedEnv.data, guestData);
            await commitLocal(user.uid, mergedData, hydratedEnv.data, isCurrent);
            assertCurrent();
            markLocalReady();

            const syncResult = await replicateJournal(userOwner(user.uid));
            assertCurrent();
            if (syncResult.status === 'local-pending') {
                const pendingEnv = await readLocal(user.uid); assertCurrent();
                applyLocalData(pendingEnv?.data ?? mergedData); return syncResult;
            }
            if (syncResult.status === 'rejected' || syncResult.status === 'failed') {
                const preservedEnv = await readLocal(user.uid); assertCurrent();
                applyLocalData(preservedEnv?.data ?? mergedData); return syncResult;
            }

            const resolvedPayload = await DB.loadCloudPayload();
            assertCurrent();
            const resolvedData = resolvedPayload?.data || mergedData;
            const hydratedFinal = await hydrateLocal(user.uid, resolvedData, resolvedPayload?.completeMonths || [], resolvedPayload?.cloudDocuments, 'window', isCurrent);
            assertCurrent();
            applyLocalData(hydratedFinal.data);
            return syncResult;
        }

        const { hydrateLocal } = await import('../../lib/sync/localRepository');
        assertCurrent();
        const authenticatedBase = await resolveAuthenticatedBase();
        const hydratedEnv = await hydrateLocal(user.uid, authenticatedBase, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all', isCurrent);
        assertCurrent();
        markLocalReady();
        applyLocalData(hydratedEnv.data);
        return { ok: true, status: 'synced' };
    } catch (error) {
        if (error instanceof StaleGuestMigrationError || !isCurrent()) throw new StaleGuestMigrationError();
        console.warn('Errore sincronizzazione iniziale post-link:', error);
        await restoreAfterFailure();
        if (!localReady) throw error;
        return { ok: false, status: 'failed', error };
    } finally {
        if (isCurrent()) setSyncing(false);
    }
}
