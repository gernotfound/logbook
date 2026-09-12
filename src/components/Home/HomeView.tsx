import { lazy, Suspense } from 'react';
import { Scale } from 'lucide-react';
import { useHomeView } from '../../hooks/useHomeView';
import HomeWorkoutWidget from './widgets/HomeWorkoutWidget';
import HomeNutritionWidget from './widgets/HomeNutritionWidget';
import HeaderDashboard from './widgets/HeaderDashboard';
import BiometryBentoCard from './widgets/BiometryBentoCard';
import RecoveryBentoCard from './widgets/RecoveryBentoCard';

const WeightChart = lazy(() => import('./WeightChart'));
const WeeklyVolumeChart = lazy(() => import('../analytics/WeeklyVolumeChart'));
const VolumeCaloriesCorrelationChart = lazy(() => import('../analytics/VolumeCaloriesCorrelationChart'));

const PERIOD_OPTIONS = [
  { id: '7d', label: '1 sett' },
  { id: '30d', label: '1 mese' },
  { id: '180d', label: '6 mesi' },
  { id: '365d', label: '1 anno' }
] as const;

const HomeView = ({ onNavigate }: any) => {
  const homeState = useHomeView();

  if (homeState.loading) {
      return <div className="view-section active"><div className="spinner"></div></div>;
  }

  const {
      isRestDay, todaysWorkout,
      kcalEaten, carbs, pro, fat, kcalTarget,
      bf, streak, totalWorkouts,
      chartData,
      weightPeriod, setWeightPeriod, weightStats,
      activePains, painColors, muscleColors, toggleActivePain,
      history, nutrition, library, userWeight
  } = homeState;

  return (
    <div id="view-home" className="view-section active">
      <div className="home-bento-grid">
        <div className="bento-full">
            <HeaderDashboard streak={streak} totalWorkouts={totalWorkouts} />
        </div>

        {!isRestDay && (
            <div className="card bento-full home-surface home-surface--flush">
                <HomeWorkoutWidget
                    isRestDay={isRestDay}
                    todaysWorkout={todaysWorkout}
                    onNavigate={onNavigate}
                />
            </div>
        )}

        <div className="card bento-full home-surface home-surface--flush">
            <HomeNutritionWidget
                kcalEaten={kcalEaten}
                kcalTarget={kcalTarget}
                carbs={carbs}
                pro={pro}
                fat={fat}
                onNavigate={onNavigate}
            />
        </div>

        <div className="card home-surface">
            <BiometryBentoCard weightStats={weightStats} bf={bf} />
        </div>

        <div className="card home-surface">
            <RecoveryBentoCard
                activePains={activePains}
                painColors={painColors}
                muscleColors={muscleColors}
                onTogglePain={toggleActivePain}
            />
        </div>

        <div className="bento-full analytics-stack" id="home-analytics-section">
            <Suspense fallback={<div className="card chart-loading-surface"><div className="spinner"></div></div>}>
                <WeeklyVolumeChart
                    history={history}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <Suspense fallback={<div className="card chart-loading-surface chart-loading-surface--tall"><div className="spinner"></div></div>}>
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={nutrition}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <div className="card home-chart-surface" id="home-chart-widget">
                <div className="chart-header">
                    <h2>Trend peso corporeo</h2>

                    <div className="segmented-control" role="group" aria-label="Intervallo trend peso">
                        {PERIOD_OPTIONS.map(p => {
                            const isActive = weightPeriod === p.id;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    className={`segmented-btn ${isActive ? 'active' : ''}`}
                                    aria-pressed={isActive}
                                    onClick={() => setWeightPeriod(p.id)}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="chart-body">
                    {weightStats?.hasDataInPeriod && chartData ? (
                        <Suspense fallback={<div className="chart-loading-inline"><div className="spinner"></div></div>}>
                            <WeightChart chartData={chartData} />
                        </Suspense>
                    ) : (
                        <div className="chart-empty-state">
                            <Scale size={28} aria-hidden="true" />
                            <div className="chart-empty-state__title">Nessuna misurazione registrata in questo intervallo.</div>
                            <div className="chart-empty-state__hint">Registra il tuo peso nella sezione Dati.</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
