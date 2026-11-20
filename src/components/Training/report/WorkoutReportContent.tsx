import { Trophy } from 'lucide-react';
import type { WorkoutReport } from '../../../lib/calc/workoutReport';
import { formatProgressionReference } from '../../../lib/calc/progression';
import { Logic } from '../../../lib/logic';
import { getCycleStrategyLabel } from '../../../lib/trainingCycleStrategy';
import type { WorkoutSession } from '../../../types';
import { WorkoutExerciseComparisons } from './WorkoutExerciseComparisons';

interface WorkoutReportContentProps {
    workout: WorkoutSession;
    report: WorkoutReport;
    titleId: string;
}

const formatKg = (val: number) => {
    if (val >= 1000) return `${(val / 1000).toFixed(2)} t`;
    return `${val.toFixed(1).replace(/\.0$/, '')} kg`;
};

export function WorkoutReportContent({ workout, report, titleId }: WorkoutReportContentProps) {
    const hasAfterSessionData = workout.moodRating != null
        || workout.pumpRating != null
        || workout.fatigueRating != null
        || workout.waterLiters !== undefined
        || (workout.pains?.length ?? 0) > 0;

    return (
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
                    <p style={{ margin: 0, fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                        Il tonnellaggio totale non è disponibile quando mancano misurazioni necessarie oppure la somma supera i limiti numerici.
                    </p>
                )}
            </section>

            {report.density && (
                <div className="card" style={{ margin: 0, padding: '16px', display: 'grid', gap: '6px' }}>
                    <strong>{report.density.headline}</strong>
                    <span style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>{report.density.detail}</span>
                </div>
            )}

            {report.isFirstSession && (
                <div className="card" style={{ margin: 0, padding: '16px', display: 'grid', gap: '6px' }}>
                    <strong style={{ color: 'var(--primary-color)' }}>Nuova baseline registrata</strong>
                    <span style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                        Non ci sono esposizioni precedenti sufficientemente confrontabili per questo contesto e standard registrato. Questa sessione diventa il riferimento per i confronti successivi.
                    </span>
                </div>
            )}

            {report.newPRs.length > 0 && (
                <div className="card" style={{ margin: 0, padding: '16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                    <h3 style={{ margin: '0 0 12px', color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Trophy size={16} /> Record nelle condizioni confrontabili
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

            {report.exerciseComparisons.length > 0 && <WorkoutExerciseComparisons comparisons={report.exerciseComparisons} formatKg={formatKg} />}
            {hasAfterSessionData && (
                <section className="workout-report-phase" aria-labelledby={`${titleId}-after`}>
                    <h2 id={`${titleId}-after`}>Dopo la sessione</h2>
                    <div className="workout-report-metrics">
                        {workout.moodRating !== undefined && workout.moodRating !== null && <span>Umore <strong>{workout.moodRating}/5</strong></span>}
                        {workout.pumpRating !== undefined && workout.pumpRating !== null && <span>Pump <strong>{workout.pumpRating}/5</strong></span>}
                        {workout.fatigueRating !== undefined && workout.fatigueRating !== null && <span>Fatica <strong>{workout.fatigueRating}/5</strong></span>}
                        {workout.waterLiters !== undefined && <span>Acqua <strong>{workout.waterLiters} L</strong></span>}
                        {workout.pains && workout.pains.length > 0 && <span>Dolori muscolari <strong>{workout.pains.map(Logic.getMuscleName).join(', ')}</strong></span>}
                    </div>
                </section>
            )}
        </div>
    );
}
