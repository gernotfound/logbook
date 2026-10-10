import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { auth, getDb } from '../../lib/firebase';
import { DB } from '../../lib/db';
import { UserDataSchema } from '../../lib/schema';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';
import { useAppStore } from '../../store/useAppStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../../lib/catalog/catalogService';
import { getResolvedDefaultUserData } from './defaultUserData';
import { adoptReplicaCheckpoint, readLocal, hydrateLocal } from '../../lib/sync/localRepository';
import {
    checkpointFromCloudDocuments,
    claimReplicaCheckpoint,
    needsReplicaCheckpoint,
    retireExpiredReplicas,
} from '../../lib/sync/replicaProtocol';
import { getInitialLocalWorkout } from '../../store/slices/createWorkoutSlice';
import { markTabSnapshotClean } from '../../lib/sync/tabSnapshotCausality';

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

    if (!useAppStore.getState().userData) setSyncing(true);

    try {
        // Once Firebase identifies the authenticated owner, fence any pre-auth snapshot
        // and install exactly that owner's durable envelope before doing network work.
        const localEnvelope = await readLocal(expectedOwner);
        if (!isCurrent()) return;

        if (localEnvelope) {
            const localWorkout = getInitialLocalWorkout(expectedOwner, localEnvelope.data.activeWorkout ?? null, localEnvelope.data.history, localEnvelope.lastClosedWorkoutId, localEnvelope.closedWorkoutIds);
            useAppStore.setState({
                userData: localEnvelope.data,
                dataOwner: expectedOwner,
                localWorkout,
                localPersistenceBlocked: false,
            });
            markTabSnapshotClean(session, localEnvelope.data);
        } else {
            const current = useAppStore.getState();
            // Only a dataset explicitly tagged to another owner is stale. Untagged
            // in-memory state (tests/first-run transient state) is not destroyed here.
            if (current.userData && current.dataOwner && current.dataOwner !== expectedOwner) {
                useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
            }
        }
    } catch (error) {
        if (!isCurrent()) return;
        console.error('Archivio locale autenticato non leggibile; bootstrap bloccato:', error);
        useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            saveError: 'Archivio locale non disponibile. Riprova prima di modificare i dati.',
        });
        setSyncing(false);
        return;
    }

    try {
        const durableBeforeCloud = await readLocal(expectedOwner);
        if (!isCurrent()) return;
        const checkpointDue = needsReplicaCheckpoint(durableBeforeCloud?.replica);
        const payload = await DB.loadCloudPayload({ allMonths: checkpointDue });
        if (!isCurrent()) return;

        if (payload) {
            try {
                let hydratedEnv = await hydrateLocal(
                    user.uid,
                    payload.data,
                    payload.completeMonths,
                    payload.cloudDocuments,
                    checkpointDue ? 'all' : 'window',
                    isCurrent,
                );
                if (!isCurrent()) return;

                if (checkpointDue) {
                    await retireExpiredReplicas(getDb(), user.uid);
                    if (!isCurrent()) return;
                    const checkpoint = checkpointFromCloudDocuments(payload.cloudDocuments);
                    const claim = await claimReplicaCheckpoint(
                        getDb(),
                        user.uid,
                        hydratedEnv.replica,
                        checkpoint.clock,
                        hydratedEnv.actorSeq,
                        hydratedEnv.replica ? undefined : hydratedEnv.actorId,
                    );
                    if (!isCurrent()) return;
                    hydratedEnv = await adoptReplicaCheckpoint(expectedOwner, claim, checkpoint, isCurrent);
                    if (!isCurrent()) return;
                }

                setUserData(hydratedEnv.data);
            } catch (mergeError) {
                if (!isCurrent()) return;
                const code = (mergeError as { code?: unknown })?.code;
                if (code === 'invalid-cloud-sync-metadata') {
                    setSaveError('Sincronizzazione cloud sospesa: i metadati di sincronizzazione remoti non sono validi. I dati locali validi sono stati preservati e TheLogBook non sovrascriverà il cloud finché il problema non viene risolto.');
                    console.error('Metadati di sincronizzazione cloud non validi; stato locale preservato:', mergeError);
                } else if (code === 'replica-capacity' || code === 'replica-fenced') {
                    setSaveError(mergeError instanceof Error ? mergeError.message : 'Sincronizzazione sospesa: questa copia deve completare un nuovo checkpoint cloud.');
                    console.warn('Checkpoint replica non completato; stato locale preservato:', mergeError);
                } else {
                    console.error('Hydration cloud non valida; stato locale preservato:', mergeError);
                }
            }
        }
    } catch (error: any) {
        if (!isCurrent()) return;
        console.warn('Errore caricamento dati in AuthContext (uso dati locali/offline):', error);
        if (error?.code === 'unavailable' || !navigator.onLine) {
            setSaveError('📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.');
        }

        // Only a positively absent local envelope may initialize a fresh default dataset.
        // A read failure returned earlier and can never reach this branch.
        const latestData = useAppStore.getState().userData;
        if (!latestData) {
            const stillAbsent = await readLocal(expectedOwner);
            if (!isCurrent()) return;
            if (stillAbsent) {
                const localWorkout = getInitialLocalWorkout(expectedOwner, stillAbsent.data.activeWorkout ?? null, stillAbsent.data.history, stillAbsent.lastClosedWorkoutId, stillAbsent.closedWorkoutIds);
                useAppStore.setState({ userData: stillAbsent.data, dataOwner: expectedOwner, localWorkout });
                markTabSnapshotClean(session, stillAbsent.data);
                return;
            }
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
