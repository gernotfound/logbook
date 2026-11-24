import { useCallback, useMemo, useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useWorkoutSetMutations } from '../../hooks/workout/useWorkoutSetMutations';
import type {
    KindeWorkoutClosure, KindeWorkoutDraft, KindeWorkoutEdit, KindeWorkoutOrigin,
} from '../../lib/auth/kindeCandidateWorkoutDraft';
import { getLocalDateString } from '../../lib/utils/date';
import { isWorkoutClockAnomalyError, resetWorkoutClockGuard } from '../../lib/workoutClockGuard';
import { stoppedWorkoutTimer } from '../../lib/workoutTimerSnapshot';
import { useDialogStore } from '../../store/useDialogStore';
import type { WorkoutSession } from '../../types';
import { DurableWorkoutEditScope } from '../UI/bufferedWorkoutScope';
import { WorkoutReadinessForm } from './PreSessionCheckIn';
import { WorkoutSessionEditor } from './WorkoutSessionEditor';
import { TrainingSessionSetupView } from './TrainingSessionSetupView';
import { WorkoutTimerControls } from './WorkoutTimerControls';
import PostSessionReview from './session/PostSessionReview';
import './training-session.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type Editor = {
    draft: KindeWorkoutDraft;
    isCurrent: () => boolean;
    edit: KindeWorkoutEdit;
};

