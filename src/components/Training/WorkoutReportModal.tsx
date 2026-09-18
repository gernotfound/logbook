import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, TrendingUp, Clock, Layers } from 'lucide-react';
import { computeWorkoutReport } from '../../lib/calc/workoutReport';
import { Logic } from '../../lib/logic';
import type { WorkoutSession, Exercise, RoutineExercise, WorkoutRoutine } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { mapFirebaseErrorCode } from '../../lib/errorHandler';
import './training.css';

interface WorkoutReportModalProps {
    workout: WorkoutSession;
    history: WorkoutSession[];
    library: Exercise[];
    onClose: () => void;
    fromEndWorkout?: boolean;
}

const WorkoutReportModal: React.FC<WorkoutReportModalProps> = ({ workout, history, library, onClose, fromEndWorkout }) => {
    const titleId = useId();
    const surfaceRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);
    useEffect(() => {
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        headingRef.current?.focus();
        const handleKey = (event: KeyboardEvent) => {
            if (document.querySelector('.ui-global-dialog-1')) return;
            if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
            if (event.key !== 'Tab') return;
            const controls = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', handleKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKey);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);

    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    const isFreeWorkoutJustEnded = fromEndWorkout && !workout.routineId;
    const hasExercises = (workout.exercises && workout.exercises.length > 0);
    const canSaveAsRoutine = isFreeWorkoutJustEnded && hasExercises;

    const [isSavingAsRoutine, setIsSavingAsRoutine] = useState(false);
    const [newRoutineName, setNewRoutineName] = useState(`Allenamento libero - ${Logic.getLocalDateString()}`);
    const [isSavingRoutineLoading, setIsSavingRoutineLoading] = useState(false);

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
        <div className="workout-report" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={surfaceRef}>
            <div className="workout-report-page">
                <header className="workout-report-header">
                    <div>
                        <p className="text-sm text-muted">{fromEndWorkout ? 'Allenamento concluso' : 'Resoconto allenamento'}</p>
                        <h1 id={titleId} tabIndex={-1} ref={headingRef}>{report.workoutName}</h1>
                        <p className="text-sm text-muted">{Logic.formatItalianDate(report.date)}</p>
                    </div>
                    <button className="btn-icon" type="button" onClick={onClose} aria-label="Chiudi"><X size={24} aria-hidden="true" /></button>
                </header>
                <div className="workout-report-content">
                    <section className="workout-report-summary" aria-label="Riepilogo allenamento">
                        <div><span><Clock size={18} aria-hidden="true" /> Durata totale</span><strong>{Logic.formatDuration(report.durationSeconds)}</strong></div>
                        <div><span>Volume</span><strong>{formatKg(report.totalVolume)}</strong></div>
                        <p><Layers size={18} aria-hidden="true" /> {workout.exercises?.length || 0} esercizi</p>
                        {report.volumeDeltaPercent !== undefined && <p>Rispetto alla precedente: <strong>{formatDelta(report.volumeDeltaPercent, true)}</strong></p>}
                    </section>
                    {report.isFirstSession ? (
                        <section className="workout-report-card"><h2>Prima sessione completata!</h2><p className="text-muted">Non ci sono sessioni precedenti con questa scheda da confrontare. I progressi saranno visibili dalla prossima volta.</p></section>
                    ) : (
                        <>
                            {report.newPRs.length > 0 && <section className="workout-report-card"><h2><TrendingUp size={20} aria-hidden="true" /> Miglioramenti dalla volta scorsa</h2><ul className="workout-report-improvements">{report.newPRs.map(ex => <li key={ex.exId}><span>{ex.exName}</span><strong>{ex.volumeDelta > 0 ? `${formatDelta(ex.volumeDeltaPercent, true)} volume` : ex.weightDelta > 0 ? `${formatDelta(ex.weightDelta)} kg medi` : `${formatDelta(ex.repsDelta)} ripetizioni`}</strong></li>)}</ul></section>}
                            {report.exerciseComparisons.length > 0 && <section className="workout-report-comparisons"><h2>Confronto con la sessione precedente</h2>{report.exerciseComparisons.map(ex => {
                                const maximum = Math.max(ex.currentVolume, ex.previousVolume);
                                return <article className="workout-report-card" key={ex.exId}>
                                    <h3>{ex.exName}</h3>
                                    <div className="workout-report-bar-row"><span>Prima</span><div className="workout-report-bar" aria-hidden="true"><span style={{ width: `${maximum > 0 ? ex.previousVolume / maximum * 100 : 0}%` }} /></div><span>{formatKg(ex.previousVolume)}</span></div>
                                    <div className="workout-report-bar-row current"><span>Questa</span><div className="workout-report-bar" aria-hidden="true"><span style={{ width: `${maximum > 0 ? ex.currentVolume / maximum * 100 : 0}%` }} /></div><span>{formatKg(ex.currentVolume)}</span></div>
                                    <dl className="workout-report-details"><div><dt>Ripetizioni</dt><dd>{ex.currentReps} ({formatDelta(ex.repsDelta)})</dd></div><div><dt>Peso medio</dt><dd>{formatKg(ex.currentAvgWeight)} ({formatDelta(ex.weightDelta)})</dd></div></dl>
                                </article>;
                            })}</section>}
                        </>
                    )}
                    {canSaveAsRoutine && !isSavingAsRoutine && <button className="btn btn-secondary" type="button" onClick={() => setIsSavingAsRoutine(true)}>Salva come scheda</button>}
                    {isSavingAsRoutine && <section className="workout-report-card"><label className="form-group">Nome nuova scheda<input type="text" value={newRoutineName} onChange={e => setNewRoutineName(e.target.value)} disabled={isSavingRoutineLoading} /></label><div className="workout-inline-actions"><button className="btn btn-secondary" type="button" onClick={() => setIsSavingAsRoutine(false)} disabled={isSavingRoutineLoading}>Annulla</button><button className="btn btn-primary" type="button" onClick={handleSaveAsRoutine} disabled={isSavingRoutineLoading}>{isSavingRoutineLoading ? 'Salvataggio...' : 'Salva'}</button></div></section>}
                    <button className="btn btn-primary workout-report-close" type="button" onClick={onClose}>{fromEndWorkout ? 'Chiudi e torna alla Home' : 'Chiudi report'}</button>
                </div>
            </div>
        </div>
    );
};

export default WorkoutReportModal;
