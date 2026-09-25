import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Trophy, Activity, Clock, Layers } from 'lucide-react';
import { computeWorkoutReport } from '../../lib/calc/workoutReport';
import { formatProgressionReference, progressionQualityLabel, progressionTrendLabel } from '../../lib/calc/progression';
import { getCycleStrategyLabel } from '../../lib/trainingCycleStrategy';
import { getRoutineSetPlan } from '../../lib/advancedSets';
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
    const nutrition = useAppStore(state => state.userData?.nutrition);
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
                
                const hasIsometrics = ex.sets.some(s => s.isometrics && s.isometrics.length > 0);
                const setPlans = hasIsometrics ? undefined : ex.sets.map(getRoutineSetPlan);
                
                const result: RoutineExercise = {
                    exId: ex.exId,
                    setsCount: Math.max(1, validSetsCount)
                };
                if (finalMinReps !== undefined) result.minReps = finalMinReps;
                if (finalMaxReps !== undefined) result.maxReps = finalMaxReps;
                if (hasIsometrics) result.defaultTechnique = 'isometrics';
                else if (setPlans?.some(plan => plan.technique !== 'straight')) result.setPlans = setPlans;
                
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
        return computeWorkoutReport(workout, history, libraryMap, undefined, { nutrition });
    }, [workout, history, library, nutrition]);

    const formatKg = (val: number) => {
        if (val >= 1000) return `${(val / 1000).toFixed(2)} t`;
        return `${val.toFixed(1).replace(/\.0$/, '')} kg`;
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
                    {workout.readiness && (
                        <section className="workout-report-phase" aria-labelledby={`${titleId}-before`}>
                            <h2 id={`${titleId}-before`}>Prima della sessione</h2>
                            <div className="workout-report-metrics">
                                {workout.readiness.energy !== undefined && <span>Energia <strong>{workout.readiness.energy}/5</strong></span>}
                                {workout.readiness.stress !== undefined && <span>Stress <strong>{workout.readiness.stress}/5</strong></span>}
                                {workout.readiness.motivation !== undefined && <span>Motivazione <strong>{workout.readiness.motivation}/5</strong></span>}
                                {workout.readiness.muscleRecovery !== undefined && <span>Recupero muscolare <strong>{workout.readiness.muscleRecovery}/5</strong></span>}
                            </div>
                        </section>
                    )}

                    <section className="workout-report-phase" aria-labelledby={`${titleId}-session`}>
                        <h2 id={`${titleId}-session`}>Progressione contestuale</h2>
                        <div className="workout-report-metrics">
                            <span>Strategia <strong>{getCycleStrategyLabel(workout.cycleStrategy)}</strong></span>
                            <span>Tonnellaggio <strong>{report.totalVolumeIsComplete ? formatKg(report.totalVolume) : 'Dati incompleti'}</strong></span>
                            <span>Esercizi analizzati <strong>{report.exerciseComparisons.length}</strong></span>
                        </div>
                        {!report.totalVolumeIsComplete && (
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Il tonnellaggio totale non viene stimato quando manca il peso corporeo storico necessario per esercizi bodyweight.
                            </p>
                        )}
                    </section>

                    {report.density && (
                        <div className="card" style={{ margin: 0, padding: '16px', display: 'grid', gap: '6px' }}>
                            <strong>{report.density.headline}</strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{report.density.detail}</span>
                        </div>
                    )}

                    {report.isFirstSession && (
                        <div className="card" style={{ margin: 0, padding: '16px', display: 'grid', gap: '6px' }}>
                            <strong style={{ color: 'var(--primary-color)' }}>Baseline iniziale registrata</strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Non ci sono ancora esposizioni precedenti sufficientemente confrontabili. Questa sessione diventa il riferimento per i confronti successivi.
                            </span>
                        </div>
                    )}

                    {report.newPRs.length > 0 && (
                        <div className="card" style={{ margin: 0, padding: '16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                            <h3 style={{ margin: '0 0 12px', color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Trophy size={16} /> Record di performance
                            </h3>
                            <div style={{ display: 'grid', gap: '8px' }}>
                                {report.newPRs.map(pr => (
                                    <div key={pr.exId} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline' }}>
                                        <span>{pr.exName}</span>
                                        <strong style={{ color: 'var(--warning-color)', textAlign: 'right' }}>
                                            {formatProgressionReference(pr.progression.current)}
                                        </strong>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {report.exerciseComparisons.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <h3 style={{ margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Activity size={16} /> Analisi per esercizio
                            </h3>
                            {report.exerciseComparisons.map(ex => {
                                const progression = ex.progression;
                                const recentChain = progression.recentComparable
                                    .map(item => formatProgressionReference(item))
                                    .join(' → ');

                                return (
                                    <div key={ex.exId} className="card" style={{ margin: 0, padding: '16px', display: 'grid', gap: '10px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <strong style={{ display: 'block', fontSize: '0.98rem' }}>{ex.exName}</strong>
                                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                    {progressionTrendLabel(progression.trendDirection, progression.intent)} · {progressionQualityLabel(progression.quality)}
                                                </span>
                                            </div>
                                            {ex.isPR && (
                                                <span style={{ background: 'var(--warning-color)', color: 'var(--on-warning)', fontSize: '0.75rem', padding: '3px 7px', borderRadius: '6px', fontWeight: 700, flexShrink: 0 }}>
                                                    PR
                                                </span>
                                            )}
                                        </div>

                                        <div style={{ display: 'grid', gap: '4px' }}>
                                            <strong>{progression.headline}</strong>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{progression.detail}</span>
                                        </div>

                                        <div className="workout-report-metrics">
                                            <span>Serie <strong>{progression.current.workSets}</strong></span>
                                            <span>Ripetizioni <strong>{progression.current.totalReps}</strong></span>
                                            <span>
                                                Tonnellaggio{' '}
                                                <strong>{progression.current.tonnageComplete && progression.current.tonnageKg !== undefined ? formatKg(progression.current.tonnageKg) : '—'}</strong>
                                            </span>
                                        </div>

                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                            Confrontabilità: <strong style={{ color: 'var(--text-main)' }}>
                                                {progression.comparisonStatus === 'comparable' ? 'confrontabile' : progression.comparisonStatus === 'limited' ? 'limitata' : 'non confrontabile'}
                                            </strong>
                                            {progression.baselineVersion ? ` · baseline v${progression.baselineVersion}` : ''}
                                            {progression.baselineState ? ` · ${progression.baselineState}` : ''}
                                        </div>

                                        {progression.previousComparable && (
                                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                Ultima esposizione confrontabile · {progression.previousComparable.date || 'data non disponibile'} ·{' '}
                                                <strong style={{ color: 'var(--text-main)' }}>{formatProgressionReference(progression.previousComparable)}</strong>
                                            </div>
                                        )}

                                        {progression.progressionContract?.target && (
                                            <div style={{ fontSize: '0.82rem' }}><strong>Target:</strong> {progression.progressionContract.target}</div>
                                        )}
                                        {progression.progressionContract?.nextAction && (
                                            <div style={{ fontSize: '0.82rem' }}><strong>Prossima azione prevista:</strong> {progression.progressionContract.nextAction}</div>
                                        )}

                                        {progression.cycleBaseline && progression.cycleBaseline.sessionId !== progression.previousComparable?.sessionId && (
                                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                Baseline del ciclo · {progression.cycleBaseline.date || 'data non disponibile'} ·{' '}
                                                <strong style={{ color: 'var(--text-main)' }}>{formatProgressionReference(progression.cycleBaseline)}</strong>
                                            </div>
                                        )}

                                        {progression.bestHistorical && (
                                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                Miglior riferimento storico comparabile · {progression.bestHistorical.date || 'data non disponibile'} ·{' '}
                                                <strong style={{ color: 'var(--text-main)' }}>{formatProgressionReference(progression.bestHistorical)}</strong>
                                            </div>
                                        )}

                                        {progression.recentComparable.length >= 2 && (
                                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                                                Ultime esposizioni confrontabili: <strong style={{ color: 'var(--text-main)' }}>{recentChain}</strong>
                                            </div>
                                        )}

                                        {progression.qualityReasons.length > 0 && (
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px solid var(--glass-border)', paddingTop: '8px' }}>
                                                {progression.qualityReasons.join(' ')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {(workout.moodRating !== undefined || workout.pumpRating !== undefined || workout.fatigueRating !== undefined || workout.waterLiters !== undefined || (workout.pains?.length ?? 0) > 0) && (
                        <section className="workout-report-phase" aria-labelledby={`${titleId}-after`}>
                            <h2 id={`${titleId}-after`}>Dopo la sessione</h2>
                            <div className="workout-report-metrics">
                                {workout.moodRating !== undefined && workout.moodRating !== null && <span>Umore <strong>{workout.moodRating}/{workout.ratingScale ?? 10}</strong></span>}
                                {workout.pumpRating !== undefined && workout.pumpRating !== null && <span>Pump <strong>{workout.pumpRating}/{workout.ratingScale ?? 10}</strong></span>}
                                {workout.fatigueRating !== undefined && workout.fatigueRating !== null && <span>Fatica <strong>{workout.fatigueRating}/{workout.ratingScale ?? 10}</strong></span>}
                                {workout.waterLiters !== undefined && <span>Acqua <strong>{workout.waterLiters} L</strong></span>}
                            </div>
                        </section>
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
