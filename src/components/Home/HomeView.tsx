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

interface HomeViewProps {
  onNavigate: (view: string) => void;
}

const ChartFallback = () => (
  <div className="card analytics-card">
    <div className="empty-state" role="status" aria-label="Caricamento grafico">
      <div className="spinner" />
    </div>
  </div>
);

const HomeView = ({ onNavigate }: HomeViewProps) => {
  const homeState = useHomeView();

  if (homeState.loading) {
    return (
      <div className="view-section active">
        <div className="empty-state" role="status" aria-label="Caricamento home">
          <div className="spinner" />
        </div>
      </div>
    );
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

        <div className="card home-panel home-panel--flush bento-full">
          <HomeWorkoutWidget
            isRestDay={isRestDay}
            todaysWorkout={todaysWorkout}
            onNavigate={onNavigate}
          />
        </div>

        <div className="card home-panel home-panel--flush bento-full">
          <HomeNutritionWidget
            kcalEaten={kcalEaten}
            kcalTarget={kcalTarget}
            carbs={carbs}
            pro={pro}
            fat={fat}
            onNavigate={onNavigate}
          />
        </div>

        <div className="card home-panel">
          <BiometryBentoCard weightStats={weightStats} bf={bf} />
        </div>

        <div className="card home-panel">
          <RecoveryBentoCard
            activePains={activePains}
            painColors={painColors}
            muscleColors={muscleColors}
            onTogglePain={toggleActivePain}
          />
        </div>

        <div className="bento-full home-analytics-stack" id="home-analytics-section">
          <Suspense fallback={<ChartFallback />}>
            <WeeklyVolumeChart
              history={history}
              library={library}
              userWeight={userWeight}
            />
          </Suspense>

          <Suspense fallback={<ChartFallback />}>
            <VolumeCaloriesCorrelationChart
              history={history}
              nutrition={nutrition}
              library={library}
              userWeight={userWeight}
            />
          </Suspense>

          <div className="card analytics-card" id="home-chart-widget">
            <div className="analytics-card__header">
              <h2>Trend peso corporeo</h2>

              <div className="segmented-control" aria-label="Intervallo trend peso">
                {PERIOD_OPTIONS.map(period => {
                  const isActive = weightPeriod === period.id;
                  return (
                    <button
                      key={period.id}
                      type="button"
                      className={`segmented-control__item ${isActive ? 'is-active' : ''}`}
                      aria-pressed={isActive}
                      onClick={() => setWeightPeriod(period.id)}
                    >
                      {period.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="analytics-chart">
              {weightStats?.hasDataInPeriod && chartData ? (
                <Suspense fallback={
                  <div className="empty-state" role="status" aria-label="Caricamento trend peso">
                    <div className="spinner" />
                  </div>
                }>
                  <WeightChart chartData={chartData} />
                </Suspense>
              ) : (
                <div className="empty-state">
                  <Scale size={26} aria-hidden="true" />
                  <div className="empty-state__title">Nessuna misurazione in questo intervallo</div>
                  <div className="empty-state__hint">Registra il peso nella sezione Dati.</div>
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
