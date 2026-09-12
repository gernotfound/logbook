import equal from 'fast-deep-equal';
import { flushSync } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { draftRegistry } from '../utils/draftRegistry';
import { readLocal } from './localRepository';
import { captureSession, isCurrentSession } from './session';
import { writeDeviceValue } from './deviceStorage';
import { UserDataSchema } from '../schema';

export async function prepareForReload() {
    const session = captureSession();
    flushSync(() => draftRegistry.flushAll({ strict: true }));
    try { await useAppStore.getState().flushPendingSyncs(); }
    catch { /* Remote rejection is compatible with reload only if the local copy is verified below. */ }
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    const envelope = await readLocal(session.owner);
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
    const state = useAppStore.getState();
    let isUnsaved = false;
    if (state.userData && envelope) {
        // Strip undefined values explicitly via JSON to match how `fast-deep-equal` views them 
        // compared to missing keys, preventing false positives.
        const envParsed = JSON.parse(JSON.stringify(UserDataSchema.parse(envelope.data)));
        const stateParsed = JSON.parse(JSON.stringify(UserDataSchema.parse(state.userData)));
        
        // Exclude activeWorkout as it is ephemeral and frequently gets desynced between 
        // the local cache and Zustand store (e.g. by timer ticks).
        delete envParsed.activeWorkout;
        delete stateParsed.activeWorkout;
        
        isUnsaved = !equal(envParsed, stateParsed);
    }

    if (isUnsaved) {
        throw new Error('Le ultime modifiche non sono ancora salvate sul dispositivo. Riprova tra poco.');
    }
    writeDeviceValue('workout', state.localWorkout ? JSON.stringify(state.localWorkout) : null, session.owner);
    return session;
}
