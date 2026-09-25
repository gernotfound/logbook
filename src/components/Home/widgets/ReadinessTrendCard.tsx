import { useMemo } from 'react';
import { computeReadinessTrends } from '../../../lib/calc/analytics';
import type { WorkoutSession } from '../../../types';

const labels = {
    energy: 'Energia',
    stress: 'Stress',
    motivation: 'Motivazione',
    muscleRecovery: 'Recupero muscolare',
} as const;

export default function ReadinessTrendCard({ history }: { history: WorkoutSession[] }) {
    const stats = useMemo(() => computeReadinessTrends(history, 12), [history]);
    const entries = (Object.keys(labels) as Array<keyof typeof labels>).map(key => ({
        key,
        label: labels[key],
        value: stats[key],
    }));

    return (
        <section className="card home-chart-card" aria-labelledby="readiness-trends-title">
            <div className="home-chart-header">
                <div>
                    <h2 id="readiness-trends-title">Trend readiness</h2>
                    <p className="text-sm home-muted" style={{ margin: '4px 0 0' }}>
                        Ultime {stats.sessionsWithReadiness} sessioni con check-in. Le dimensioni restano separate: LogBook non crea un punteggio readiness unico.
                    </p>
                </div>
            </div>
            {stats.sessionsWithReadiness === 0 ? (
                <div className="home-chart-empty">
                    <p>Nessun check-in readiness disponibile.</p>
                </div>
            ) : (
                <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px', margin: 0 }}>
                    {entries.map(({ key, label, value }) => (
                        <div key={key} style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'var(--surface-light)' }}>
                            <dt className="text-sm home-muted">{label}</dt>
                            <dd style={{ margin: '4px 0 0', fontSize: '1.25rem', fontWeight: 700 }}>
                                {value.latest === null ? '—' : `${value.latest.toFixed(1)}/5`}
                            </dd>
                            <span className="text-xs home-muted">
                                Media {value.average === null ? '—' : value.average.toFixed(1)}
                                {value.deltaFromPrevious !== null ? ` · Δ ultima/precedente ${value.deltaFromPrevious > 0 ? '+' : ''}${value.deltaFromPrevious.toFixed(1)}` : ''}
                                {' · '}{value.count} valori
                            </span>
                        </div>
                    ))}
                </dl>
            )}
        </section>
    );
}
