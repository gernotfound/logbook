import React, { useCallback, useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useDialogStore } from '../../../store/useDialogStore';
import { Logic } from '../../../lib/logic';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../../../types';
import { useCycleForm } from './useCycleForm';
import { CycleSchedulePreview } from './CycleSchedulePreview';
import { CycleRoutinesList } from './CycleRoutinesList';
import { CycleMuscleMap } from './CycleMuscleMap';
import { CycleStrategyFields } from './CycleStrategyFields';
import { CycleVolumeAccordion } from './CycleVolumeAccordion';
import { calculateCycleMacroVolume } from './cycleMacroVolume';

const EMPTY_LIBRARY: Exercise[] = [];

interface CycleEditorProps {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    library?: Exercise[];
    hasRecordedSessions?: boolean;
    onSave: (cycleData: TrainingCycle) => void | Promise<void>;
    onCancel: () => void;
}

export const CycleEditor: React.FC<CycleEditorProps> = ({
    initialCycle,
    routines,
    library = EMPTY_LIBRARY,
    hasRecordedSessions = false,
    onSave,
    onCancel
}) => {
    const showAlert = useDialogStore(state => state.showAlert);
    const form = useCycleForm({ initialCycle, routines, onSave, showAlert });

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
            strategyIntent,
            progressionFocus,
            setProgressionFocus,
            primaryMuscles,
            secondaryMuscles,
            cycleRoutines,
            showSchedulePreview,
            setShowSchedulePreview,
            tempWeeks,
            tempFreq
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
    } = form;

    const togglePreview = useCallback(() => {
        setShowSchedulePreview(!showSchedulePreview);
    }, [showSchedulePreview, setShowSchedulePreview]);

    const previewCycle = useMemo<TrainingCycle>(() => ({
        id: initialCycle?.id ?? 'cycle-preview',
        name: name || 'Anteprima ciclo',
        durationWeeks: tempWeeks,
        sessionsPerWeek: tempFreq,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        routines: cycleRoutines
    }), [cycleRoutines, endDate, initialCycle?.id, name, startDate, tempFreq, tempWeeks]);

    const highlightedMuscles = useMemo(
        () => Logic.calculateCycleVolume(previewCycle, routines, library).highlightedMuscles,
        [library, previewCycle, routines]
    );
    const macroVolume = useMemo(
        () => calculateCycleMacroVolume(previewCycle, routines, library),
        [library, previewCycle, routines]
    );

    return (
        <form id="cycle-editor-form" onSubmit={handleSubmit} className="planning-editor">
            <header className="planning-editor-header">
                <h2>
                    {initialCycle ? 'Modifica ciclo' : 'Nuovo ciclo'}
                    {!initialCycle ? <span className="sr-only"> Crea ciclo di allenamento</span> : null}
                </h2>
                <button type="button" className="planning-close-button" onClick={onCancel}>Chiudi</button>
            </header>

            <label className="planning-field" htmlFor="cycle-name">
                <span>Nome ciclo</span>
                <input
                    id="cycle-name"
                    type="text"
                    placeholder="Es. Mesociclo ipertrofia 4 giorni"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onFocus={event => event.target.select()}
                    required
                />
            </label>

            <div className="planning-editor-grid">
                <label className="planning-field" htmlFor="cycle-start-date">
                    <span>Data di inizio</span>
                    <div className="planning-date-field">
                        <input
                            id="cycle-start-date"
                            type="text"
                            placeholder="GG/MM/AAAA"
                            value={dateTextInput}
                            onChange={handleStartDateTextChange}
                            onBlur={handleStartDateTextBlur}
                            onFocus={event => event.target.select()}
                            required
                        />
                        <span className="planning-date-picker-wrap">
                            <button
                                type="button"
                                className="planning-icon-button"
                                onClick={handleOpenStartCalendar}
                                title="Scegli data di inizio dal calendario"
                                aria-label="Scegli data di inizio dal calendario"
                            >
                                <CalendarDays size={20} aria-hidden="true" />
                            </button>
                            <input
                                ref={startDatePickerRef}
                                className="planning-native-date-input"
                                type="date"
                                value={startDate}
                                onChange={handleStartCalendarDateChange}
                                tabIndex={-1}
                                aria-label="Scegli data di inizio dal calendario"
                            />
                        </span>
                    </div>
                </label>

                <label className="planning-field" htmlFor="cycle-end-date">
                    <span>Data di fine</span>
                    <div className="planning-date-field">
                        <input
                            id="cycle-end-date"
                            type="text"
                            aria-label="Data di fine"
                            placeholder="GG/MM/AAAA"
                            value={endDateTextInput}
                            onChange={handleEndDateTextChange}
                            onBlur={handleEndDateTextBlur}
                            onFocus={event => event.target.select()}
                            required
                        />
                        <span className="planning-date-picker-wrap">
                            <button
                                type="button"
                                className="planning-icon-button"
                                onClick={handleOpenEndCalendar}
                                title="Scegli data di fine dal calendario"
                                aria-label="Scegli data di fine dal calendario"
                            >
                                <CalendarDays size={20} aria-hidden="true" />
                            </button>
                            <input
                                ref={endDatePickerRef}
                                className="planning-native-date-input"
                                type="date"
                                value={endDate}
                                onChange={handleEndCalendarDateChange}
                                tabIndex={-1}
                                aria-label="Scegli data di fine dal calendario"
                            />
                        </span>
                    </div>
                    <span className="planning-helper">Si aggiorna automaticamente quando cambi data iniziale o durata.</span>
                </label>
            </div>

            <label className="planning-field planning-number-field" htmlFor="cycle-duration-weeks">
                <span>Durata (settimane)</span>
                <input
                    id="cycle-duration-weeks"
                    type="number"
                    min="1"
                    max="52"
                    value={durationWeeks}
                    onChange={event => handleDurationWeeksChange(event.target.value)}
                    onFocus={event => event.target.select()}
                    required
                />
            </label>

            <div className="planning-period-summary" role="status">
                <span>Periodo programmato</span>
                <strong>{timeline.formattedRange}</strong>
                <span>({tempWeeks} {tempWeeks === 1 ? 'settimana' : 'settimane'})</span>
            </div>

            <CycleStrategyFields
                intent={strategyIntent}
                progressionFocus={progressionFocus}
                primaryMuscles={primaryMuscles}
                secondaryMuscles={secondaryMuscles}
                hasRecordedSessions={hasRecordedSessions}
                onIntentChange={handleStrategyIntentChange}
                onProgressionFocusChange={setProgressionFocus}
                onAddMuscle={handleAddPriorityMuscle}
                onRemoveMuscle={handleRemovePriorityMuscle}
            />

            <div className="planning-number-block">
                <label className="planning-field planning-number-field" htmlFor="cycle-sessions-per-week">
                    <span>Sedute a settimana</span>
                    <input
                        id="cycle-sessions-per-week"
                        type="number"
                        min="1"
                        max="14"
                        value={sessionsPerWeek}
                        onChange={event => setSessionsPerWeek(event.target.value)}
                        onFocus={event => event.target.select()}
                        required
                    />
                </label>
                <span className="planning-helper">È una frequenza media: la rotazione prosegue quando ti alleni, senza assegnare giorni fissi.</span>
            </div>

            <label className="planning-field" htmlFor="cycle-notes">
                <span>Note</span>
                <textarea
                    id="cycle-notes"
                    placeholder="Es. Indicazioni personali sul ciclo..."
                    value={notes}
                    onChange={event => setNotes(event.target.value)}
                    rows={3}
                />
            </label>

            <CycleRoutinesList
                cycleRoutines={cycleRoutines}
                routines={routines}
                library={library}
                onAdd={handleAddRoutineById}
                onMove={handleMoveRoutine}
                onRemove={handleRemoveRoutine}
            />

            {cycleRoutines.length > 0 ? (
                <CycleSchedulePreview
                    schedule={schedule}
                    showPreview={showSchedulePreview}
                    onTogglePreview={togglePreview}
                />
            ) : null}

            <CycleMuscleMap
                title="Mappa muscolare del ciclo"
                highlightedMuscles={highlightedMuscles}
                emptyMessage="Aggiungi una scheda al ciclo per evidenziare i muscoli allenati."
            />

            <CycleVolumeAccordion items={macroVolume} />

            <div className="planning-editor-actions">
                <button type="button" className="btn" onClick={onCancel}>Annulla</button>
                <button type="submit" className="btn btn-primary">
                    {initialCycle ? 'Salva modifiche' : 'Salva ciclo'}
                </button>
            </div>
        </form>
    );
};