export function KindeCandidateWorkout({ realm }: { realm: Realm }) {
    const [editor, setEditor] = useState<Editor | null>(null);
    const active = useRef<Editor | null>(null);
    const inFlight = useRef(false);
    const persistenceBlocked = useRef(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const publish = useCallback((next: Editor | null) => {
        active.current = next;
        setEditor(next);
    }, []);
    const reportClockAnomaly = useCallback(() => {
        setError('Correggi l’ora del dispositivo e riapri TheLogBook prima di terminare.');
    }, []);
    const read = useCallback(() => {
        const current = active.current;
        return current?.isCurrent() ? current.edit.workout : null;
    }, []);
    const capture = useCallback(() => {
        const current = active.current;
        if (inFlight.current || !current?.isCurrent() || current.draft.initial.stale || current.draft.initial.submitted) return null;
        return () => !inFlight.current && active.current?.draft === current.draft && current.isCurrent();
    }, []);
    const write = useCallback((updater: (edit: KindeWorkoutEdit) => KindeWorkoutEdit) => {
        const current = active.current;
        if (!current || !capture()?.()) return false;
        try {
            const edit = updater(current.edit);
            if (edit === current.edit) return false;
            current.draft.write(edit);
            persistenceBlocked.current = false;
            publish({ ...current, edit });
            setError(null);
            return true;
        } catch {
            persistenceBlocked.current = true;
            setError('Impossibile salvare la bozza sul dispositivo. Le ultime modifiche confermate sono conservate.');
            return false;
        }
    }, [capture, publish]);
    const mutateWorkout = useCallback((updater: (workout: WorkoutSession | null) => WorkoutSession | null) => {
        write(edit => {
            const workout = updater(edit.workout);
            return workout && workout !== edit.workout ? { ...edit, workout } : edit;
        });
    }, [write]);
    const scope = useMemo(() => ({ read, capture }), [read, capture]);
    const sets = useWorkoutSetMutations({ setLocalWorkout: mutateWorkout, showConfirm, scope });

    if (realm.state.phase !== 'ready') return null;
    const data = realm.state.snapshot.data;
    const activeCycle = data.trainingCycles?.find(cycle => cycle.id === data.activeCycleId);
    const enter = async (origin?: KindeWorkoutOrigin) => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        const draft = await realm.openWorkoutDraft(origin);
        try {
            if (!witness.isCurrent()) { draft.close(); return; }
            // Adopt the exact snapshot before mounting any controls that edit it.
            if (!draft.initial.stale && !draft.initial.submitted) draft.write(draft.initial);
            persistenceBlocked.current = false;
            publish({ draft, isCurrent: witness.isCurrent, edit: draft.initial });
        } catch (reason) {
            draft.close();
            throw reason;
        }
    };
    const run = async (action: () => Promise<void>, message: string) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        setError(null);
        try { await action(); }
        catch (reason) {
            setError(isWorkoutClockAnomalyError(reason)
                ? 'L’orologio del dispositivo è cambiato. Correggi l’ora e riapri TheLogBook prima di terminare.'
                : message);
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    };
    const leave = () => {
        active.current?.draft.close();
        publish(null);
        setError(null);
    };
    const commit = async (closure?: KindeWorkoutClosure) => {
        const current = active.current;
        if (!current?.isCurrent()) throw new Error('Sessione della seduta cambiata.');
        if (persistenceBlocked.current) throw new Error('La bozza sul dispositivo deve essere verificata prima del commit.');
        const result = await (closure
            ? realm.closeWorkoutDraft(current.draft, closure)
            : realm.saveWorkoutDraft(current.draft));
        publish(null);
        if (closure) {
            resetWorkoutClockGuard(current.edit.workout.id);
            if (!result.draftCleared) setError('Archivio aggiornato. Una copia locale resta disponibile per il recupero.');
        } else if (result.outcome.kind !== 'local-pending' || navigator.onLine === false) {
            await enter();
        }
    };
    const deleteWorkout = async () => {
        const current = active.current;
        if (!current?.isCurrent() || inFlight.current) return false;
        let deleted = false;
        await run(async () => {
            if (!(await showConfirm('Eliminare questa seduta?')) || active.current !== current || !current.isCurrent()) return;
            await commit({ kind: 'delete' });
            deleted = true;
        }, 'Impossibile eliminare la seduta. La copia sul dispositivo è conservata.');
        return deleted;
    };
    const start = async (includeReadiness: boolean) => {
        if (persistenceBlocked.current) return;
        const startedAt = Date.now();
        if (!write(edit => ({
            ...edit,
            timer: stoppedWorkoutTimer(),
            workout: {
                ...edit.workout, date: getLocalDateString(startedAt), globalStartTime: startedAt,
                ...(includeReadiness && Object.values(edit.readiness).some(value => value !== undefined)
                    ? { readiness: { capturedAt: startedAt, ...edit.readiness } } : {}),
            },
        }))) return;
        await run(() => commit(), 'Avvio conservato sul dispositivo. Riapri l’archivio per verificare il salvataggio.');
    };

    const current = editor?.isCurrent() ? editor : null;
    const workout = current?.edit.workout;
    const review = current?.edit.review;
    const endedAt = review?.endedAt;
    const changeReview = (patch: Partial<NonNullable<KindeWorkoutEdit['review']>['values']>) =>
        write(edit => edit.review ? { ...edit, review: { ...edit.review, values: { ...edit.review.values, ...patch } } } : edit);
    const startReview = () => {
        if (persistenceBlocked.current) return;
        write(edit => ({
            ...edit,
            review: { endedAt: Date.now(), values: edit.review?.values ?? {
                mood: String(edit.workout.moodRating ?? ''), pump: String(edit.workout.pumpRating ?? ''),
                fatigue: String(edit.workout.fatigueRating ?? ''), water: String(edit.workout.waterLiters ?? ''),
                pains: edit.workout.pains ?? [],
            } },
        }));
    };

    return <section className="training-sub-view" aria-label="Allenamento account">
        <h2>Allenamento</h2>
        {error && <p role="alert">{error}</p>}
        {!current || !workout ? <>
            {data.activeWorkout && <p>In corso: {data.activeWorkout.routineName || 'Allenamento libero'}</p>}
            <button type="button" className="btn" disabled={pending}
                onClick={() => { void run(() => enter(), 'Nessuna seduta da riprendere oppure la copia è aperta in un’altra scheda.'); }}>
                Riprendi allenamento
            </button>
            {!data.activeWorkout && <TrainingSessionSetupView activeCycle={activeCycle}
                routines={data.routines ?? []} history={data.history ?? []}
                startWorkout={(routineId, cycle) => run(() => enter({ kind: 'routine', routineId, cycleId: cycle?.cycleId }),
                    'Impossibile preparare la scheda. Verifica il ciclo o la bozza esistente.')}
                startFreeWorkout={() => run(() => enter({ kind: 'free' }),
                    'Impossibile preparare un allenamento. Verifica la bozza esistente.')} />}
        </> : <>
            <button type="button" className="btn" disabled={pending} onClick={leave}>Chiudi e conserva seduta</button>
            {current.draft.initial.stale || current.draft.initial.submitted ? <>
                <p role="status">La seduta condivisa è cambiata o il salvataggio va verificato. La copia sul dispositivo è conservata.</p>
                <p>{workout.routineName}</p>
                <button type="button" className="btn btn-danger" disabled={pending} onClick={() => {
                    void run(async () => {
                        if (!await showConfirm('Scartare la copia locale della seduta?') || !current.isCurrent()) return;
                        current.draft.discard();
                        publish(null);
                    }, 'Impossibile scartare la copia sul dispositivo.');
                }}>Scarta copia locale</button>
            </> : <DurableWorkoutEditScope.Provider value={capture}>
                {workout.globalStartTime && !endedAt && <button type="button" className="btn" disabled={pending}
                    onClick={() => { void run(() => commit(), 'Sincronizzazione non confermata. La copia sul dispositivo è conservata.'); }}>
                    Sincronizza seduta
                </button>}
                {!workout.globalStartTime ? <WorkoutReadinessForm
                    routineName={workout.routineName} sleepHours={data.nutrition?.[workout.date ?? '']?.sleepHours}
                    activePains={data.activePains ?? []} values={current.edit.readiness} starting={pending} cancelling={false}
                    setMetric={(key, value) => {
                        write(edit => ({ ...edit, readiness: { ...edit.readiness,
                            [key]: edit.readiness[key] === value ? undefined : value } }));
                    }} start={start} cancel={async () => { await deleteWorkout(); }} />
                    : review && endedAt ? <PostSessionReview workout={workout} endTime={endedAt} draft={review.values}
                        onDraftChange={changeReview} onTogglePain={id => changeReview({ pains: review.values.pains.includes(id)
                            ? review.values.pains.filter(item => item !== id) : [...review.values.pains, id] })}
                        onFinish={() => run(() => commit({ kind: 'complete', endedAt }),
                            'Impossibile terminare la seduta. Le modifiche restano disponibili sul dispositivo.')}
                        onReturn={() => write(edit => ({ ...edit, review: { ...review, endedAt: null } }))} />
                    : <WorkoutSessionEditor
                        session={{ ...sets, activeWorkout: workout, library: data.library ?? [], history: data.history ?? [],
                            deleteWorkout,
                            updateSetupNote: async (id, notes) => {
                                const exercise = data.library?.find(item => item.id === id);
                                if (!exercise || !capture()?.()) return;
                                await run(async () => {
                                    const result = await realm.submit(exercise.isDefault
                                        ? { type: 'catalog.exercise.patch', id, patch: { notes } }
                                        : { type: 'exercise.edit', id, fields: { notes } });
                                    publish(null);
                                    if (result.kind !== 'local-pending' || navigator.onLine === false) await enter();
                                }, 'Impossibile salvare la nota. La seduta è conservata sul dispositivo.');
                            } }}
                        isCurrentTarget={(id, index, exerciseId) => {
                            const latest = read();
                            return Boolean(exerciseId && latest?.id === id && latest.exercises[index]?.id === exerciseId && capture()?.());
                        }} onRequestEnd={startReview}
                        restTimer={<WorkoutTimerControls key={workout.id} snapshot={current.edit.timer}
                            onChange={timer => write(edit => ({ ...edit, timer }))} />}
                        onClockAnomaly={reportClockAnomaly} />}
            </DurableWorkoutEditScope.Provider>}
        </>}
    </section>;
}
