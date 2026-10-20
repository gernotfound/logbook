import type { WorkoutSession } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { DomainParsers } from '../../lib/schema';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { readLocal } from '../../lib/sync/localRepository';
import { assertWorkoutSnapshotEpoch } from '../../lib/sync/workoutDeviceIntent';

export const HISTORY_EDITOR_CONTEXT = 'history-editor-context';

export function assertHistoryEditorContextEpoch(raw: string | null, owner: string, envelopeRevision?: number): void {
    if (raw === null) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Contesto editor storico non leggibile: copia preservata.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Contesto editor storico non valido: copia preservata.');
    }
    const saved = parsed as { version?: unknown; editorId?: unknown; consentRevision?: unknown };
    if (saved.version !== 1 || typeof saved.editorId !== 'string' || !saved.editorId
        || (saved.consentRevision !== undefined && (!Number.isSafeInteger(saved.consentRevision)
            || (saved.consentRevision as number) < 1))) {
        throw new Error('Metadati editor storico non validi: copia preservata.');
    }
    assertWorkoutSnapshotEpoch(owner, saved.consentRevision as number | undefined, envelopeRevision);
}

// One lock per owner, shared by all mounted history controls.
const pendingHistorySaves = new Set<string>();
export const isHistorySavePending = (owner: string): boolean => pendingHistorySaves.has(owner);
export function claimHistorySave(owner: string): boolean {
    if (pendingHistorySaves.has(owner)) return false;
    pendingHistorySaves.add(owner);
    return true;
}
export const releaseHistorySave = (owner: string): void => { pendingHistorySaves.delete(owner); };

/** Restore a suspended device workout only if it was not closed in another tab. */
export async function restoreSessionAfterHistoryEdit(editorId: string): Promise<void> {
    const session = captureSession();
    const editor = useAppStore.getState().localWorkout;
    if (!editor?.isEditingHistory || String(editor.id) !== editorId) {
        throw new Error('Editor storico non più corrente.');
    }
    const raw = readDeviceValueStrict(HISTORY_EDITOR_CONTEXT, session.owner);
    let suspended: WorkoutSession | null;
    if (raw === null) {
        suspended = useAppStore.getState().userData?.activeWorkout ?? null;
    } else {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Contesto editor storico non valido.');
        const saved = parsed as { version?: unknown; editorId?: unknown; suspended?: unknown };
        if (saved.version !== 1 || saved.editorId !== editorId) throw new Error('Contesto editor storico non corrispondente.');
        if (saved.suspended === null) {
            suspended = null;
        } else {
            const previous = DomainParsers.parseActiveWorkout(saved.suspended);
            if (!previous || previous.isEditingHistory) throw new Error('Sessione sospesa non valida.');
            suspended = previous as WorkoutSession;
        }
    }
    const durable = await readLocal(session.owner);
    if (!isCurrentSession(session) || useAppStore.getState().localWorkout !== editor) {
        throw new Error('Sessione o editor modificati durante il ripristino.');
    }
    // Keep the historical context and its suspended workout in the source epoch.
    // A new consent cannot relabel the context by calling setLocalWorkout().
    assertHistoryEditorContextEpoch(raw, session.owner, durable?.consentRevision);
    const wasClosed = (id: string) => durable && (
        durable.lastClosedWorkoutId === id
        || durable.closedWorkoutIds?.includes(id)
        || durable.data.history?.some(item => item.id === id)
    );
    if (suspended && wasClosed(String(suspended.id))) suspended = null;
    // The suspended device snapshot may include locally-entered sets not yet
    // reflected in the durable cloud-oriented activeWorkout. It stays preferred
    // unless closure evidence proves it is no longer live.
    if (!suspended && durable?.data.activeWorkout && !wasClosed(String(durable.data.activeWorkout.id))) {
        suspended = durable.data.activeWorkout;
    }
    useAppStore.getState().setLocalWorkout(suspended);
    try {
        writeDeviceValue(HISTORY_EDITOR_CONTEXT, null, session.owner);
    } catch (error) {
        console.warn('Sessione ripristinata; impossibile pulire il contesto storico:', error);
    }
}
