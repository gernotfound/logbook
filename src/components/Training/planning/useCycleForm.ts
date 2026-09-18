// Responsabilità: gestire lo stato del form per la creazione e modifica di un ciclo di allenamento.
// Props: initialCycle (TrainingCycle), routines (WorkoutRoutine[]), onSave (callback), showAlert (callback).
// Effetti: non salva sul DB, chiama onSave passando l'oggetto ciclo completato.

import { useState, useEffect, useRef, useMemo } from 'react';
import { addDays, differenceInCalendarDays, parseISO, format, isValid, startOfDay } from 'date-fns';
import { Logic } from '../../../lib/logic';
import type { TrainingCycle, WorkoutRoutine, TrainingCycleRoutineItem } from '../../../types';

function computeEndDate(startIso: string, weeks: number): string {
    try {
        const parsed = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        if (!isValid(parsed)) return startIso;
        const totalWeeks = Math.max(1, weeks);
        const end = addDays(startOfDay(parsed), totalWeeks * 7 - 1);
        return format(end, 'yyyy-MM-dd');
    } catch {
        return startIso;
    }
}

function computeWeeksFromDates(startIso: string, endIso: string): number {
    try {
        const start = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        const end = typeof endIso === 'string' && !endIso.includes('T') ? parseISO(endIso) : new Date(endIso);
        if (!isValid(start) || !isValid(end)) return 1;
        const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
        if (diffDays < 0) return 1;
        return Math.max(1, Math.round((diffDays + 1) / 7));
    } catch {
        return 1;
    }
}

export interface UseCycleFormProps {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    onSave: (cycleData: TrainingCycle) => void | Promise<void>;
    showAlert: (msg: string) => Promise<void>;
}

export function useCycleForm({ initialCycle, routines, onSave, showAlert }: UseCycleFormProps) {
    const startDatePickerRef = useRef<HTMLInputElement>(null);
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
    const [cycleRoutines, setCycleRoutines] = useState<TrainingCycleRoutineItem[]>(
        initialCycle?.routines ? structuredClone(initialCycle.routines) : []
    );
    const [showSchedulePreview, setShowSchedulePreview] = useState(false);

    useEffect(() => {
        if (initialCycle) {
            setName(initialCycle.name || '');
            const iso = initialCycle.startDate || Logic.getLocalDateString();
            const weeksNum = initialCycle.durationWeeks !== undefined ? initialCycle.durationWeeks : 6;
            const endIso = initialCycle.endDate || computeEndDate(iso, weeksNum);
            setStartDate(iso);
            setDateTextInput(Logic.formatItalianDate(iso));
            setEndDate(endIso);
            setEndDateTextInput(Logic.formatItalianDate(endIso));
            setDurationWeeks(String(weeksNum));
            setSessionsPerWeek(
                initialCycle.sessionsPerWeek !== undefined
                    ? String(initialCycle.sessionsPerWeek)
                    : String(initialCycle.routines?.length || 4)
            );
            setNotes(initialCycle.notes || '');
            setCycleRoutines(initialCycle.routines ? structuredClone(initialCycle.routines) : []);
        }
    }, [initialCycle]);

    const handleDurationWeeksChange = (val: string) => {
        setDurationWeeks(val);
        const w = parseInt(val, 10);
        if (!isNaN(w) && w >= 1 && startDate) {
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
            const w = Math.max(1, parseInt(durationWeeks, 10) || 4);
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
            const w = Math.max(1, parseInt(durationWeeks, 10) || 4);
            const newEnd = computeEndDate(parsedIso, w);
            setEndDate(newEnd);
            setEndDateTextInput(Logic.formatItalianDate(newEnd));
        } else if (startDate) {
            setDateTextInput(Logic.formatItalianDate(startDate));
        }
    };

    const handleStartCalendarDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val) {
            setStartDate(val);
            setDateTextInput(Logic.formatItalianDate(val));
            const w = Math.max(1, parseInt(durationWeeks, 10) || 4);
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
        if (!routineId) return;
        setCycleRoutines(prev => [
            ...prev,
            { routineId, frequencyPerWeek: 1 }
        ]);
        const newCount = cycleRoutines.length + 1;
        if (!initialCycle?.sessionsPerWeek && parseInt(sessionsPerWeek, 10) === cycleRoutines.length) {
            setSessionsPerWeek(String(newCount));
        }
    };

    const handleMoveRoutine = (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= cycleRoutines.length) return;
        setCycleRoutines(prev => {
            const next = [...prev];
            const [moved] = next.splice(index, 1);
            next.splice(targetIndex, 0, moved);
            return next;
        });
    };

    const handleRemoveRoutine = (index: number) => {
        setCycleRoutines(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            await showAlert("Inserisci un nome per il ciclo di allenamento.");
            return;
        }

        if (cycleRoutines.length === 0) {
            await showAlert("Aggiungi almeno una scheda al ciclo di allenamento.");
            return;
        }

        const weeks = Math.max(1, parseInt(durationWeeks, 10) || 4);
        const freqPerWeek = Math.max(1, parseInt(sessionsPerWeek, 10) || cycleRoutines.length);
        const validStartDate = Logic.parseDateInput(dateTextInput) || startDate || undefined;
        const validEndDate = Logic.parseDateInput(endDateTextInput) || endDate || (validStartDate ? computeEndDate(validStartDate, weeks) : undefined);

        const cycle: TrainingCycle = {
            id: initialCycle?.id || Logic.generateId('cycle'),
            name: trimmedName,
            durationWeeks: weeks,
            sessionsPerWeek: freqPerWeek,
            progressionMode: 'sequential',
            startDate: validStartDate,
            endDate: validEndDate,
            notes: notes.trim(),
            routines: cycleRoutines,
            createdAt: initialCycle?.createdAt || Date.now(),
            isActive: initialCycle?.isActive ?? false
        };

        await onSave(cycle);
    };

    const tempWeeks = Math.max(1, parseInt(durationWeeks, 10) || 4);
    const tempFreq = Math.max(1, parseInt(sessionsPerWeek, 10) || cycleRoutines.length || 1);

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
        }, routines);
    }, [name, tempWeeks, tempFreq, startDate, endDate, cycleRoutines, routines]);

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
            cycleRoutines, setCycleRoutines,
            showSchedulePreview, setShowSchedulePreview,
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
            handleSubmit
        }
    };
}