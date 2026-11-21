import { lazy, Suspense } from 'react';
import { Scale } from 'lucide-react';
import type { HomeViewState } from '../../hooks/useHomeView';
import HomeChartLoading from './HomeChartLoading';

const WeightChart = lazy(() => import('./WeightChart'));

const PERIOD_OPTIONS = [
  { id: '7d', label: '1 sett' },
  { id: '30d', label: '1 mese' },
  { id: '180d', label: '6 mesi' },
  { id: '365d', label: '1 anno' },
] as const;

type LoadedHomeState = Extract<HomeViewState, { loading: false }>;
type Props = Pick<LoadedHomeState, 'chartData' | 'weightStats' | 'weightPeriod' | 'setWeightPeriod'>;

const CHART_LOADING = <HomeChartLoading />;

export default function HomeWeightTrendCard({ chartData, weightStats, weightPeriod, setWeightPeriod }: Props) {
  return (
            <section className="card home-chart-card" id="home-chart-widget">
                <div className="home-chart-header">
                    <div>
                        <h2>Trend peso corporeo</h2>
                    </div>

                    {/* Period Selector Tabs */}
                    <div className="chart-period-control" role="group" aria-label="Periodo del peso corporeo">
                        {PERIOD_OPTIONS.map(p => {
                            const isActive = weightPeriod === p.id;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setWeightPeriod(p.id)}
                                    aria-pressed={isActive}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="home-chart-canvas">
                    {weightStats?.hasDataInPeriod && chartData ? (
                        <Suspense fallback={CHART_LOADING}>
                            <WeightChart chartData={chartData} />
                        </Suspense>
                    ) : (
                        <div className="home-chart-empty">
                            <Scale size={32} aria-hidden="true" />
                            <p>Nessuna misurazione registrata in questo intervallo.</p>
                            <p className="text-sm">Registra il tuo peso nella sezione Dati.</p>
                        </div>
                    )}
                </div>
                {weightStats?.recentWeeklyAverages?.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                        <p className="text-sm home-muted" style={{ margin: '0 0 8px' }}>
                            Medie settimanali calcolate solo sui giorni registrati; i giorni mancanti non vengono interpolati.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                            {weightStats.recentWeeklyAverages.map(point => (
                                <div key={point.weekStart} style={{ padding: '10px', borderRadius: '8px', background: 'var(--surface-light)', border: '1px solid var(--glass-border)' }}>
                                    <span className="text-xs home-muted">{point.label}</span>
                                    <strong style={{ display: 'block' }}>{point.averageWeightKg.toFixed(1)} kg</strong>
                                    <span className="text-xs home-muted">{point.recordedDaysCount}/{point.daysConsidered} giorni</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>
  );
}
