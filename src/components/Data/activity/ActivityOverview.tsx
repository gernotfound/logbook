import { HeartPulse } from 'lucide-react';
import type { useActivityTracking } from '../../../hooks/useActivityTracking';

type ActivityOverviewProps = Pick<ReturnType<typeof useActivityTracking>, 'currentWeek' | 'trainingActivityContext'>;

const integerFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });

export function ActivityOverview({ currentWeek: week, trainingActivityContext }: ActivityOverviewProps) {
    return (
        <>
            <section className="section-divider activity-summary" aria-labelledby="activity-week-title">
                <div className="activity-heading-row">
                    <div>
                        <h2 id="activity-week-title">Attività — questa settimana</h2>
                        <p>Dati registrati, senza stime di consumo o prescrizioni.</p>
                    </div>
                    <HeartPulse size={22} aria-hidden="true" />
                </div>                <div className="activity-stat-grid">
                    <div className="activity-stat"><span>Passi medi</span><strong>{week.averageSteps === null ? '—' : integerFormatter.format(week.averageSteps)}</strong></div>
                    <div className="activity-stat"><span>Dati passi</span><strong>{week.stepDaysCount}/{week.daysConsidered} giorni</strong></div>
                    <div className="activity-stat"><span>Passi registrati</span><strong>{week.stepDaysCount ? integerFormatter.format(week.totalSteps) : '—'}</strong></div>
                    <div className="activity-stat"><span>Cardio registrato</span><strong>{decimalFormatter.format(week.cardioMinutes)} min</strong></div>
                    <div className="activity-stat"><span>Sessioni cardio</span><strong>{week.cardioSessionsCount}</strong></div>
                </div>
                {week.cardioSessionsCount > 0 && (
                    <div className="activity-intensity-summary" aria-label="Minuti cardio per intensità">
                        <span>Bassa {decimalFormatter.format(week.cardioMinutesByIntensity.low)} min</span>
                        <span>Moderata {decimalFormatter.format(week.cardioMinutesByIntensity.moderate)} min</span>
                        <span>Alta {decimalFormatter.format(week.cardioMinutesByIntensity.high)} min</span>
                        {week.cardioMinutesByIntensity.unclassified > 0 && <span>Senza intensità {decimalFormatter.format(week.cardioMinutesByIntensity.unclassified)} min</span>}
                    </div>
                )}
            </section>

            <section className="section-divider" aria-labelledby="activity-context-title">
                <div className="activity-heading-row">
                    <div>
                        <h2 id="activity-context-title">Contesto attività + allenamento</h2>
                        <p>Co-visualizzazione descrittiva delle ultime 8 settimane. Passi, cardio e allenamento non vengono convertiti in un unico punteggio di fatica.</p>
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px', fontSize: 'var(--font-size-meta)' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Settimana</th>
                                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Workout</th>
                                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Volume</th>
                                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Passi medi</th>
                                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Copertura passi</th>
                                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Cardio</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trainingActivityContext.map(point => (
                                <tr key={point.weekStart} style={{ borderTop: '1px solid var(--glass-border)' }}>
                                    <td style={{ padding: '8px 6px' }}>{point.label}</td>
                                    <td style={{ textAlign: 'right', padding: '8px 6px' }}>{point.workoutCount}</td>
                                    <td style={{ textAlign: 'right', padding: '8px 6px' }}>{point.volumeKg > 0 ? `${(point.volumeKg / 1000).toFixed(1)} t` : '—'}</td>
                                    <td style={{ textAlign: 'right', padding: '8px 6px' }}>{point.averageSteps === null ? '—' : integerFormatter.format(point.averageSteps)}</td>
                                    <td style={{ textAlign: 'right', padding: '8px 6px' }}>{point.stepDaysCount}/{point.daysConsidered}</td>
                                    <td style={{ textAlign: 'right', padding: '8px 6px' }}>{decimalFormatter.format(point.cardioMinutes)} min</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
}
