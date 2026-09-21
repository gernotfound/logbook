import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Trophy, ArrowUp, ArrowDown, Activity, Clock, Layers } from 'lucide-react';
import { computeWorkoutReport } from '../../lib/calc/workoutReport';
import { Logic } from '../../lib/logic';
import type { WorkoutSession, Exercise, RoutineExercise, WorkoutRoutine } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { mapFirebaseErrorCode } from '../../lib/errorHandler';

interface WorkoutReportModalProps {
    workout: WorkoutSession;
    history: WorkoutSession[];
    library: Exercise[];
    onClose: () => void;
    fromEndWorkout?: boolean;
}

const WorkoutReportModal: React.FC<WorkoutReportModalProps> = ({ workout, history, library, onClose, fromEndWorkout }) => {
    const titleId = useId();
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    const isFreeWorkoutJustEnded = fromEndWorkout && !workout.routineId;
    const hasExercises = (workout.exercises && workout.exercises.length > 0);
    const canSaveAsRoutine = isFreeWorkoutJustEnded && hasExercises;

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
        if (!newRoutineName.trim()) {
            showAlert("Inserisci un nome per la scheda.");
            return;
        }
        
        setIsSavingRoutineLoading(true);
        
        try {
            const newRoutineId = Logic.generateId('r');
            
            const routineExercises: RoutineExercise[] = workout.exercises.map(ex => {
                let minReps = Infinity;
                let maxReps = -Infinity;
                let validSetsCount = 0;
                
                ex.sets.forEach(set => {
                    const reps = parseInt(set.reps, 10);
                    if (!isNaN(reps)) {
                        if (reps < minReps) minReps = reps;
                        if (reps > maxReps) maxReps = reps;
                    }
                    validSetsCount++;
                });
                
                const finalMinReps = minReps !== Infinity ? minReps : undefined;
                const finalMaxReps = maxReps !== -Infinity ? maxReps : undefined;
                
                let defaultTechnique: 'none' | 'dropset' | 'isometrics' | undefined;
                const hasDropsets = ex.sets.some(s => s.dropsets && s.dropsets.length > 0);
                const hasIsometrics = ex.sets.some(s => s.isometrics && s.isometrics.length > 0);
                
                if (hasDropsets) defaultTechnique = 'dropset';
                else if (hasIsometrics) defaultTechnique = 'isometrics';
                
                const result: RoutineExercise = {
                    exId: ex.exId,
                    setsCount: Math.max(1, validSetsCount)
                };
                if (finalMinReps !== undefined) result.minReps = finalMinReps;
                if (finalMaxReps !== undefined) result.maxReps = finalMaxReps;
                if (defaultTechnique) result.defaultTechnique = defaultTechnique;
                
                return result;
            });

            const newRoutine: WorkoutRoutine = {
                id: newRoutineId,
                name: newRoutineName.trim(),
                exercises: routineExercises
            };
            
            await dispatchDomainOperation({ type: 'routine.upsert', routine: newRoutine });
            
            setIsSavingAsRoutine(false);
            showAlert("Scheda salvata con successo!");
        } catch (err: any) {
            const formatted = mapFirebaseErrorCode(err);
            if (formatted.isOfflineSafe) {
                setIsSavingAsRoutine(false);
                showAlert("Scheda salvata in locale (offline).");
            } else {
                showAlert("Errore durante il salvataggio della scheda.");
            }
        } finally {
            setIsSavingRoutineLoading(false);
        }
    };

    const report = useMemo(() => {
        const libraryMap = new Map(library.map(l => [l.id, l]));
        return computeWorkoutReport(workout, history, libraryMap);
    }, [workout, history, library]);

    const formatKg = (val: number) => {
        if (val >= 1000) return `${(val / 1000).toFixed(2)} t`;
        return `${val.toFixed(1).replace(/\.0$/, '')} kg`;
    };

    const formatDelta = (val: number, isPercent = false) => {
        const prefix = val > 0 ? '+' : '';
        const num = val.toFixed(1).replace(/\.0$/, '');
        return `${prefix}${num}${isPercent ? '%' : ''}`;
    };

    return (
        <div ref={dialogRef} className="workout-report" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="workout-report-page">
                {/* Header */}
                <header className="workout-report-header">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span className="text-sm text-primary font-bold">Allenamento completato</span>
                        <h1 id={titleId}>{report.workoutName}</h1>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {Logic.formatItalianDate ? Logic.formatItalianDate(report.date) : report.date}
                        </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <span style={{ fontSize: '0.75rem', background: 'var(--surface-light)', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Clock size={12} />
                                {Logic.formatDuration ? Logic.formatDuration(report.durationSeconds) : report.durationSeconds}
                            </span>
                            <span style={{ fontSize: '0.75rem', background: 'var(--surface-light)', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                <div className="workout-report-content">
                    
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Volume Totale</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{formatKg(report.totalVolume)}</span>
                            {report.volumeDeltaPercent !== undefined && (
                                <span style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    color: report.volumeDeltaPercent > 0 ? 'var(--success-color)' : (report.volumeDeltaPercent < 0 ? 'var(--danger-color)' : 'var(--text-muted)'),
                                    display: 'flex', alignItems: 'center', gap: '2px'
                                }}>
                                    {report.volumeDeltaPercent > 0 ? <ArrowUp size={12} /> : (report.volumeDeltaPercent < 0 ? <ArrowDown size={12} /> : null)}
                                    {formatDelta(report.volumeDeltaPercent, true)} vs prec.
                                </span>
                            )}
                        </div>
                        <div className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
                             <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Esercizi Condivisi</span>
                             <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{report.exerciseComparisons.length}</span>
                        </div>
                    </div>

                    {report.isFirstSession ? (
                        <div style={{
                            background: 'rgba(0, 229, 255, 0.1)',
                            border: '1px solid rgba(0, 229, 255, 0.2)',
                            borderRadius: '12px',
                            padding: '20px',
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}>
                            <span style={{ fontSize: '2rem' }}>🎉</span>
                            <h3 style={{margin: 0,color: 'var(--primary-color)'}}>Prima sessione completata!</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Non abbiamo allenamenti precedenti con questa scheda per fare un confronto. I progressi verranno tracciati dalla prossima volta!</p>
                        </div>
                    ) : (
                        <>
                            {/* PR Section */}
                            {report.newPRs.length > 0 && (
                                <div className="card" style={{ margin: 0, padding: '16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                    <h3 style={{margin: '0 0 12px',color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '6px'}}>
                                        <Trophy size={16} /> Nuovi Record Personali
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {report.newPRs.map(pr => (
                                            <div key={pr.exId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem' }}>
                                                <span>{pr.exName}</span>
                                                <span style={{ fontWeight: 'bold', color: 'var(--warning-color)' }}>
                                                    {pr.volumeDelta > 0 ? `+${pr.volumeDeltaPercent.toFixed(1)}% Vol` : `+${pr.weightDelta.toFixed(1)}kg Media`}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Exercise List */}
                            {report.exerciseComparisons.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <h3 style={{margin: 0,color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px'}}>
                                        <Activity size={16} /> Confronto Esercizi
                                    </h3>
                                    {report.exerciseComparisons.map(ex => {
                                        const maxVol = Math.max(ex.currentVolume, ex.previousVolume);
                                        const currWidth = maxVol > 0 ? (ex.currentVolume / maxVol) * 100 : 0;
                                        const prevWidth = maxVol > 0 ? (ex.previousVolume / maxVol) * 100 : 0;

                                        return (
                                            <div key={ex.exId} className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{ex.exName}</span>
                                                    {ex.isPR && <span style={{ background: 'var(--warning-color)', color: 'var(--on-warning)', fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>PR</span>}
                                                </div>

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {/* Previous Bar */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '35px' }}>Prec.</span>
                                                        <div style={{ flex: 1, height: '6px', background: 'var(--surface-light)', borderRadius: '3px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${prevWidth}%`, height: '100%', background: 'var(--text-muted)' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '50px', textAlign: 'right' }}>{formatKg(ex.previousVolume)}</span>
                                                    </div>
                                                    
                                                    {/* Current Bar */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-main)', width: '35px' }}>Oggi</span>
                                                        <div style={{ flex: 1, height: '6px', background: 'var(--surface-light)', borderRadius: '3px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${currWidth}%`, height: '100%', background: ex.volumeDelta >= 0 ? 'var(--primary-color)' : 'var(--danger-color)' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-main)', width: '50px', textAlign: 'right', fontWeight: 'bold' }}>{formatKg(ex.currentVolume)}</span>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', borderTop: '1px solid var(--glass-border)', paddingTop: '8px' }}>
                                                    <span>Reps: {ex.currentReps} <span style={{ color: ex.repsDelta > 0 ? 'var(--success-color)' : (ex.repsDelta < 0 ? 'var(--danger-color)' : 'inherit') }}>({formatDelta(ex.repsDelta)})</span></span>
                                                    <span>Peso medio: {formatKg(ex.currentAvgWeight)} <span style={{ color: ex.weightDelta > 0 ? 'var(--success-color)' : (ex.weightDelta < 0 ? 'var(--danger-color)' : 'inherit') }}>({formatDelta(ex.weightDelta)})</span></span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <footer className="workout-report-footer">
                    {canSaveAsRoutine && !isSavingAsRoutine && (
                        <button className="btn btn-secondary" style={{ width: '100%', margin: 0, padding: '16px', fontSize: '1rem', fontWeight: 'bold' }} onClick={() => setIsSavingAsRoutine(true)}>
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
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nome nuova scheda</label>
                            <input 
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

export default WorkoutReportModal;
