import { lazy, Suspense } from 'react';
import { Scale } from 'lucide-react';
import { useHomeView } from '../../hooks/useHomeView';
import { useAppStore } from '../../store/useAppStore';
import HomeWorkoutWidget from './widgets/HomeWorkoutWidget';
import HomeNutritionWidget from './widgets/HomeNutritionWidget';
import HeaderDashboard from './widgets/HeaderDashboard';
import BiometryBentoCard from './widgets/BiometryBentoCard';
import RecoveryBentoCard from './widgets/RecoveryBentoCard';
import ReadinessTrendCard from './widgets/ReadinessTrendCard';
import './home.css';

const WeightChart = lazy(() => import('./WeightChart'));
const WeeklyVolumeChart = lazy(() => import('../analytics/WeeklyVolumeChart'));
const VolumeCaloriesCorrelationChart = lazy(() => import('../analytics/VolumeCaloriesCorrelationChart'));

const PERIOD_OPTIONS = [
  { id: '7d', label: '1 sett' },
  { id: '30d', label: '1 mese' },
  { id: '180d', label: '6 mesi' },
  { id: '365d', label: '1 anno' }
] as const;

const CHART_LOADING = (
    <div className="home-chart-loading" role="status">
        <div className="spinner" />
        <span className="text-sm home-muted">Caricamento grafico...</span>
    </div>
);

const HomeView = ({ onNavigate }: any) => {
  const homeState = useHomeView();
  const activeWorkout = useAppStore(state => state.localWorkout);
  
  if (homeState.loading) {
      return <div className="view-section active">{CHART_LOADING}</div>;
  }

  const {
      isRestDay, todaysWorkout,
      kcalEaten, carbs, pro, fat, kcalTarget,
      bf, bfSource, streak, totalWorkouts,
      chartData,
      weightPeriod, setWeightPeriod, weightStats,
      activePains, painColors, muscleColors, toggleActivePain,
      history, nutrition, library, userWeight
  } = homeState;

  return (
    <div id="view-home" className="view-section active">
      
      <div className="home-bento-grid">
        {/* Header - Full Width */}
        <div className="bento-full">
            <HeaderDashboard streak={streak} totalWorkouts={totalWorkouts} />
        </div>

        {/* Workout Hero - Full Width */}
            <div className="card bento-full home-flush-card">
                <HomeWorkoutWidget
                    isRestDay={isRestDay}
                    todaysWorkout={todaysWorkout}
                    activeWorkout={activeWorkout}
                    onNavigate={onNavigate}
                />
            </div>

        {/* Nutrition - Full Width */}
        <div className="card bento-full home-flush-card">
            <HomeNutritionWidget
                kcalEaten={kcalEaten}
                kcalTarget={kcalTarget}
                carbs={carbs}
                pro={pro}
                fat={fat}
                onNavigate={onNavigate}
            />
        </div>

        {/* Biometria + Recovery - Half Width Each */}
        <div className="card home-biometry-card">
            <BiometryBentoCard weightStats={weightStats} bf={bf} bfSource={bfSource} />
        </div>

        <div className="card home-recovery-card">
            <RecoveryBentoCard 
                activePains={activePains} 
                painColors={painColors} 
                muscleColors={muscleColors} 
                onTogglePain={toggleActivePain} 
            />
        </div>

        {/* Analytics & Progression Dashboard - Full Width */}
        <div className="bento-full home-analytics" id="home-analytics-section">
            <Suspense fallback={CHART_LOADING}>
                <WeeklyVolumeChart
                    history={history}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <Suspense fallback={CHART_LOADING}>
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={nutrition}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <ReadinessTrendCard history={history} />
            
            {/* Trend Peso Corporeo */}
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
                            {weightStats.recentWeeklyAverages.map((point: any) => (
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
        </div>

      </div>
    </div>
  );
};

export default HomeView;
