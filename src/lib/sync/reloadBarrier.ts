import equal from 'fast-deep-equal';
import { flushSync } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { draftRegistry } from '../utils/draftRegistry';
import { commitLocal, readLocal } from './localRepository';
import { captureSession, isCurrentSession } from './session';
import { writeDeviceValue } from './deviceStorage';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { markTabSnapshotClean, readTabSnapshotState } from './tabSnapshotCausality';

export async function prepareForReload() {
    const session = captureSession();
    flushSync(() => draftRegistry.flushAll({ strict: true }));
    try { await useAppStore.getState().flushPendingSyncs(); }
    catch { /* Remote rejection is compatible with reload only if the local copy is verified below. */ }
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    let envelope = await readLocal(session.owner);
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    let state = useAppStore.getState();
    if (state.userData && envelope && !equal(UserDataSchema.parse(envelope.data), UserDataSchema.parse(state.userData))) {
        const tabSnapshot = readTabSnapshotState(session);
        if (!tabSnapshot) {
            throw new Error('Impossibile verificare in sicurezza la provenienza delle modifiche locali. Riapri LogBook e riprova.');
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
    writeDeviceValue('workout', state.localWorkout ? JSON.stringify(state.localWorkout) : null, session.owner);
    return session;
}
