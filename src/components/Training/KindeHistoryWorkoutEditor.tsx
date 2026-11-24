import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KindeHistoryWorkoutDraft, KindeHistoryWorkoutEdit } from '../../lib/auth/kindeCandidateHistoryWorkoutDraft';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useWorkoutSetMutations } from '../../hooks/workout/useWorkoutSetMutations';
import { parseOptionalWaterLiters } from '../../hooks/workout/workoutSessionPreparation';
import { parseManualDuration } from '../../lib/utils/duration';
import { useDialogStore } from '../../store/useDialogStore';
import type { WorkoutSession } from '../../types';
import { DurableWorkoutEditScope } from '../UI/bufferedWorkoutScope';
import { WorkoutSessionEditor } from './WorkoutSessionEditor';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

export function KindeHistoryWorkoutEditor({ draft, isCurrent, realm, onClose }: {
    draft: KindeHistoryWorkoutDraft;
    isCurrent: () => boolean;
    realm: Realm;
    onClose: () => void;
}) {
    const [edit, setEdit] = useState<KindeHistoryWorkoutEdit>(draft.initial);
    const edited = useRef<KindeHistoryWorkoutEdit>(draft.initial);
    const mounted = useRef(false);
    const busy = useRef(false);
    const persistenceBlocked = useRef(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const canEdit = !draft.initial.stale && !draft.initial.submitted;

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const capture = useCallback(() => {
        const current = () => mounted.current && !busy.current && isCurrent();
        return canEdit && current() ? current : null;
    }, [canEdit, isCurrent]);
    const read = useCallback(() => capture()?.() ? edited.current.workout : null, [capture]);
    const write = useCallback((update: (current: KindeHistoryWorkoutEdit) => KindeHistoryWorkoutEdit) => {
        if (!capture()?.()) return;
        try {
            const next = update(edited.current);
            if (next === edited.current) return;
            draft.write(next);
            edited.current = next;
            persistenceBlocked.current = false;
            setEdit(next);
            setError(null);
        } catch {
            persistenceBlocked.current = true;
            setError('Modifica non salvata sul dispositivo. La copia precedente è conservata.');
        }
    }, [capture, draft]);
    const mutateWorkout = useCallback((update: (workout: WorkoutSession | null) => WorkoutSession | null) => {
        write(current => {
            const workout = update(current.workout);
            return workout && workout !== current.workout ? { ...current, workout } : current;
        });
    }, [write]);
    const scope = useMemo(() => ({ read, capture }), [read, capture]);
    const sets = useWorkoutSetMutations({ setLocalWorkout: mutateWorkout, showConfirm, scope });

    if (realm.state.phase !== 'ready') return null;
    const { library = [], history = [] } = realm.state.snapshot.data;
    const save = async () => {
        if (!capture()?.() || persistenceBlocked.current) return false;
        const current = edited.current;
        if (parseManualDuration(current.workout.manualDurationStr) === null) {
            setError('Usa una durata valida, per esempio 00:45:00.');
            return false;
        }
        if (current.ratings.water.trim() && parseOptionalWaterLiters(current.ratings.water) === undefined) {
            setError('Inserisci una quantità di acqua valida.');
            return false;
        }
        busy.current = true;
        setSaving(true);
        try {
            await realm.saveHistoryWorkoutDraft(draft);
            return true;
        } catch {
            if (isCurrent()) setError('Salvataggio non confermato. La bozza sul dispositivo è conservata.');
            return false;
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };
    const discard = async () => {
        if (busy.current || !isCurrent()) return false;
        busy.current = true;
        try {
            if (!(await showConfirm('Scartare la bozza di modifica dello storico?')) || !mounted.current || !isCurrent()) return false;
            draft.discard();
            return true;
        } catch {
            if (isCurrent()) setError('Impossibile scartare la bozza. Copia conservata.');
            return false;
        } finally { busy.current = false; }
    };
    const setRating = (field: keyof KindeHistoryWorkoutEdit['ratings'], value: string) =>
        write(current => ({ ...current, ratings: { ...current.ratings, [field]: value } }));
    const updatePains = (update: (pains: string[]) => string[]) =>
        mutateWorkout(workout => workout && { ...workout, pains: update(workout.pains ?? []) });

    return <section aria-label="Editor dello storico allenamenti">
        <button type="button" className="btn" disabled={saving} onClick={() => {
            if (busy.current) return;
            draft.close();
            onClose();
        }}>Chiudi e conserva bozza</button>
        {error && <p role="alert">{error}</p>}
        {canEdit ? <DurableWorkoutEditScope.Provider value={capture}>
            <WorkoutSessionEditor session={{
                ...sets, activeWorkout: edit.workout, library, history,
                deleteWorkout: discard,
                updateSetupNote: async (id, notes) => {
                    const exercise = library.find(item => item.id === id);
                    if (!exercise || !capture()?.()) return;
                    busy.current = true;
                    try {
                        await realm.submit(exercise.isDefault
                            ? { type: 'catalog.exercise.patch', id, patch: { notes } }
                            : { type: 'exercise.edit', id, fields: { notes } });
                        onClose();
                    } catch {
                        if (isCurrent()) setError('Impossibile salvare la nota. La bozza dello storico è conservata.');
                    } finally { busy.current = false; }
                },
            }} historyEditor={{
                historySaving: saving, saveHistoryEdit: save, cancelHistoryEdit: discard,
                mood: edit.ratings.mood, setMood: value => setRating('mood', value),
                pump: edit.ratings.pump, setPump: value => setRating('pump', value),
                fatigue: edit.ratings.fatigue, setFatigue: value => setRating('fatigue', value),
                water: edit.ratings.water, setWater: value => setRating('water', value),
                manualDuration: edit.workout.manualDurationStr ?? '',
                setManualDuration: manualDurationStr => mutateWorkout(workout => workout && { ...workout, manualDurationStr }),
                pains: edit.workout.pains ?? [],
                setPains: pains => updatePains(() => pains),
                togglePain: id => updatePains(pains => pains.includes(id) ? pains.filter(value => value !== id) : [...pains, id]),
            }} isCurrentTarget={(id, index, exerciseId) => {
                const workout = read();
                return Boolean(exerciseId && workout?.id === id && workout.exercises[index]?.id === exerciseId);
            }} onNavigateToHistory={onClose} />
        </DurableWorkoutEditScope.Provider> : <>
            <p role="status">La seduta dello storico è cambiata o il salvataggio va verificato. La bozza è conservata.</p>
            <p>{edit.workout.routineName}</p>
            <button type="button" className="btn btn-danger" onClick={() => {
                void discard().then(discarded => { if (discarded) onClose(); });
            }}>Scarta bozza dello storico</button>
        </>}
    </section>;
}
