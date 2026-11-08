import type { User } from 'firebase/auth';
import type { GuestMigrationPolicy } from '../AuthContextDef';
import type { SyncResult, UserData } from '../../types';
import { DB } from '../../lib/db';
import { isHealthConsentCloudWritable } from '../../lib/healthConsent';
import { getDb } from '../../lib/firebase';
import { UserDataSchema } from '../../lib/schema';
import { hasUserData, mergeUserData } from '../../lib/merge';
import { useAppStore } from '../../store/useAppStore';
import { getCachedCatalog } from '../../lib/catalog/catalogService';
import { replicateJournal } from '../../lib/sync/replicateJournal';
import { requireCloudAccountDataKey } from '../../lib/sync/cloudAccountKeyAccess';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';
import { markTabSnapshotClean } from '../../lib/sync/tabSnapshotCausality';
import { getResolvedDefaultUserData } from './defaultUserData';
import {
    checkpointFromCloudDocuments,
    claimReplicaCheckpoint,
    retireExpiredReplicas,
} from '../../lib/sync/replicaProtocol';
import { IncompleteCloudSnapshotError, type LocalEnvelope } from '../../lib/sync/localRepository';

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
    onLocalReady: () => Promise<void> | void;
    isCurrent: () => boolean;
};

export async function migrateGuestAccount({ user, guestData, policy, setUserData, setSyncing, onLocalReady, isCurrent }: MigrateGuestAccountOptions): Promise<SyncResult> {
    let localReady = false;
    const assertCurrent = () => { if (!isCurrent()) throw new StaleGuestMigrationError(); };
    // A valid Auth run alone does not preserve the server-verified consent epoch
    // through an async Firestore transaction or its SDK retry.
    const cloudAllowed = () => isCurrent() && isHealthConsentCloudWritable(userOwner(user.uid));
    const assertCloudAllowed = () => { if (!cloudAllowed()) throw new StaleGuestMigrationError(); };
    const markLocalReady = async () => { assertCloudAllowed(); localReady = true; await onLocalReady(); };
    const applyLocalData = (data: UserData) => {
        assertCurrent();
        if (localReady) {
            // The account envelope is already durable (hydrate/commit/ack).
            // Publishing a server snapshot through setUserData() would interpret
            // the previous guest/account view as a NEW user edit and append a
            // duplicate semantic journal after successful remote acknowledgement.
            const session = captureSession();
            if (session.owner !== userOwner(user.uid) || !isCurrentSession(session)) {
                throw new StaleGuestMigrationError();
            }
            const durable = UserDataSchema.parse(data) as unknown as UserData;
            useAppStore.setState({ userData: durable, dataOwner: session.owner });
            markTabSnapshotClean(session, durable);
        } else {
            // Pre-commit failure recovery still uses the original guest writer,
            // preserving any unsaved guest edits instead of discarding them.
            setUserData(data);
        }
        useAppStore.getState().setLocalWorkout(data.activeWorkout || null);
    };
    const restoreAfterFailure = async () => {
        if (!isCurrent()) return;
        if (!localReady) {
            if (guestData) applyLocalData(guestData);
            return;
        }
        try {
            const { readLocal } = await import('../../lib/sync/localRepository');
            assertCurrent();
            const preserved = await readLocal(user.uid);
            assertCurrent();
            if (!preserved) throw new Error('Archivio autenticato non disponibile dopo il passaggio di proprietario.');
            applyLocalData(preserved.data);
        } catch (error) {
            if (error instanceof StaleGuestMigrationError || !isCurrent()) throw new StaleGuestMigrationError();
            // After handoff only the durable account envelope is authoritative.
            // A guest snapshot cannot replace it or become a clean account base.
            useAppStore.setState({
                localPersistenceBlocked: true, syncing: false, syncHealth: 'failed',
                saveError: 'Archivio account non rileggibile dopo la migrazione. Copie locali preservate; riapri TheLogBook prima di modificare i dati.',
            });
        }
    };

    try {
        assertCloudAllowed();
        setSyncing(true);
        const cloudKey = await requireCloudAccountDataKey(user.uid, assertCloudAllowed);
        assertCloudAllowed();
        const { hydrateLocal, commitLocal, readLocal } = await import('../../lib/sync/localRepository');
        assertCloudAllowed();
        // A fence installed during this scan invalidates its recovery evidence.
        // Never adopt a newer token returned by hydration after the read.
        const expectedCloudIntegrityFence = (await readLocal(user.uid))?.cloudIntegrityFence ?? null;
        assertCloudAllowed();
        const cloudPayload = await DB.loadCloudPayload({ allMonths: true, cloudKey });
        assertCloudAllowed();
        const cloudData = cloudPayload?.data || null;
        // Unflagged guest catalog entries must be classified using the durable
        // catalog, not a transient empty seed from a failed IndexedDB read.
        const catalog = await getCachedCatalog();
        assertCloudAllowed();
        const guestHasData = hasUserData(guestData);
        const prepareReplica = async (hydrated: LocalEnvelope): Promise<LocalEnvelope> => {
            assertCloudAllowed();
            const { adoptReplicaCheckpoint, completeCloudIntegrityRecovery } = await import('../../lib/sync/localRepository');
            await retireExpiredReplicas(getDb(), user.uid, Date.now(), cloudAllowed);
            assertCloudAllowed();
            const checkpoint = checkpointFromCloudDocuments(cloudPayload?.cloudDocuments ?? new Map());
            const claim = await claimReplicaCheckpoint(
                getDb(),
                user.uid,
                hydrated.replica,
                checkpoint.clock,
                hydrated.actorSeq,
                hydrated.replica ? undefined : hydrated.actorId,
                cloudAllowed,
            );
            assertCloudAllowed();
            await adoptReplicaCheckpoint(user.uid, claim, checkpoint, cloudAllowed);
            assertCloudAllowed();
            const recovered = await completeCloudIntegrityRecovery(user.uid, expectedCloudIntegrityFence, true, cloudAllowed);
            if (hydrated.cloudIntegrityFence && isCurrent()) {
                useAppStore.setState({ cloudIntegrityBlocked: false, syncHealth: recovered.pending.length ? 'local-pending' : 'synced', saveError: null });
            }
            return recovered;
        };

        const resolveAuthenticatedBase = async (): Promise<UserData> => {
            assertCurrent();
            if (cloudData) return cloudData;
            return UserDataSchema.parse(getResolvedDefaultUserData(catalog)) as unknown as UserData;
        };

        const reflectDurableOutcome = (result: SyncResult, durable: LocalEnvelope): SyncResult => {
            assertCurrent();
            // A confirmed replay may leave another tab's newer operations pending.
            const checked: SyncResult = durable.cloudIntegrityFence
                ? { ok: false, status: 'failed', error: new Error('Recupero cloud richiesto: dati locali preservati.') }
                : result.status === 'synced' && durable.pending.length > 0
                    ? { ok: false, status: 'local-pending', error: new Error('Journal locale ancora in attesa di sincronizzazione.') }
                    : result;
            useAppStore.setState({ syncHealth: checked.status });
            return checked;
        };

        // An account may already hold its own pending journal even when the
        // guest intentionally skips the transfer. Hydration is not cloud ACK.
        const finishWithoutGuestMerge = async (): Promise<SyncResult> => {
            await markLocalReady();
            const { readLocal } = await import('../../lib/sync/localRepository');
            const beforeReplay = await readLocal(user.uid);
            assertCurrent();
            if (!beforeReplay) throw new Error('Archivio autenticato non disponibile dopo hydration.');
            // A consent check cannot turn an empty journal into fake pending.
            const replayResult: SyncResult = beforeReplay.pending.length
                ? await replicateJournal(userOwner(user.uid))
                : { ok: true, status: 'synced' };
            assertCurrent();
            const durable = await readLocal(user.uid);
            assertCurrent();
            if (!durable) throw new Error('Archivio autenticato non disponibile dopo la replica.');
            applyLocalData(durable.data);
            return reflectDurableOutcome(replayResult, durable);
        };

        assertCurrent();
        const authenticatedBase = await resolveAuthenticatedBase();
        let hydratedEnv = await hydrateLocal(user.uid, authenticatedBase, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all', cloudAllowed);
        assertCloudAllowed();
        hydratedEnv = await prepareReplica(hydratedEnv);
        assertCloudAllowed();
        if (policy === 'skip' || !guestHasData) return await finishWithoutGuestMerge();

        const mergedData = mergeUserData(hydratedEnv.data, guestData);
        await commitLocal(user.uid, mergedData, hydratedEnv.data, cloudAllowed);
        assertCloudAllowed();
        await markLocalReady();

        const syncResult = await replicateJournal(userOwner(user.uid));
        assertCurrent();
        if (syncResult.status !== 'synced') {
            const preserved = await readLocal(user.uid);
            assertCurrent();
            if (!preserved) throw new Error('Archivio autenticato non disponibile dopo la replica.');
            applyLocalData(preserved.data);
            return reflectDurableOutcome(syncResult, preserved);
        }

        assertCloudAllowed();
        const resolvedPayload = await DB.loadCloudPayload({ cloudKey });
        assertCloudAllowed();
        const resolvedData = resolvedPayload?.data || mergedData;
        const hydratedFinal = await hydrateLocal(user.uid, resolvedData, resolvedPayload?.completeMonths || [], resolvedPayload?.cloudDocuments, 'window', cloudAllowed);
        assertCloudAllowed();
        applyLocalData(hydratedFinal.data);
        return reflectDurableOutcome(syncResult, hydratedFinal);
    } catch (error) {
        if (error instanceof StaleGuestMigrationError || !isCurrent()) throw new StaleGuestMigrationError();
        useAppStore.setState({ syncHealth: 'failed' });
        const code = (error as { code?: unknown })?.code;
        if (error instanceof IncompleteCloudSnapshotError) {
            // The hydration transaction has already persisted the precise fence.
            useAppStore.setState({
                syncHealth: 'failed', cloudIntegrityBlocked: true, saveError: error.message,
            });
        } else if (code === 'invalid-cloud-sync-metadata' || code === 'invalid-cloud-ciphertext'
            || ['CloudDataIntegrityError', 'LegacyVersionError', 'FutureVersionError', 'ZodError'].includes(
                error instanceof Error ? error.name : '',
            )) {
            const { markCloudIntegrityBlocked, readLocal } = await import('../../lib/sync/localRepository');
            try {
                if (await readLocal(user.uid)) {
                    assertCurrent();
                    await markCloudIntegrityBlocked(user.uid, isCurrent);
                    assertCurrent();
                    useAppStore.setState({ syncHealth: 'failed', cloudIntegrityBlocked: true });
                }
            } catch (fenceError) {
                if (!isCurrent()) throw new StaleGuestMigrationError();
                console.error('Barriera cloud dopo migrazione non registrabile:', fenceError);
                useAppStore.setState({ localPersistenceBlocked: true, syncHealth: 'failed',
                    saveError: 'Archivio locale non verificabile dopo la migrazione; dati preservati.' });
            }
        }
        console.warn('Errore sincronizzazione iniziale post-link:', error);
        await restoreAfterFailure();
        if (!localReady) throw error;
        return { ok: false, status: 'failed', error };
    } finally {
        if (isCurrent()) setSyncing(false);
    }
}
