import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { auth, getDb } from '../../lib/firebase';
import { isHealthConsentCloudWritable } from '../../lib/healthConsent';
import { DB } from '../../lib/db';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';
import { requireCloudAccountDataKey } from '../../lib/sync/cloudAccountKeyAccess';
import { useAppStore } from '../../store/useAppStore';
import { adoptReplicaCheckpoint, readLocal, hydrateLocal, markCloudIntegrityBlocked, completeCloudIntegrityRecovery, IncompleteCloudSnapshotError, markReplicaCheckpointRequired } from '../../lib/sync/localRepository';
import {
    checkpointFromCloudDocuments,
    claimReplicaCheckpoint,
    needsReplicaCheckpoint,
    retireExpiredReplicas,
} from '../../lib/sync/replicaProtocol';
import { getInitialLocalWorkout } from '../../store/slices/createWorkoutSlice';
import { markTabSnapshotClean } from '../../lib/sync/tabSnapshotCausality';
import { recoverWorkoutDeviceIntent } from '../../lib/sync/workoutDeviceIntent';
import { reportMissingAuthenticatedStorage } from '../../lib/storageTelemetry';

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
    setSyncing,
    setSaveError,
}: LoadAuthenticatedDataOptions): Promise<'ready' | 'blocked'> {
    if (!user) return 'blocked';

    const session = captureSession();
    const expectedOwner = userOwner(user.uid);
    const generation = (loadGenerationByOwner.get(expectedOwner) ?? 0) + 1;
    loadGenerationByOwner.set(expectedOwner, generation);
    const isCurrent = () => session.owner === expectedOwner
        && isCurrentSession(session)
        && loadGenerationByOwner.get(expectedOwner) === generation
        && auth.currentUser?.uid === user.uid
        && !isGuestActive()
        // A readable old envelope cannot prove that a failed UI draft was saved.
        && !useAppStore.getState().localPersistenceBlocked;

    if (!isCurrent()) return 'blocked';

    if (!useAppStore.getState().userData) setSyncing(true);

    const preserveUnsafeCloud = async (): Promise<boolean> => {
        try {
            await markCloudIntegrityBlocked(expectedOwner);
        } catch (error) {
            console.error('Impossibile registrare la barriera cloud sul dispositivo:', error);
            if (isCurrent()) useAppStore.setState({ localPersistenceBlocked: true, syncHealth: 'failed',
                saveError: 'Protezione cloud non registrabile. I dati locali devono essere preservati.' });
            return false;
        }
        if (isCurrent()) useAppStore.setState({
            syncHealth: 'failed',
            cloudIntegrityBlocked: true,
            saveError: 'Snapshot cloud non verificato: copia locale preservata. Sincronizzazione sospesa fino al recupero.',
        });
        return isCurrent();
    };

    try {
        // Once Firebase identifies the authenticated owner, fence any pre-auth snapshot
        // and install exactly that owner's durable envelope before doing network work.
        await recoverWorkoutDeviceIntent(expectedOwner, isCurrent);
        if (!isCurrent()) return 'blocked';
        const localEnvelope = await readLocal(expectedOwner);
        if (!isCurrent()) return 'blocked';

        if (!localEnvelope && isHealthConsentCloudWritable(expectedOwner)) {
            // Unlike the pre-auth entrypoint, this is an authenticated, owner-bound
            // IndexedDB read. A previous durable marker with no envelope is an
            // observable storage anomaly, not permission to seed an empty copy.
            reportMissingAuthenticatedStorage(expectedOwner, user.uid, isCurrent);
        }

        if (localEnvelope) {
            const localWorkout = getInitialLocalWorkout(expectedOwner, localEnvelope.data.activeWorkout ?? null, localEnvelope.data.history, localEnvelope.lastClosedWorkoutId, localEnvelope.closedWorkoutIds, localEnvelope.consentRevision);
            useAppStore.setState({
                userData: localEnvelope.data,
                dataOwner: expectedOwner,
                localWorkout,
                cloudIntegrityBlocked: Boolean(localEnvelope.cloudIntegrityFence),
                ...(localEnvelope.cloudIntegrityFence ? {
                    syncHealth: 'failed' as const,
                    saveError: 'Snapshot cloud non verificato: copia locale preservata. Sincronizzazione sospesa fino al recupero.',
                } : {}),
            });
            markTabSnapshotClean(session, localEnvelope.data);
        } else {
            const current = useAppStore.getState();
            // Ownerless memory is untrusted, not an account-creation default.
            // Without a matching durable envelope it must not survive into B.
            if ((current.userData !== null || current.localWorkout !== null) && current.dataOwner !== expectedOwner) {
                useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null, cloudIntegrityBlocked: false });
            }
        }
    } catch (error) {
        if (!isCurrent()) return 'blocked';
        console.error('Archivio locale autenticato non leggibile; bootstrap bloccato:', error);
        useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            saveError: 'Archivio locale non disponibile. Riprova prima di modificare i dati.',
        });
        setSyncing(false);
        return 'blocked';
    }

    try {
        // Cached offline consent permits local editing, NEVER remote reads,
        // checkpoint registration or cloud writes until freshly revalidated.
        const cloudAllowed = () => isCurrent() && isHealthConsentCloudWritable(expectedOwner);
        if (!cloudAllowed()) return 'blocked';
        const durableBeforeCloud = await readLocal(expectedOwner);
        if (!cloudAllowed()) return 'blocked';
        if (!cloudAllowed()) return 'blocked';
        const checkpointDue = needsReplicaCheckpoint(durableBeforeCloud?.replica) || Boolean(durableBeforeCloud?.cloudIntegrityFence);
        // The ADK must be provisioned BEFORE a first replica checkpoint creates
        // sync_control/state: once cloud state exists, silent key creation is
        // forbidden to prevent overwriting documents with an unrelated key.
        const cloudKey = await requireCloudAccountDataKey(user.uid, () => {
            if (!cloudAllowed()) throw new Error('Consenso o sessione cloud cambiati.');
        });
        if (!cloudAllowed()) return 'blocked';
        const payload = await DB.loadCloudPayload({ allMonths: checkpointDue, cloudKey });
        if (!cloudAllowed()) return 'blocked';

        if (payload) {
            try {
                let hydratedEnv = await hydrateLocal(
                    user.uid,
                    payload.data,
                    payload.completeMonths,
                    payload.cloudDocuments,
                    checkpointDue ? 'all' : 'window',
                    cloudAllowed,
                );
                if (!cloudAllowed()) return 'blocked';

                if (checkpointDue) {
                    await retireExpiredReplicas(getDb(), user.uid);
                    if (!cloudAllowed()) return 'blocked';
                    const checkpoint = checkpointFromCloudDocuments(payload.cloudDocuments);
                    const claim = await claimReplicaCheckpoint(
                        getDb(),
                        user.uid,
                        hydratedEnv.replica,
                        checkpoint.clock,
                        hydratedEnv.actorSeq,
                        hydratedEnv.replica ? undefined : hydratedEnv.actorId,
                    );
                    if (!cloudAllowed()) return 'blocked';
                    hydratedEnv = await adoptReplicaCheckpoint(expectedOwner, claim, checkpoint, isCurrent);
                    if (!cloudAllowed()) return 'blocked';
                }

                hydratedEnv = await completeCloudIntegrityRecovery(
                    expectedOwner, durableBeforeCloud?.cloudIntegrityFence ?? null, checkpointDue, cloudAllowed,
                );
                if (!cloudAllowed()) return 'blocked';

                // hydrateLocal has already committed this authoritative snapshot
                // atomically. Rendering it via the user-edit writer setUserData
                // would create a second semantic journal from the old UI state.
                const hydratedWorkout = getInitialLocalWorkout(
                    expectedOwner, hydratedEnv.data.activeWorkout ?? null, hydratedEnv.data.history,
                    hydratedEnv.lastClosedWorkoutId, hydratedEnv.closedWorkoutIds, hydratedEnv.consentRevision,
                );
                if (!cloudAllowed()) return 'blocked';
                useAppStore.setState({
                    userData: hydratedEnv.data, dataOwner: expectedOwner,
                    localWorkout: hydratedWorkout,
                    cloudIntegrityBlocked: false,
                    syncHealth: hydratedEnv.pending.length ? 'local-pending' : 'synced',
                    saveError: hydratedEnv.pending.length ? 'Salvato localmente. Sincronizzazione in attesa.' : null,
                });
                markTabSnapshotClean(session, hydratedEnv.data);
            } catch (mergeError) {
                if (!cloudAllowed()) return 'blocked';
                const code = (mergeError as { code?: unknown })?.code;
                if (mergeError instanceof IncompleteCloudSnapshotError) {
                    // hydrateLocal already fenced the exact unsafe envelope in
                    // its atomic IndexedDB write, before surfacing the error.
                    useAppStore.setState({ syncHealth: 'failed', cloudIntegrityBlocked: true });
                    setSaveError(mergeError.message);
                    // Log only document categories/month IDs, never business data.
                    console.warn('Evidenza cloud incompleta; archivio locale protetto:', {
                        cause: mergeError.causeKind,
                        documentPaths: mergeError.documentPaths,
                        count: mergeError.documentPaths.length,
                    });
                } else if (code === 'invalid-cloud-sync-metadata') {
                    if (!(await preserveUnsafeCloud())) return 'blocked';
                    setSaveError('Sincronizzazione cloud sospesa: i metadati di sincronizzazione remoti non sono validi. I dati locali validi sono stati preservati e TheLogBook non sovrascriverà il cloud finché il problema non viene risolto.');
                    console.error('Metadati di sincronizzazione cloud non validi; stato locale preservato:', mergeError);
                } else {
                    // Transport failures and replica capacity are NOT evidence
                    // that acknowledged business documents went missing.
                    // Requiring a new checkpoint stops old journal replay while
                    // leaving backup/logout policy tied to actual integrity.
                    if (durableBeforeCloud?.replica) {
                        await markReplicaCheckpointRequired(expectedOwner, durableBeforeCloud.replica);
                    }
                    if (!cloudAllowed()) return 'blocked';
                    setSaveError(mergeError instanceof Error ? mergeError.message : 'Checkpoint cloud non completato. Riprova.');
                    console.error('Hydration cloud non valida; stato locale preservato:', mergeError);
                }
                return 'blocked';
            }
        }
    } catch (error: any) {
        if (!isCurrent()) return 'blocked';
        const integrityError = ['CloudDataIntegrityError', 'IncompleteCloudMonthError', 'LegacyVersionError', 'FutureVersionError', 'ZodError', 'InvalidCloudSyncMetadataError'].includes(error?.name);
        if (integrityError) {
            if (!(await preserveUnsafeCloud())) return 'blocked';
            setSaveError('Dati cloud non verificabili: sincronizzazione sospesa, archivio locale preservato.');
        } else if (error?.code === 'concurrent-cloud-read') {
            // A racing scan is not a verified missing document. Retry at the
            // next foreground sync without installing a destructive-exit fence.
            setSaveError(error.message);
        }
        console.warn('Errore caricamento dati in AuthContext (uso dati locali/offline):', error);
        if (error?.code === 'unavailable' || !navigator.onLine) {
            setSaveError('📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.');
        }

        // An owner envelope is authoritative local evidence even when the cloud
        // is unavailable. Absence of an envelope, however, does NOT prove that
        // the remote account is empty; never seed a replacement snapshot here.
        const latestData = useAppStore.getState().userData;
        if (!latestData) {
            const stillAbsent = await readLocal(expectedOwner);
            if (!isCurrent()) return 'blocked';
            if (stillAbsent) {
                const localWorkout = getInitialLocalWorkout(expectedOwner, stillAbsent.data.activeWorkout ?? null, stillAbsent.data.history, stillAbsent.lastClosedWorkoutId, stillAbsent.closedWorkoutIds, stillAbsent.consentRevision);
                useAppStore.setState({ userData: stillAbsent.data, dataOwner: expectedOwner, localWorkout,
                    cloudIntegrityBlocked: Boolean(stillAbsent.cloudIntegrityFence) });
                markTabSnapshotClean(session, stillAbsent.data);
                return 'blocked';
            }
            // A transient cloud error on a new device is not a server-confirmed
            // empty account. An optimistic default would become a new semantic
            // journal and could later overwrite genuine remote business data.
            useAppStore.setState({ syncHealth: 'failed' });
            setSaveError('Impossibile verificare i dati cloud e nessun archivio locale disponibile. I dati dell’account non sono stati modificati: riconnettiti e riprova.');
        }
        // A failed cloud read cannot certify the causal base for a journal drain.
        return 'blocked';
    } finally {
        if (isCurrent()) setSyncing(false);
    }
    return 'ready';
}
