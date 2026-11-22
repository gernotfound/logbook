import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Clock, Layers } from 'lucide-react';
import { computeWorkoutReport } from '../../../lib/calc/workoutReport';
import { Logic } from '../../../lib/logic';
import { WorkoutReportContent } from './WorkoutReportContent';
import type { WorkoutSession, Exercise, UserData } from '../../../types';
import { useDialogStore } from '../../../store/useDialogStore';

interface WorkoutReportViewProps {
    workout: WorkoutSession;
    history: WorkoutSession[];
    library: Exercise[];
    onClose: () => void;
    fromEndWorkout?: boolean;
    nutrition?: UserData['nutrition'];
    onSaveAsRoutine?: (name: string) => Promise<void>;
}

export const WorkoutReportView: React.FC<WorkoutReportViewProps> = ({
    workout, history, library, onClose, fromEndWorkout, nutrition, onSaveAsRoutine,
}) => {
    const titleId = useId();
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    // React's loading state is not an immediate cross-event exclusion guard.
    const routineSaveInFlightRef = useRef(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const showAlert = useDialogStore(state => state.showAlert);

    const isFreeWorkoutJustEnded = fromEndWorkout && !workout.routineId;
    const hasExercises = (workout.exercises && workout.exercises.length > 0);
    const canSaveAsRoutine = Boolean(onSaveAsRoutine) && isFreeWorkoutJustEnded && hasExercises;

    const [isSavingAsRoutine, setIsSavingAsRoutine] = useState(false);
    const [newRoutineName, setNewRoutineName] = useState(`Allenamento libero - ${Logic.getLocalDateString()}`);
    const [isSavingRoutineLoading, setIsSavingRoutineLoading] = useState(false);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            // GlobalDialog is a portal above this page and manages its own focus.
            if (document.querySelector('[role="alertdialog"][aria-modal="true"]')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
            }
            if (event.key === 'Tab') {
                const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                );
                if (!focusable?.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused?.isConnected) {
                previouslyFocused.focus();
            } else {
                requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>('.bottom-nav [aria-current="page"]')?.focus();
                });
            }
        };
    }, []);

    const handleSaveAsRoutine = async () => {
        if (!onSaveAsRoutine || routineSaveInFlightRef.current) return;
        if (!newRoutineName.trim()) {
            void showAlert("Inserisci un nome per la scheda.");
            return;
        }
        
        routineSaveInFlightRef.current = true;
        setIsSavingRoutineLoading(true);

        try {
            await onSaveAsRoutine(newRoutineName.trim());
            
            setIsSavingAsRoutine(false);
        } catch {
            // The durable boundary already accepts verified local-pending results.
            // An error message cannot turn a rejected/unsafe save into confirmation.
            void showAlert("Errore durante il salvataggio della scheda.");
        } finally {
            routineSaveInFlightRef.current = false;
            setIsSavingRoutineLoading(false);
        }
    };

    const report = useMemo(() => {
        const libraryMap = new Map(library.map(l => [l.id, l]));
        return computeWorkoutReport(workout, history, libraryMap, undefined, { nutrition });
    }, [workout, history, library, nutrition]);


    return (
        <div ref={dialogRef} className="workout-report" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="workout-report-page">
                {/* Header */}
                <header className="workout-report-header">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span className="text-sm text-primary font-bold">Allenamento completato</span>
                        <h1 id={titleId}>{report.workoutName}</h1>
                        <p style={{ margin: 0, fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                            {Logic.formatItalianDate ? Logic.formatItalianDate(report.date) : report.date}
                        </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <span style={{ fontSize: 'var(--font-size-micro)', background: 'var(--surface-light)', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Clock size={12} />
                                {Logic.formatDuration ? Logic.formatDuration(report.durationSeconds) : report.durationSeconds}
                            </span>
                            <span style={{ fontSize: 'var(--font-size-micro)', background: 'var(--surface-light)', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Layers size={12} />
                                {workout.exercises?.length || 0} Esercizi
                            </span>
                        </div>
                        <button 
                            ref={closeButtonRef}
                            type="button"
                            onClick={onClose} 
                            style={{ 
                                background: 'transparent', 
                                border: '1px solid var(--glass-border)', 
                                color: 'var(--text-muted)', 
                                cursor: 'pointer', 
                                padding: '8px', 
                                borderRadius: '8px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                minWidth: '44px',
                                minHeight: '44px'
                            }}
                            aria-label="Chiudi"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </header>

                {/* Content */}
                <WorkoutReportContent workout={workout} report={report} titleId={titleId} />

                {/* Footer */}
                <footer className="workout-report-footer">
                    {canSaveAsRoutine && !isSavingAsRoutine && (
                        <button className="btn btn-secondary" style={{ width: '100%', margin: 0, padding: '16px', fontSize: 'var(--font-size-control)', fontWeight: 'bold' }} onClick={() => setIsSavingAsRoutine(true)}>
                            Salva come scheda
                        </button>
                    )}
                    
                    {isSavingAsRoutine && (
                        <div style={{
                            background: 'var(--surface-light)',
                            padding: '16px',
                            borderRadius: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px'
                        }}>
                            <label htmlFor="new-routine-name" style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>Nome nuova scheda</label>
                            <input
                                id="new-routine-name"
                                type="text" 
                                className="form-control"
                                value={newRoutineName}
                                onChange={e => setNewRoutineName(e.target.value)}
                                style={{ fontSize: '16px' }}
                                disabled={isSavingRoutineLoading}
                            />
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="btn btn-secondary" style={{ flex: 1, margin: 0 }} onClick={() => setIsSavingAsRoutine(false)} disabled={isSavingRoutineLoading}>
                                    Annulla
                                </button>
                                <button className="btn btn-primary" style={{ flex: 1, margin: 0 }} onClick={handleSaveAsRoutine} disabled={isSavingRoutineLoading}>
                                    {isSavingRoutineLoading ? 'Salvataggio...' : 'Salva'}
                                </button>
                            </div>
                        </div>
                    )}
                    <button className="btn btn-primary workout-report-close" type="button" onClick={onClose}>
                        {fromEndWorkout ? 'Chiudi e torna alla Home' : 'Chiudi report'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

