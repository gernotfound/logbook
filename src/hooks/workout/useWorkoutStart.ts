import { useCallback, useState } from 'react';
import { InvalidRoutineSessionPlanError } from '../../lib/routineSessionLimits';
import { Logic } from '../../lib/logic';
import { readWorkoutTimerSnapshot, resetGlobalWorkoutTimer, writeWorkoutTimerSnapshot } from '../../lib/utils/timer';
import { buildFreeWorkout, buildRoutineWorkout } from './workoutSessionPreparation';
import { readLocal } from '../../lib/sync/localRepository';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import type { WorkoutSession, WorkoutReadiness } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';

type StartDependencies = {
    mutateActiveWorkout: (workoutOrUpdater: Parameters<ReturnType<typeof useAppStore.getState>['setSyncedLocalWorkout']>[0]) => void;
    setSyncedLocalWorkout: ReturnType<typeof useAppStore.getState>['setSyncedLocalWorkout'];
    showAlert: ReturnType<typeof useDialogStore.getState>['showAlert'];
};

// Preparation, durable start confirmation and timer reset belong to one boundary.
// A UI-visible optimistic start is never sufficient proof of an IndexedDB commit.
export function useWorkoutStart({
    mutateActiveWorkout, setSyncedLocalWorkout, showAlert,
}: StartDependencies) {
    const [selectedRoutine, setSelectedRoutine] = useState('');

    const startWorkout = useCallback(async (routineIdToStart?: string, cycleInfo?: { cycleId?: string; cycleName?: string }) => {
        const currentLocal = useAppStore.getState().localWorkout;
        const targetId = (typeof routineIdToStart === 'string' && routineIdToStart) ? routineIdToStart : selectedRoutine;
        if (!targetId) {
            await showAlert("Seleziona una scheda per iniziare!");
            return;
        }
        if (currentLocal) {
            await showAlert("Hai già un allenamento in corso!");
            return;
        }

        const userData = useAppStore.getState().userData;
        const currentRoutines = userData?.routines || [];
        const routine = currentRoutines.find(r => r.id === targetId);
        if (!routine) {
            await showAlert("Scheda non trovata.");
            return;
        }
        
        let newActiveWorkout: WorkoutSession;
        try {
            newActiveWorkout = buildRoutineWorkout(userData, routine, cycleInfo);
        } catch (error) {
            if (!(error instanceof InvalidRoutineSessionPlanError)) throw error;
            await showAlert(error.message);
            return;
        }
        mutateActiveWorkout(newActiveWorkout);
    }, [selectedRoutine, showAlert, mutateActiveWorkout]);

    const startFreeWorkout = useCallback(async () => {
        const currentLocal = useAppStore.getState().localWorkout;
        if (currentLocal) {
            await showAlert("Hai già un allenamento in corso!");
            return;
        }

        const newActiveWorkout = buildFreeWorkout();
        mutateActiveWorkout(newActiveWorkout);
    }, [showAlert, mutateActiveWorkout]);

    const confirmWorkoutStart = useCallback(async (readiness?: Omit<WorkoutReadiness, 'capturedAt'>) => {
        const currentWorkout = useAppStore.getState().localWorkout;
        if (!currentWorkout || currentWorkout.isEditingHistory) return false;
        if (currentWorkout.globalStartTime) return true;
        const session = captureSession();

        try {
            // Preparing a workout is itself an asynchronous domain commit. Starting
            // it before that write finishes can let the older unstarted snapshot
            // overwrite the start that follows, even inside the same browser tab.
            await useAppStore.getState().flushPendingSyncs();
            if (!isCurrentSession(session) || useAppStore.getState().localPersistenceBlocked
                || useAppStore.getState().localWorkout?.id !== currentWorkout.id) return false;
            const prepared = await readLocal(session.owner);
            const durableWorkout = prepared?.data.activeWorkout;
            if (!isCurrentSession(session) || !durableWorkout || durableWorkout.id !== currentWorkout.id
                || durableWorkout.globalStartTime) {
                await showAlert('Impossibile confermare la preparazione locale della sessione. Riapri TheLogBook e riprova.');
                return false;
            }
        } catch (error) {
            console.error('Preparazione locale del workout non confermata:', error);
            if (isCurrentSession(session)) {
                await showAlert('Impossibile confermare il salvataggio locale. La sessione non verrà avviata.');
            }
            return false;
        }

        const startedAt = Date.now();
        const hasReadiness = readiness && Object.values(readiness).some(value => value !== undefined);
        const startedWorkout: WorkoutSession = {
            ...currentWorkout,
            date: Logic.getLocalDateString(startedAt),
            globalStartTime: startedAt,
            ...(hasReadiness ? { readiness: { capturedAt: startedAt, ...readiness } } : {}),
        };

        try {
            // Verify the timer's device storage while retaining its original value.
            // Resetting it before the IndexedDB commit could erase a still-running
            // timer even when the new workout never becomes durable.
            writeWorkoutTimerSnapshot(readWorkoutTimerSnapshot(session.owner), session.owner);
        } catch (error) {
            console.error('Timer locale non disponibile all’avvio:', error);
            useAppStore.setState({
                localPersistenceBlocked: true,
                syncHealth: 'failed',
                syncPresentation: 'normal',
                saveError: 'Impossibile inizializzare il timer sul dispositivo. La sessione non verrà avviata.',
            });
            await showAlert('Impossibile iniziare la sessione: il timer locale non può essere salvato sul dispositivo.');
            return false;
        }

        let result: Awaited<ReturnType<typeof setSyncedLocalWorkout>> | null = null;
        try {
            result = await setSyncedLocalWorkout(startedWorkout);
        } catch (error) {
            console.error('Persistenza avvio workout non completata:', error);
        }

        if (!isCurrentSession(session)) return false;
        if (!result?.ok && result?.status !== 'local-pending') {
            // The device snapshot is already optimistic. A rejected or failed
            // domain commit must never expose it as a safely started workout.
            if (useAppStore.getState().localWorkout?.id === currentWorkout.id
                && useAppStore.getState().localWorkout?.globalStartTime === startedAt) {
                useAppStore.setState({
                    localPersistenceBlocked: true, syncHealth: 'failed', syncPresentation: 'normal',
                    saveError: 'Avvio non confermato nell’archivio locale. Riapri TheLogBook per recuperare la sessione.',
                });
            }
            await showAlert('Impossibile iniziare la sessione: il salvataggio non è stato confermato. Riapri TheLogBook per verificare i dati.');
            return false;
        }
        try {
            const durable = await readLocal(session.owner);
            if (!isCurrentSession(session)) return false;
            const persistedWorkout = durable?.data.activeWorkout;
            // A cloud-pending response is a successful local start only when the
            // exact start transition is proven durable, not merely present in UI.
            if (!persistedWorkout || persistedWorkout.id !== currentWorkout.id
                || persistedWorkout.globalStartTime !== startedAt
                || useAppStore.getState().localWorkout?.id !== currentWorkout.id) {
                // The visible workout was already updated optimistically. A mismatch
                // must fence further edits until recovery resolves the durable state.
                useAppStore.setState({
                    localPersistenceBlocked: true, syncHealth: 'failed', syncPresentation: 'normal',
                    saveError: 'Avvio workout non allineato con l’archivio locale. Riapri TheLogBook per il recupero.',
                });
                await showAlert('Impossibile confermare il salvataggio locale dell’avvio. Riapri TheLogBook per il recupero.');
                return false;
            }
            if (!resetGlobalWorkoutTimer(session.owner)) {
                useAppStore.setState({
                    localPersistenceBlocked: true, syncHealth: 'failed',
                    saveError: 'Allenamento salvato, ma il timer locale non è stato azzerato. Riapri TheLogBook.',
                });
                await showAlert('Allenamento salvato, ma il timer locale non è stato aggiornato. Riapri TheLogBook.');
                return false;
            }
        } catch (error) {
            console.error('Verifica avvio workout duraturo non riuscita:', error);
            useAppStore.setState({ localPersistenceBlocked: true, syncHealth: 'failed',
                saveError: 'Impossibile verificare il salvataggio dell’avvio. Riapri TheLogBook.' });
            await showAlert('Impossibile verificare il salvataggio dell’allenamento. Riapri TheLogBook.');
            return false;
        }
        return true;
    }, [setSyncedLocalWorkout, showAlert]);

    return { selectedRoutine, setSelectedRoutine, startWorkout, startFreeWorkout, confirmWorkoutStart };
}
