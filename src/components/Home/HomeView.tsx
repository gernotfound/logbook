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

const ChartFallback = ({ height }: { height: number }) => (
    <div className="card home-card chart-fallback" style={{ height }}>
        <div className="spinner" />
    </div>
);

const HomeView = ({ onNavigate }: any) => {
  const homeState = useHomeView();

  if (homeState.loading) {
      return (
          <div className="view-section active">
              <div className="spinner" />
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

        {!isRestDay && (
            <div className="card home-card home-card--flush bento-full">
                <HomeWorkoutWidget
                    isRestDay={isRestDay}
                    todaysWorkout={todaysWorkout}
                    onNavigate={onNavigate}
                />
            </div>
        )}

        <div className="card home-card home-card--flush bento-full">
            <HomeNutritionWidget
                kcalEaten={kcalEaten}
                kcalTarget={kcalTarget}
                carbs={carbs}
                pro={pro}
                fat={fat}
                onNavigate={onNavigate}
            />
        </div>

        <div className="card home-card home-card--compact">
            <BiometryBentoCard weightStats={weightStats} bf={bf} />
        </div>

        <div className="card home-card home-card--compact">
            <RecoveryBentoCard
                activePains={activePains}
                painColors={painColors}
                muscleColors={muscleColors}
                onTogglePain={toggleActivePain}
            />
        </div>

        <div className="bento-full home-analytics-stack" id="home-analytics-section">
            <Suspense fallback={<ChartFallback height={220} />}>
                <WeeklyVolumeChart
                    history={history}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <Suspense fallback={<ChartFallback height={240} />}>
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={nutrition}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <div className="card home-chart-card" id="home-chart-widget">
                <div className="home-chart-header">
                    <h2>Trend peso corporeo</h2>

                    <div className="segmented-control" aria-label="Periodo trend peso">
                        {PERIOD_OPTIONS.map(period => {
                            const isActive = weightPeriod === period.id;
                            return (
                                <button
                                    key={period.id}
                                    type="button"
                                    onClick={() => setWeightPeriod(period.id)}
                                    className={`segmented-control__item ${isActive ? 'active' : ''}`}
                                    aria-pressed={isActive}
                                >
                                    {period.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="home-chart-body">
                    {weightStats?.hasDataInPeriod && chartData ? (
                        <Suspense fallback={<div className="spinner" />}>
                            <WeightChart chartData={chartData} />
                        </Suspense>
                    ) : (
                        <div className="empty-state">
                            <div className="empty-state__icon"><Scale size={21} aria-hidden="true" /></div>
                            <div className="empty-state__title">Nessuna misurazione in questo intervallo.</div>
                            <div className="empty-state__hint">Registra il tuo peso nella sezione Dati.</div>
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
