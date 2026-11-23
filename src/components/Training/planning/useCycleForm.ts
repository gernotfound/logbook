import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Logic } from '../../../lib/logic';
import { MAX_EDITABLE_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK, previewCycleCount } from '../../../lib/calc/cycleLimits';
import {
    computeEndDate, computeWeeksFromDates, initialCycleForm, prepareCycleSubmission, type CycleEditorDraft,
} from '../../../lib/trainingCycleForm';
import type { TrainingCycle, TrainingCycleIntent, WorkoutRoutine } from '../../../types';

export { computeEndDate, computeWeeksFromDates } from '../../../lib/trainingCycleForm';

export type CycleFormPersistence =
    | { onSave: (cycleData: TrainingCycle) => void | Promise<void>; draft?: undefined }
    | {
        onSave?: undefined;
        draft: {
            values: CycleEditorDraft;
            canEdit: boolean;
            write: (values: CycleEditorDraft) => void;
            save: () => Promise<void>;
        };
    };

type UseCycleFormProps = CycleFormPersistence & {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    showAlert: (msg: string) => Promise<void>;
};

export function useCycleForm({ initialCycle, routines, onSave, showAlert, draft }: UseCycleFormProps) {
    const startDatePickerRef = useRef<HTMLInputElement>(null);
    const endDatePickerRef = useRef<HTMLInputElement>(null);
    const saving = useRef(false);
    const failedWrite = useRef(false);
    const [isSaving, setIsSaving] = useState(false);
    const [writeBlocked, setWriteBlocked] = useState(false);
    const [value, setValue] = useState(() => draft?.values ?? initialCycleForm(initialCycle));
    const observed = useRef(value);
    const [showSchedulePreview, setShowSchedulePreview] = useState(false);
    const { name, startDate, endDate, durationWeeks, sessionsPerWeek, cycleRoutines } = value;
    const canEdit = () => !saving.current && !failedWrite.current && draft?.canEdit !== false;

    const update = (change: (previous: CycleEditorDraft) => Partial<CycleEditorDraft> | null) => {
        if (!canEdit()) return;
        const previous = observed.current;
        const patch = change(previous);
        if (!patch || Object.entries(patch).every(([key, next]) => Object.is(previous[key as keyof CycleEditorDraft], next))) return;
        const next = { ...previous, ...patch };
        try {
            // A date edit and its derived fields are one durable draft image.
            draft?.write(next);
            observed.current = next;
            setValue(next);
        } catch {
            failedWrite.current = true;
            setWriteBlocked(true);
        }
    };
    const field = <K extends keyof CycleEditorDraft>(key: K, next: CycleEditorDraft[K]) =>
        update(() => ({ [key]: next }));

    const formatEnd = (date: string) => ({ endDate: date, endDateTextInput: Logic.formatItalianDate(date) });
    const fromStart = (previous: CycleEditorDraft, date: string, text: string) => ({
        startDate: date,
        dateTextInput: text,
        ...formatEnd(computeEndDate(date, previewCycleCount(previous.durationWeeks, 4, MAX_EDITABLE_CYCLE_WEEKS))),
    });
    const fromEnd = (previous: CycleEditorDraft, date: string, text: string) => ({
        endDate: date,
        endDateTextInput: text,
        ...(previous.startDate ? { durationWeeks: String(computeWeeksFromDates(previous.startDate, date)) } : {}),
    });

    const handleDurationWeeksChange = (text: string) => update(previous => {
        const weeks = Number(text);
        return {
            durationWeeks: text,
            ...(Number.isSafeInteger(weeks) && weeks >= 1 && previous.startDate
                ? formatEnd(computeEndDate(previous.startDate, weeks)) : {}),
        };
    });
    const handleStartDateTextChange = (event: ChangeEvent<HTMLInputElement>) => {
        const text = event.target.value;
        const date = Logic.parseDateInput(text);
        update(previous => date ? fromStart(previous, date, text) : { dateTextInput: text });
    };
    const handleStartDateTextBlur = () => update(previous => {
        const date = Logic.parseDateInput(previous.dateTextInput);
        if (date) return fromStart(previous, date, Logic.formatItalianDate(date));
        return previous.startDate ? { dateTextInput: Logic.formatItalianDate(previous.startDate) } : null;
    });
    const handleStartCalendarDateChange = (event: ChangeEvent<HTMLInputElement>) => {
        const date = event.target.value;
        if (date) update(previous => fromStart(previous, date, Logic.formatItalianDate(date)));
    };
    const handleEndDateTextChange = (event: ChangeEvent<HTMLInputElement>) => {
        const text = event.target.value;
        const date = Logic.parseDateInput(text);
        update(previous => date ? fromEnd(previous, date, text) : { endDateTextInput: text });
    };
    const handleEndDateTextBlur = () => update(previous => {
        const date = Logic.parseDateInput(previous.endDateTextInput);
        if (date) return fromEnd(previous, date, Logic.formatItalianDate(date));
        return previous.endDate ? { endDateTextInput: Logic.formatItalianDate(previous.endDate) } : null;
    });
    const handleEndCalendarDateChange = (event: ChangeEvent<HTMLInputElement>) => {
        const date = event.target.value;
        if (date) update(previous => fromEnd(previous, date, Logic.formatItalianDate(date)));
    };
    const openCalendar = (input: HTMLInputElement | null) => {
        if (!input || !canEdit()) return;
        if (typeof input.showPicker === 'function') {
            try { input.showPicker(); return; }
            catch { /* Fall back to the native control focus. */ }
        }
        input.focus();
    };

    const handleAddRoutineById = (routineId: string) => update(previous => {
        const list = previous.cycleRoutines;
        if (!routineId || list.some(item => item.routineId === routineId)) return null;
        return {
            cycleRoutines: [...list, { routineId, frequencyPerWeek: 1 }],
            ...(!initialCycle?.sessionsPerWeek && parseInt(previous.sessionsPerWeek, 10) === list.length
                ? { sessionsPerWeek: String(list.length + 1) } : {}),
        };
    });
    const handleMoveRoutine = (routineId: string, direction: -1 | 1) => update(previous => {
        const list = previous.cycleRoutines;
        const index = list.findIndex(item => item.routineId === routineId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= list.length) return null;
        const next = [...list];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        return { cycleRoutines: next };
    });
    const handleRemoveRoutine = (routineId: string) => update(previous => ({
        cycleRoutines: previous.cycleRoutines.filter(item => item.routineId !== routineId),
    }));
    const handleStrategyIntentChange = (intent: TrainingCycleIntent | '') => update(previous => ({
        strategyIntent: intent, progressionFocus: intent === 'development' ? previous.progressionFocus : '',
    }));
    const handleAddPriorityMuscle = (priority: 'primary' | 'secondary', muscleId: string) => {
        if (!muscleId) return;
        const target = priority === 'primary' ? 'primaryMuscles' : 'secondaryMuscles';
        const other = priority === 'primary' ? 'secondaryMuscles' : 'primaryMuscles';
        update(previous => {
            const alreadySelected = previous[target].includes(muscleId);
            if (alreadySelected && !previous[other].includes(muscleId)) return null;
            return {
                [target]: alreadySelected ? previous[target] : [...previous[target], muscleId],
                [other]: previous[other].filter(id => id !== muscleId),
            };
        });
    };
    const handleRemovePriorityMuscle = (priority: 'primary' | 'secondary', muscleId: string) => {
        const target = priority === 'primary' ? 'primaryMuscles' : 'secondaryMuscles';
        update(previous => ({ [target]: previous[target].filter(id => id !== muscleId) }));
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!canEdit()) return;
        const prepared = prepareCycleSubmission(observed.current);
        if (!prepared.ok) {
            await showAlert(prepared.message);
            return;
        }
        saving.current = true;
        setIsSaving(true);
        try {
            if (draft) await draft.save();
            else await onSave({
                ...prepared.fields,
                id: initialCycle?.id || Logic.generateId('cycle'),
                progressionMode: initialCycle?.progressionMode ?? 'sequential',
                createdAt: initialCycle?.createdAt || Date.now(),
                isActive: initialCycle?.isActive ?? false,
            });
        } catch (error) {
            if (!draft) console.error('Errore salvataggio ciclo:', error);
            await showAlert(draft
                ? 'Impossibile salvare il ciclo. La bozza cifrata resta sul dispositivo.'
                : 'Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.');
        } finally {
            saving.current = false;
            setIsSaving(false);
        }
    };

    const tempWeeks = previewCycleCount(durationWeeks, 4, MAX_EDITABLE_CYCLE_WEEKS);
    const tempFreq = previewCycleCount(sessionsPerWeek, cycleRoutines.length || 1, MAX_CYCLE_SESSIONS_PER_WEEK);
    const preview = useMemo<TrainingCycle>(() => ({
        id: 'preview', name: name || 'Ciclo', durationWeeks: tempWeeks, sessionsPerWeek: tempFreq,
        startDate: startDate || undefined, endDate: endDate || undefined, routines: cycleRoutines,
    }), [name, tempWeeks, tempFreq, startDate, endDate, cycleRoutines]);
    const timeline = useMemo(() => Logic.calculateCycleTimeline(preview), [preview]);
    const schedule = useMemo(() => Logic.calculateCycleSchedule(preview, routines, showSchedulePreview),
        [preview, routines, showSchedulePreview]);

    return {
        refs: { startDatePickerRef, endDatePickerRef },
        state: {
            ...value,
            setName: (next: string) => field('name', next),
            setStartDate: (next: string) => field('startDate', next),
            setEndDate: (next: string) => field('endDate', next),
            setDurationWeeks: (next: string) => field('durationWeeks', next),
            setSessionsPerWeek: (next: string) => field('sessionsPerWeek', next),
            setNotes: (next: string) => field('notes', next),
            setProgressionFocus: (next: CycleEditorDraft['progressionFocus']) => field('progressionFocus', next),
            setCycleRoutines: (next: CycleEditorDraft['cycleRoutines']) => field('cycleRoutines', next),
            showSchedulePreview, setShowSchedulePreview, isSaving, writeBlocked, tempWeeks, tempFreq,
        },
        computed: { timeline, schedule },
        handlers: {
            handleDurationWeeksChange,
            handleStartDateTextChange, handleStartDateTextBlur, handleStartCalendarDateChange,
            handleEndDateTextChange, handleEndDateTextBlur, handleEndCalendarDateChange,
            handleOpenStartCalendar: () => openCalendar(startDatePickerRef.current),
            handleOpenEndCalendar: () => openCalendar(endDatePickerRef.current),
            handleAddRoutineById, handleMoveRoutine, handleRemoveRoutine, handleStrategyIntentChange,
            handleAddPriorityMuscle, handleRemovePriorityMuscle, handleSubmit,
        },
    };
}
