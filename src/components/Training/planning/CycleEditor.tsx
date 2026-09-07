// Responsabilità: form di creazione o modifica di un ciclo di allenamento (con preview della schedule).
// Props: initialCycle, routines, onSave, onCancel.
// Effetti: chiama onSave col nuovo ciclo validato; usa lo state di dialogStore per gli alert.

import React, { useCallback } from 'react';
import { useDialogStore } from '../../../store/useDialogStore';
import type { TrainingCycle, WorkoutRoutine } from '../../../types';
import { useCycleForm } from './useCycleForm';
import { CycleSchedulePreview } from './CycleSchedulePreview';
import { CycleRoutinesList } from './CycleRoutinesList';

interface CycleEditorProps {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    onSave: (cycleData: TrainingCycle) => void;
    onCancel: () => void;
}

export const CycleEditor: React.FC<CycleEditorProps> = ({
    initialCycle,
    routines,
    onSave,
    onCancel
}) => {
    const showAlert = useDialogStore(state => state.showAlert);

    const form = useCycleForm({
        initialCycle,
        routines,
        onSave,
        showAlert
    });

    const {
        refs: { startDatePickerRef, endDatePickerRef },
        state: {
            name,
            setName,
            dateTextInput,
            endDateTextInput,
            startDate,
            endDate,
            durationWeeks,
            sessionsPerWeek,
            setSessionsPerWeek,
            notes,
            setNotes,
            cycleRoutines,
            showSchedulePreview,
            setShowSchedulePreview,
            tempWeeks
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
    } = form;

    const togglePreview = useCallback(() => {
        setShowSchedulePreview(!showSchedulePreview);
    }, [showSchedulePreview, setShowSchedulePreview]);

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

            <div className="mb-15" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
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
                            {form.state.tempFreq} {form.state.tempFreq === 1 ? 'seduta' : 'sedute'} / sett.
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
            <CycleRoutinesList
                cycleRoutines={cycleRoutines}
                routines={routines}
                onAdd={handleAddRoutineById}
                onMove={handleMoveRoutine}
                onRemove={handleRemoveRoutine}
            />

            {/* Anteprima rotazione settimane */}
            {cycleRoutines.length > 0 && (
                <CycleSchedulePreview
                    schedule={schedule}
                    showPreview={showSchedulePreview}
                    onTogglePreview={togglePreview}
                />
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
