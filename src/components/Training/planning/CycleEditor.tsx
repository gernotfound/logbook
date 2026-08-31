import React, { useState, useEffect, useRef, useMemo } from 'react';
import { addDays, differenceInCalendarDays, parseISO, format, isValid, startOfDay } from 'date-fns';
import { Logic } from '../../../lib/logic';
import { useDialogStore } from '../../../store/useDialogStore';
import type { TrainingCycle, WorkoutRoutine, TrainingCycleRoutineItem } from '../../../types';

interface CycleEditorProps {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    onSave: (cycleData: TrainingCycle) => void;
    onCancel: () => void;
}

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

export const CycleEditor: React.FC<CycleEditorProps> = ({
    initialCycle,
    routines,
    onSave,
    onCancel
}) => {
    const showAlert = useDialogStore(state => state.showAlert);
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

        onSave(cycle);
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

    return (
        <form onSubmit={handleSubmit} className="card mb-20" style={{ border: '1px solid var(--primary-color)' }}>
            <div className="flex-between mb-15 items-center">
                <h2 className="m-0" style={{color: 'var(--primary-color)'}}>
                    {initialCycle ? '✏️ Modifica ciclo' : '➕ Nuovo ciclo di allenamento'}
                </h2>
                <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={onCancel}
                    style={{ marginBottom: 0 }}
                >
                    ✕ Chiudi
                </button>
            </div>

            <div className="mb-15">
                <label htmlFor="cycle-name" className="text-xs text-muted font-bold block mb-4">
                    Nome ciclo
                </label>
                <input
                    id="cycle-name"
                    type="text"
                    placeholder="Es. Mesociclo ipertrofia 4 giorni"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onFocus={e => e.target.select()}
                    required
                    style={{ width: '100%', fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                />
            </div>

            <div className="grid-2 gap-15 mb-15">
                <div>
                    <label htmlFor="cycle-start-date" className="text-xs text-muted font-bold block mb-4">
                        Data di inizio
                    </label>
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: '8px', minWidth: 0 }}>
                        <input
                            id="cycle-start-date"
                            type="text"
                            placeholder="GG/MM/AAAA"
                            value={dateTextInput}
                            onChange={handleStartDateTextChange}
                            onBlur={handleStartDateTextBlur}
                            onFocus={e => e.target.select()}
                            required
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '16px',
                                boxSizing: 'border-box',
                                maxWidth: '100%',
                                display: 'block'
                            }}
                        />
                        <div style={{ position: 'relative', flexShrink: 0, width: '46px' }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleOpenStartCalendar}
                                title="Scegli data di inizio dal calendario"
                                aria-label="Scegli data di inizio dal calendario"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    padding: 0,
                                    fontSize: '1.2rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginBottom: 0,
                                    borderRadius: '8px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    cursor: 'pointer'
                                }}
                            >
                                📅
                            </button>
                            <input
                                ref={startDatePickerRef}
                                type="date"
                                value={startDate}
                                onChange={handleStartCalendarDateChange}
                                tabIndex={-1}
                                aria-label="Scegli data di inizio dal calendario"
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    opacity: 0,
                                    pointerEvents: 'auto',
                                    cursor: 'pointer',
                                    fontSize: '16px'
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div>
                    <label htmlFor="cycle-end-date" className="text-xs text-muted font-bold block mb-4">
                        Data di fine
                    </label>
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: '8px', minWidth: 0 }}>
                        <input
                            id="cycle-end-date"
                            type="text"
                            placeholder="GG/MM/AAAA"
                            value={endDateTextInput}
                            onChange={handleEndDateTextChange}
                            onBlur={handleEndDateTextBlur}
                            onFocus={e => e.target.select()}
                            required
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '16px',
                                boxSizing: 'border-box',
                                maxWidth: '100%',
                                display: 'block'
                            }}
                        />
                        <div style={{ position: 'relative', flexShrink: 0, width: '46px' }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleOpenEndCalendar}
                                title="Scegli data di fine dal calendario"
                                aria-label="Scegli data di fine dal calendario"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    padding: 0,
                                    fontSize: '1.2rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginBottom: 0,
                                    borderRadius: '8px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    cursor: 'pointer'
                                }}
                            >
                                📅
                            </button>
                            <input
                                ref={endDatePickerRef}
                                type="date"
                                value={endDate}
                                onChange={handleEndCalendarDateChange}
                                tabIndex={-1}
                                aria-label="Scegli data di fine dal calendario"
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    opacity: 0,
                                    pointerEvents: 'auto',
                                    cursor: 'pointer',
                                    fontSize: '16px'
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid-2 gap-15 mb-15">
                <div>
                    <label htmlFor="cycle-duration-weeks" className="text-xs text-muted font-bold block mb-4">
                        Durata (settimane)
                    </label>
                    <input
                        id="cycle-duration-weeks"
                        type="number"
                        min="1"
                        max="52"
                        value={durationWeeks}
                        onChange={e => handleDurationWeeksChange(e.target.value)}
                        onFocus={e => e.target.select()}
                        required
                        style={{ width: '100%', fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                    />
                </div>

                <div>
                    <div className="flex-between items-center mb-4">
                        <label htmlFor="cycle-sessions-per-week" className="text-xs text-muted font-bold block">
                            Frequenza di allenamento (sedute a settimana)
                        </label>
                        <span className="text-xs text-primary font-bold">
                            {tempFreq} {tempFreq === 1 ? 'seduta' : 'sedute'} / sett.
                        </span>
                    </div>
                    <input
                        id="cycle-sessions-per-week"
                        type="number"
                        min="1"
                        max="14"
                        value={sessionsPerWeek}
                        onChange={e => setSessionsPerWeek(e.target.value)}
                        onFocus={e => e.target.select()}
                        placeholder="Es. 4"
                        required
                        style={{ width: '100%', fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                    />
                    <p className="text-xs text-muted mt-4 mb-0">
                        Indica quante volte ti alleni in una settimana. Le schede ruoteranno sequenzialmente seduta dopo seduta.
                    </p>
                </div>
            </div>

            {startDate && (
                <div
                    style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'rgba(14, 165, 233, 0.08)',
                        border: '1px solid rgba(14, 165, 233, 0.2)',
                        fontSize: '0.85rem',
                        color: 'var(--primary-color)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: '15px'
                    }}
                >
                    <span>📅</span>
                    <span>
                        Periodo programmato: <strong>{timeline.formattedRange}</strong> ({tempWeeks} {tempWeeks === 1 ? 'settimana' : 'settimane'})
                    </span>
                </div>
            )}

            <div className="mb-15">
                <label className="text-xs text-muted font-bold block mb-4">
                    Note o obiettivo (opzionale)
                </label>
                <textarea
                    placeholder="Es. Focus deltoidi laterali e dorso, progressione carichi..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    style={{ width: '100%', fontSize: '16px', borderRadius: '8px', padding: '10px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                />
            </div>

            {/* Schede nel ciclo con ordine sequenziale */}
            <div className="mb-15">
                <div className="flex-between items-center mb-8">
                    <div>
                        <label className="text-xs text-muted font-bold block">
                            Sequenza rotazione schede ({cycleRoutines.length})
                        </label>
                        <span className="text-xs text-muted">
                            Ordine di esecuzione continua da una seduta alla successiva
                        </span>
                    </div>
                </div>

                {/* Selettore schede rapido */}
                <div className="mb-12">
                    <select
                        onChange={e => {
                            if (e.target.value) {
                                handleAddRoutineById(e.target.value);
                                e.target.value = '';
                            }
                        }}
                        style={{
                            width: '100%',
                            fontSize: '16px',
                            boxSizing: 'border-box',
                            maxWidth: '100%',
                            display: 'block',
                            padding: '10px 12px',
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '8px',
                            color: '#fff'
                        }}
                    >
                        <option value="">+ Aggiungi scheda alla sequenza</option>
                        {routines.map(r => (
                            <option key={r.id} value={r.id}>
                                {r.name} ({r.exercises?.length || 0} es.)
                            </option>
                        ))}
                    </select>
                </div>

                {cycleRoutines.length === 0 ? (
                    <div style={{ padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <p className="m-0 text-xs">Nessuna scheda aggiunta al ciclo. Seleziona una scheda dal menu in alto per iniziare la sequenza.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {cycleRoutines.map((item, idx) => {
                            const routine = routines.find(r => r.id === item.routineId);
                            const letterIndex = String.fromCharCode(65 + (idx % 26)); // A, B, C...
                            return (
                                <div
                                    key={`${item.routineId}-${idx}`}
                                    style={{
                                        padding: '10px 12px',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid var(--glass-border)',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '10px'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                        <div
                                            style={{
                                                width: '28px',
                                                height: '28px',
                                                borderRadius: '50%',
                                                background: 'rgba(14, 165, 233, 0.15)',
                                                border: '1px solid var(--primary-color)',
                                                color: 'var(--primary-color)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontWeight: 'bold',
                                                fontSize: '0.85rem',
                                                flexShrink: 0
                                            }}
                                        >
                                            {letterIndex}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {routine?.name || 'Scheda'}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                Posizione {idx + 1} di {cycleRoutines.length} • {routine?.exercises?.length || 0} esercizi
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-small"
                                            style={{ padding: '4px 8px', marginBottom: 0, fontSize: '0.85rem' }}
                                            onClick={() => handleMoveRoutine(idx, -1)}
                                            disabled={idx === 0}
                                            aria-label="Sposta su nella sequenza"
                                            title="Sposta su nella sequenza"
                                        >
                                            ▲
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-small"
                                            style={{ padding: '4px 8px', marginBottom: 0, fontSize: '0.85rem' }}
                                            onClick={() => handleMoveRoutine(idx, 1)}
                                            disabled={idx === cycleRoutines.length - 1}
                                            aria-label="Sposta giù nella sequenza"
                                            title="Sposta giù nella sequenza"
                                        >
                                            ▼
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            style={{ color: 'var(--danger-color)', fontSize: '1rem', padding: '4px', marginLeft: '4px' }}
                                            onClick={() => handleRemoveRoutine(idx)}
                                            aria-label="Rimuovi scheda dalla sequenza"
                                            title="Rimuovi scheda dalla sequenza"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Anteprima rotazione settimane */}
            {cycleRoutines.length > 0 && (
                <div
                    style={{
                        padding: '12px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        marginBottom: '15px'
                    }}
                >
                    <div
                        className="flex-between items-center"
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => setShowSchedulePreview(!showSchedulePreview)}
                    >
                        <div>
                            <span className="text-xs text-primary font-bold uppercase tracking-wider block">
                                Programmazione rotazione
                            </span>
                            <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#fff' }}>
                                🔄 Calendario rotazione schede ({schedule.totalSessions} sedute)
                            </span>
                        </div>
                        <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            style={{ padding: '2px 8px', fontSize: '0.75rem', marginBottom: 0 }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowSchedulePreview(!showSchedulePreview);
                            }}
                        >
                            {showSchedulePreview ? 'Nascondi' : 'Mostra'}
                        </button>
                    </div>

                    <div className="text-xs text-muted mt-6">
                        {schedule.summaryText}
                    </div>

                    {showSchedulePreview && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                            {schedule.weeks.map(week => (
                                <div
                                    key={week.weekNumber}
                                    style={{
                                        padding: '8px 10px',
                                        background: 'rgba(255, 255, 255, 0.04)',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.05)'
                                    }}
                                >
                                    <div className="flex-between items-center mb-6">
                                        <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--primary-color)' }}>
                                            Settimana {week.weekNumber} {week.formattedRange ? `(${week.formattedRange})` : ''}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {week.sessions.length} {week.sessions.length === 1 ? 'seduta' : 'sedute'}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                        {week.sessions.map((sess) => (
                                            <div
                                                key={sess.globalSessionIndex}
                                                style={{
                                                    padding: '4px 8px',
                                                    background: 'rgba(14, 165, 233, 0.1)',
                                                    border: '1px solid rgba(14, 165, 233, 0.3)',
                                                    borderRadius: '4px',
                                                    fontSize: '0.75rem',
                                                    color: '#fff',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '5px'
                                                }}
                                            >
                                                <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>
                                                    #{sess.globalSessionIndex}
                                                </span>
                                                <span>{sess.routineName}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Pulsanti di azione ordinati e bilanciati */}
            <div className="flex gap-10 mt-20" style={{ width: '100%', minWidth: 0 }}>
                <button
                    type="button"
                    className="btn flex-1"
                    style={{ background: 'rgba(255,255,255,0.08)', marginBottom: 0 }}
                    onClick={onCancel}
                >
                    Annulla
                </button>
                <button
                    type="submit"
                    className="btn btn-primary flex-2"
                    style={{ marginBottom: 0 }}
                >
                    {initialCycle ? <><span aria-hidden="true">💾</span> Salva modifiche</> : <><span aria-hidden="true">💾</span> Salva ciclo</>}
                </button>
            </div>
        </form>
    );
};
