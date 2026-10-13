import equal from 'fast-deep-equal';
import { flushSync } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { draftRegistry } from '../utils/draftRegistry';
import { commitLocal, readLocal } from './localRepository';
import { captureSession, isActiveGuestSession, isCurrentSession } from './session';
import { auth } from '../firebase';
import { readBrowserValueStrict } from './browserStorage';
import { persistOwnerBoundWorkoutSnapshot } from './deviceCriticalState';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { markTabSnapshotClean, readTabSnapshotState } from './tabSnapshotCausality';

function isUnauthenticatedReloadSession(session: ReturnType<typeof captureSession>): boolean {
    try {
        const state = useAppStore.getState();
        // The login screen has no active guest generation. No in-memory business
        // state can be attributed to it, so a reload leaves stored archives intact.
        if (auth.currentUser !== null || readBrowserValueStrict('logbook_is_guest') === 'true'
            || isActiveGuestSession() || state.userData != null || state.localWorkout != null
            || state.dataOwner != null || state.syncing || state.localPersistenceBlocked) return false;
        return equal(captureSession(), session);
    } catch {
        return false;
    }
}

export function isReloadSessionCurrent(session: ReturnType<typeof captureSession>): boolean {
    return isUnauthenticatedReloadSession(session) || isCurrentSession(session);
}

export function prepareForRequiredUpdateReload() {
    const session = captureSession();
    const state = useAppStore.getState();
    persistOwnerBoundWorkoutSnapshot(session, state.dataOwner, state.localWorkout);
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    return session;
}

export async function prepareForReload() {
    const session = captureSession();
    flushSync(() => draftRegistry.flushAll({ strict: true }));
    if (useAppStore.getState().localPersistenceBlocked) {
        throw new Error('Persistenza locale bloccata: le ultime bozze non sono state salvate. Riapri TheLogBook senza eliminare i dati.');
    }
    if (isUnauthenticatedReloadSession(session)) return session;
    try { await useAppStore.getState().flushPendingSyncs(); }
    catch { /* Remote rejection is compatible with reload only if the local copy is verified below. */ }
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    if (useAppStore.getState().localPersistenceBlocked) throw new Error('Persistenza locale bloccata: aggiornamento sospeso.');
    let envelope = await readLocal(session.owner);
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    let state = useAppStore.getState();
    if (state.userData && envelope && !equal(UserDataSchema.parse(envelope.data), UserDataSchema.parse(state.userData))) {
        const tabSnapshot = readTabSnapshotState(session);
        if (!tabSnapshot) {
            throw new Error('Impossibile verificare in sicurezza la provenienza delle modifiche locali. Riapri TheLogBook e riprova.');
        }

        if (tabSnapshot.dirty) {
            // Replay only the changes made by this tab since its last known durable base.
            // commitLocal applies that causal delta over the latest shared IndexedDB envelope,
            // preserving entities written by another tab in the meantime.
            await commitLocal(session.owner, state.userData, tabSnapshot.base, () => isCurrentSession(session));
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
            envelope = await readLocal(session.owner);
            if (!envelope) throw new Error('Le ultime modifiche non sono ancora salvate sul dispositivo. Riprova tra poco.');
        }

        // A clean tab that differs from IndexedDB is stale: it has no local intent to replay.
        // Align memory to the durable shared envelope instead of manufacturing deletions.
        const aligned = UserDataSchema.parse(envelope.data) as unknown as UserData;
        useAppStore.setState({ userData: aligned });
        markTabSnapshotClean(session, aligned);
        state = useAppStore.getState();
    }
    if (state.userData && (!envelope || !equal(UserDataSchema.parse(envelope.data), UserDataSchema.parse(state.userData)))) {
        throw new Error('Le ultime modifiche non sono ancora salvate sul dispositivo. Riprova tra poco.');
    }
    if (state.userData && envelope) markTabSnapshotClean(session, state.userData);
    if (useAppStore.getState().localPersistenceBlocked) throw new Error('Persistenza locale bloccata: aggiornamento sospeso.');
    persistOwnerBoundWorkoutSnapshot(session, state.dataOwner, state.localWorkout);
    return session;
}
