import { Activity } from 'lucide-react';
import { formatProgressionReference, progressionQualityLabel, progressionTrendLabel } from '../../../lib/calc/progression';
import type { WorkoutReport } from '../../../lib/calc/workoutReport';

interface WorkoutExerciseComparisonsProps {
    comparisons: WorkoutReport['exerciseComparisons'];
    formatKg: (value: number) => string;
}

export function WorkoutExerciseComparisons({ comparisons, formatKg }: WorkoutExerciseComparisonsProps) {
    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <h3 style={{ margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Activity size={16} /> Analisi per esercizio
                            </h3>
                            {comparisons.map(ex => {
                                const progression = ex.progression;
                                const recentChain = progression.recentComparable
                                    .map(item => formatProgressionReference(item))
                                    .join(' → ');

                                return (
                                    <div key={ex.exId} className="card" style={{ margin: 0, padding: '16px', display: 'grid', gap: '10px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <strong style={{ display: 'block', fontSize: 'var(--font-size-body)' }}>{ex.exName}</strong>
                                                <span style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                                                    {progressionTrendLabel(progression.trendDirection, progression.intent)} · {progressionQualityLabel(progression.quality)}
                                                </span>
                                            </div>
                                            {ex.isPR && (
                                                <span style={{ background: 'var(--warning-color)', color: 'var(--on-warning)', fontSize: 'var(--font-size-micro)', padding: '3px 7px', borderRadius: '6px', fontWeight: 700, flexShrink: 0 }}>
                                                    PR
                                                </span>
                                            )}
                                        </div>

                                        <div style={{ display: 'grid', gap: '4px' }}>
                                            <strong>{progression.headline}</strong>
                                            <span style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>{progression.detail}</span>
                                        </div>

                                        <div className="workout-report-metrics">
                                            <span>Serie <strong>{progression.current.workSets}</strong></span>
                                            <span>Ripetizioni <strong>{progression.current.totalReps}</strong></span>
                                            <span>
                                                Tonnellaggio{' '}
                                                <strong>{progression.current.tonnageComplete && progression.current.tonnageKg !== undefined ? formatKg(progression.current.tonnageKg) : '—'}</strong>
                                            </span>
                                        </div>

                                        <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                                            Confrontabilità: <strong style={{ color: 'var(--text-main)' }}>
                                                {progression.comparisonStatus === 'comparable' ? 'confrontabile' : progression.comparisonStatus === 'limited' ? 'limitata' : 'non confrontabile'}
                                            </strong>
                                        </div>

                                        {progression.previousComparable && (
                                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                                                Ultima esposizione confrontabile · {progression.previousComparable.date || 'data non disponibile'} ·{' '}
                                                <strong style={{ color: 'var(--text-main)' }}>{formatProgressionReference(progression.previousComparable)}</strong>
                                            </div>
                                        )}


                                        {progression.cycleBaseline && progression.cycleBaseline.sessionId !== progression.previousComparable?.sessionId && (
                                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                                                Baseline del ciclo · {progression.cycleBaseline.date || 'data non disponibile'} ·{' '}
                                                <strong style={{ color: 'var(--text-main)' }}>{formatProgressionReference(progression.cycleBaseline)}</strong>
                                            </div>
                                        )}

                                        {progression.bestHistorical && (
                                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                                                Miglior riferimento storico comparabile · {progression.bestHistorical.date || 'data non disponibile'} ·{' '}
                                                <strong style={{ color: 'var(--text-main)' }}>{formatProgressionReference(progression.bestHistorical)}</strong>
                                            </div>
                                        )}

                                        {progression.recentComparable.length >= 2 && (
                                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                                                Ultime esposizioni confrontabili: <strong style={{ color: 'var(--text-main)' }}>{recentChain}</strong>
                                            </div>
                                        )}

                                        {progression.qualityReasons.length > 0 && (
                                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', borderTop: '1px solid var(--glass-border)', paddingTop: '8px' }}>
                                                {progression.qualityReasons.join(' ')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
    );
}
