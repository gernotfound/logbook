import { lazy, Suspense } from 'react';
import { useHomeView } from '../../hooks/useHomeView';
import { useAppStore } from '../../store/useAppStore';
import HomeWorkoutWidget from './widgets/HomeWorkoutWidget';
import HomeNutritionWidget from './widgets/HomeNutritionWidget';
import HeaderDashboard from './widgets/HeaderDashboard';
import BiometryBentoCard from './widgets/BiometryBentoCard';
import RecoveryBentoCard from './widgets/RecoveryBentoCard';
import ReadinessTrendCard from './widgets/ReadinessTrendCard';
import HomeWeightTrendCard from './HomeWeightTrendCard';
import HomeChartLoading from './HomeChartLoading';
import './home.css';

const WeeklyVolumeChart = lazy(() => import('../analytics/WeeklyVolumeChart'));
const VolumeCaloriesCorrelationChart = lazy(() => import('../analytics/VolumeCaloriesCorrelationChart'));

const CHART_LOADING = <HomeChartLoading />;

interface HomeViewProps {
  onNavigate: (view: string) => void;
  onOpenSettings?: () => void;
  isActive?: boolean;
}

const HomeView = ({ onNavigate, onOpenSettings, isActive = true }: HomeViewProps) => {
  const homeState = useHomeView(isActive);
  const activeWorkout = useAppStore(state => state.localWorkout);
  
  if (homeState.loading) {
      return <div className="view-section active">
        <div className="home-chart-loading" role="status">
          <div className="spinner" />
          <span className="text-sm home-muted">Recupero dei dati in corso...</span>
        </div>
      </div>;
  }

  const {
      isRestDay, todaysWorkout,
      kcalEaten, carbs, pro, fat, kcalTarget,
      bf, bfSource, streak, totalWorkouts,
      chartData,
      weightPeriod, setWeightPeriod, weightStats, lastRecordedWeight,
      activePains, painColors, muscleColors, toggleActivePain,
      history, nutrition, library, userWeight
  } = homeState;

  return (
    <div id="view-home" className="view-section active">
      
      <div className="home-bento-grid">
        {/* Header - Full Width */}
        <div className="bento-full">
            <HeaderDashboard streak={streak} totalWorkouts={totalWorkouts} onOpenSettings={onOpenSettings} />
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
            <BiometryBentoCard weightStats={weightStats} lastRecordedWeight={lastRecordedWeight} bf={bf} bfSource={bfSource} />
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
                    isActive={isActive}
                    history={history}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <Suspense fallback={CHART_LOADING}>
                <VolumeCaloriesCorrelationChart
                    isActive={isActive}
                    history={history}
                    nutrition={nutrition}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <ReadinessTrendCard history={history} />
            
            <HomeWeightTrendCard chartData={chartData} weightStats={weightStats} weightPeriod={weightPeriod} setWeightPeriod={setWeightPeriod} />
        </div>

      </div>
    </div>
  );
};

export default HomeView;
