// Responsabilità: gestire lo stato del form per la creazione e modifica di un ciclo di allenamento.
// Props: initialCycle (TrainingCycle), routines (WorkoutRoutine[]), onSave (callback), showAlert (callback).
// Effetti: non salva sul DB, chiama onSave passando l'oggetto ciclo completato.

import { useState, useRef, useMemo } from 'react';
import { Logic } from '../../../lib/logic';
import { MAX_EDITABLE_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK, previewCycleCount } from '../../../lib/calc/cycleLimits';
import { computeEndDate, computeWeeksFromDates, prepareCycleSubmission } from './cycleFormModel';
import type {
    TrainingCycle,
    TrainingCycleIntent,
    TrainingCycleProgressionFocus,
    TrainingCycleRoutineItem,
    WorkoutRoutine,
} from '../../../types';

export { computeEndDate, computeWeeksFromDates } from './cycleFormModel';

export interface UseCycleFormProps {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    onSave: (cycleData: TrainingCycle) => void | Promise<void>;
    showAlert: (msg: string) => Promise<void>;
}

export function useCycleForm({ initialCycle, routines, onSave, showAlert }: UseCycleFormProps) {
    const startDatePickerRef = useRef<HTMLInputElement>(null);
    const saveInFlightRef = useRef(false);
    const [isSaving, setIsSaving] = useState(false);
    const endDatePickerRef = useRef<HTMLInputElement>(null);

    const initialIso = initialCycle?.startDate || Logic.getLocalDateString();
    const initialWeeksNum = initialCycle?.durationWeeks !== undefined ? initialCycle.durationWeeks : 6;
    const initialEndIso = initialCycle?.endDate || computeEndDate(initialIso, initialWeeksNum);

    const [name, setName] = useState(initialCycle?.name || '');
    const [startDate, setStartDate] = useState(initialIso);
    const [dateTextInput, setDateTextInput] = useState(Logic.formatItalianDate(initialIso));
    const [endDate, setEndDate] = useState(initialEndIso);
    const [endDateTextInput, setEndDateTextInput] = useState(Logic.formatItalianDate(initialEndIso));
    const [durationWeeks, setDurationWeeks] = useState(String(initialWeeksNum));
    const [sessionsPerWeek, setSessionsPerWeek] = useState(
        initialCycle?.sessionsPerWeek !== undefined
            ? String(initialCycle.sessionsPerWeek)
            : String(initialCycle?.routines?.length || 4)
    );
    const [notes, setNotes] = useState(initialCycle?.notes || '');
    const [strategyIntent, setStrategyIntent] = useState<TrainingCycleIntent | ''>(
        initialCycle?.strategy?.intent ?? ''
    );
    const [progressionFocus, setProgressionFocus] = useState<TrainingCycleProgressionFocus | ''>(initialCycle?.strategy?.progressionFocus ?? '');
    const [primaryMuscles, setPrimaryMuscles] = useState<string[]>([...(initialCycle?.strategy?.primaryMuscles ?? [])]);
    const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([...(initialCycle?.strategy?.secondaryMuscles ?? [])]);
    const [cycleRoutines, setCycleRoutines] = useState<TrainingCycleRoutineItem[]>(
        initialCycle?.routines ? structuredClone(initialCycle.routines) : []
    );
    const [showSchedulePreview, setShowSchedulePreview] = useState(false);

    const handleDurationWeeksChange = (val: string) => {
        setDurationWeeks(val);
        const w = Number(val);
        if (Number.isSafeInteger(w) && w >= 1 && startDate) {
            const newEnd = computeEndDate(startDate, w);
            setEndDate(newEnd);
            setEndDateTextInput(Logic.formatItalianDate(newEnd));
        }
    };

    const handleStartDateTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setDateTextInput(val);
        const parsedIso = Logic.parseDateInput(val);
        if (parsedIso) {
            setStartDate(parsedIso);
            const w = previewCycleCount(durationWeeks, 4, MAX_EDITABLE_CYCLE_WEEKS);
            const newEnd = computeEndDate(parsedIso, w);
            setEndDate(newEnd);
            setEndDateTextInput(Logic.formatItalianDate(newEnd));
        }
    };

    const handleStartDateTextBlur = () => {
        const parsedIso = Logic.parseDateInput(dateTextInput);
        if (parsedIso) {
            setStartDate(parsedIso);
            setDateTextInput(Logic.formatItalianDate(parsedIso));
            const w = previewCycleCount(durationWeeks, 4, MAX_EDITABLE_CYCLE_WEEKS);
            const newEnd = computeEndDate(parsedIso, w);
            setEndDate(newEnd);
            setEndDateTextInput(Logic.formatItalianDate(newEnd));
        } else if (startDate) {
            // Preserve the existing blur recovery contract for incomplete text input.
            setDateTextInput(Logic.formatItalianDate(startDate));
        }
    };

    const handleStartCalendarDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val) {
            setStartDate(val);
            setDateTextInput(Logic.formatItalianDate(val));
            const w = previewCycleCount(durationWeeks, 4, MAX_EDITABLE_CYCLE_WEEKS);
            const newEnd = computeEndDate(val, w);
            setEndDate(newEnd);
            setEndDateTextInput(Logic.formatItalianDate(newEnd));
        }
    };

    const handleEndDateTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setEndDateTextInput(val);
        const parsedIso = Logic.parseDateInput(val);
        if (parsedIso) {
            setEndDate(parsedIso);
            if (startDate) {
                const w = computeWeeksFromDates(startDate, parsedIso);
                setDurationWeeks(String(w));
            }
        }
    };

    const handleEndDateTextBlur = () => {
        const parsedIso = Logic.parseDateInput(endDateTextInput);
        if (parsedIso) {
            setEndDate(parsedIso);
            setEndDateTextInput(Logic.formatItalianDate(parsedIso));
            if (startDate) {
                const w = computeWeeksFromDates(startDate, parsedIso);
                setDurationWeeks(String(w));
            }
        } else if (endDate) {
            setEndDateTextInput(Logic.formatItalianDate(endDate));
        }
    };

    const handleEndCalendarDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val) {
            setEndDate(val);
            setEndDateTextInput(Logic.formatItalianDate(val));
            if (startDate) {
                const w = computeWeeksFromDates(startDate, val);
                setDurationWeeks(String(w));
            }
        }
    };

    const handleOpenStartCalendar = () => {
        if (startDatePickerRef.current) {
            if (typeof startDatePickerRef.current.showPicker === 'function') {
                try {
                    startDatePickerRef.current.showPicker();
                } catch {
                    startDatePickerRef.current.focus();
                }
            } else {
                startDatePickerRef.current.focus();
            }
        }
    };

    const handleOpenEndCalendar = () => {
        if (endDatePickerRef.current) {
            if (typeof endDatePickerRef.current.showPicker === 'function') {
                try {
                    endDatePickerRef.current.showPicker();
                } catch {
                    endDatePickerRef.current.focus();
                }
            } else {
                endDatePickerRef.current.focus();
            }
        }
    };

    const handleAddRoutineById = (routineId: string) => {
        if (!routineId || cycleRoutines.some(item => item.routineId === routineId)) return;
        setCycleRoutines(prev => prev.some(item => item.routineId === routineId)
            ? prev : [...prev, { routineId, frequencyPerWeek: 1 }]);
        const newCount = cycleRoutines.length + 1;
        if (!initialCycle?.sessionsPerWeek && parseInt(sessionsPerWeek, 10) === cycleRoutines.length) {
            setSessionsPerWeek(String(newCount));
        }
    };

    const handleMoveRoutine = (routineId: string, direction: -1 | 1) => {
        setCycleRoutines(prev => {
            // A queued remove/reorder can change positions before this updater
            // runs; resolve the stable business identity against current state.
            const index = prev.findIndex(item => item.routineId === routineId);
            const targetIndex = index + direction;
            if (index < 0 || targetIndex < 0 || targetIndex >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(index, 1);
            next.splice(targetIndex, 0, moved);
            return next;
        });
    };

    const handleRemoveRoutine = (routineId: string) => {
        setCycleRoutines(prev => prev.filter(item => item.routineId !== routineId));
    };

    const handleStrategyIntentChange = (intent: TrainingCycleIntent | '') => {
        setStrategyIntent(intent);
        if (intent !== 'development') setProgressionFocus('');
    };

    const handleAddPriorityMuscle = (priority: 'primary' | 'secondary', muscleId: string) => {
        if (!muscleId) return;
        if (priority === 'primary') {
            setPrimaryMuscles(prev => prev.includes(muscleId) ? prev : [...prev, muscleId]);
            setSecondaryMuscles(prev => prev.filter(id => id !== muscleId));
            return;
        }
        setSecondaryMuscles(prev => prev.includes(muscleId) ? prev : [...prev, muscleId]);
        setPrimaryMuscles(prev => prev.filter(id => id !== muscleId));
    };

    const handleRemovePriorityMuscle = (priority: 'primary' | 'secondary', muscleId: string) => {
        if (priority === 'primary') {
            setPrimaryMuscles(prev => prev.filter(id => id !== muscleId));
            return;
        }
        setSecondaryMuscles(prev => prev.filter(id => id !== muscleId));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saveInFlightRef.current) return;
        const prepared = prepareCycleSubmission({
            name,
            cycleRoutines,
            strategyIntent,
            progressionFocus,
            durationWeeks,
            sessionsPerWeek,
            dateTextInput,
            endDateTextInput,
            notes,
            primaryMuscles,
            secondaryMuscles,
        });
        if (!prepared.ok) {
            await showAlert(prepared.message);
            return;
        }
        const fields = prepared.fields;
        const cycle: TrainingCycle = {
            id: initialCycle?.id || Logic.generateId('cycle'),
            name: fields.name,
            durationWeeks: fields.durationWeeks,
            sessionsPerWeek: fields.sessionsPerWeek,
            progressionMode: initialCycle?.progressionMode ?? 'sequential',
            startDate: fields.startDate,
            endDate: fields.endDate,
            notes: fields.notes,
            ...(fields.strategy ? { strategy: fields.strategy } : {}),
            routines: fields.routines,
            createdAt: initialCycle?.createdAt || Date.now(),
            isActive: initialCycle?.isActive ?? false,
        };

        // A rapid second submit must not enqueue another upsert (or generate
        // a different ID for a new cycle) before the first durable save settles.
        if (saveInFlightRef.current) return;
        saveInFlightRef.current = true;
        setIsSaving(true);
        try {
            await onSave(cycle);
        } catch (error) {
            console.error('Errore salvataggio ciclo:', error);
            await showAlert('Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.');
        } finally {
            saveInFlightRef.current = false;
            setIsSaving(false);
        }
    };

    // Preview may be bounded while the form keeps the original invalid input
    // visible so it can be corrected rather than silently saved or truncated.
    const tempWeeks = previewCycleCount(durationWeeks, 4, MAX_EDITABLE_CYCLE_WEEKS);
    const tempFreq = previewCycleCount(sessionsPerWeek, cycleRoutines.length || 1, MAX_CYCLE_SESSIONS_PER_WEEK);

    const timeline = useMemo(() => {
        return Logic.calculateCycleTimeline({
            id: 'preview',
            name: name || 'Ciclo',
            durationWeeks: tempWeeks,
            sessionsPerWeek: tempFreq,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            routines: cycleRoutines
        });
    }, [name, tempWeeks, tempFreq, startDate, endDate, cycleRoutines]);

    const schedule = useMemo(() => {
        return Logic.calculateCycleSchedule({
            id: 'preview',
            name: name || 'Ciclo',
            durationWeeks: tempWeeks,
            sessionsPerWeek: tempFreq,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            routines: cycleRoutines
        }, routines, showSchedulePreview);
    }, [name, tempWeeks, tempFreq, startDate, endDate, cycleRoutines, routines, showSchedulePreview]);

    return {
        refs: { startDatePickerRef, endDatePickerRef },
        state: {
            name, setName,
            startDate, setStartDate,
            dateTextInput,
            endDate, setEndDate,
            endDateTextInput,
            durationWeeks, setDurationWeeks,
            sessionsPerWeek, setSessionsPerWeek,
            notes, setNotes,
            strategyIntent,
            progressionFocus, setProgressionFocus,
            primaryMuscles,
            secondaryMuscles,
            cycleRoutines, setCycleRoutines,
            showSchedulePreview, setShowSchedulePreview,
            isSaving,
            tempWeeks, tempFreq
        },
        computed: { timeline, schedule },
        handlers: {
            handleDurationWeeksChange,
            handleStartDateTextChange,
            handleStartDateTextBlur,
            handleStartCalendarDateChange,
            handleEndDateTextChange,
            handleEndDateTextBlur,
            handleEndCalendarDateChange,
            handleOpenStartCalendar,
            handleOpenEndCalendar,
            handleAddRoutineById,
            handleMoveRoutine,
            handleRemoveRoutine,
            handleStrategyIntentChange,
            handleAddPriorityMuscle,
            handleRemovePriorityMuscle,
            handleSubmit
        }
    };
}