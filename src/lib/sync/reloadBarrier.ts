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
    if (state.userData && (!envelope || !equal(UserDataSchema.parse(envelope.data), UserDataSchema.parse(state.userData)))) {
        throw new Error('Le ultime modifiche non sono ancora salvate sul dispositivo. Riprova tra poco.');
    }
    writeDeviceValue('workout', state.localWorkout ? JSON.stringify(state.localWorkout) : null, session.owner);
    return session;
}
