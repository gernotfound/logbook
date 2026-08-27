import { lazy, Suspense } from 'react';
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
      activePains, painColors,
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
        {!isRestDay && (
            <div className="card bento-full" style={{ padding: 0, overflow: 'hidden', margin: 0 }}>
                <HomeWorkoutWidget
                    isRestDay={isRestDay}
                    todaysWorkout={todaysWorkout}
                    onNavigate={onNavigate}
                />
            </div>
        )}

        {/* Nutrition - Full Width */}
        <div className="card bento-full" style={{ padding: 0, margin: 0 }}>
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
        <div className="card" style={{ margin: 0 }}>
            <BiometryBentoCard weightStats={weightStats} bf={bf} />
        </div>

        <div className="card" style={{ margin: 0 }}>
            <RecoveryBentoCard activePains={activePains} painColors={painColors} />
        </div>

        {/* Analytics & Progression Dashboard - Full Width */}
        <div className="bento-full" id="home-analytics-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Suspense fallback={<div className="card" style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}><div className="spinner" style={{ margin: 'auto' }}></div></div>}>
                <WeeklyVolumeChart
                    history={history}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>

            <Suspense fallback={<div className="card" style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}><div className="spinner" style={{ margin: 'auto' }}></div></div>}>
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={nutrition}
                    library={library}
                    userWeight={userWeight}
                />
            </Suspense>
            
            {/* Trend Peso Corporeo */}
            <div className="card" id="home-chart-widget" style={{ padding: '16px', margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '15px' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Trend peso corporeo</h2>
                    </div>

                    {/* Period Selector Tabs */}
                    <div style={{
                        display: 'flex',
                        background: 'rgba(255, 255, 255, 0.06)',
                        borderRadius: '10px',
                        padding: '3px',
                        gap: '2px',
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        {PERIOD_OPTIONS.map(p => {
                            const isActive = weightPeriod === p.id;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setWeightPeriod(p.id)}
                                    style={{
                                        background: isActive ? 'var(--primary-color)' : 'transparent',
                                        color: isActive ? '#ffffff' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: '7px',
                                        padding: '6px 10px',
                                        fontSize: '0.8rem',
                                        fontWeight: isActive ? '600' : 'normal',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div style={{ height: '220px', width: '100%', position: 'relative' }}>
                    {weightStats?.hasDataInPeriod && chartData ? (
                        <Suspense fallback={<div className="spinner" style={{ margin: 'auto' }}></div>}>
                            <WeightChart chartData={chartData} />
                        </Suspense>
                    ) : (
                        <div style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                            textAlign: 'center',
                            padding: '20px'
                        }}>
                            <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⚖️</div>
                            <div style={{ fontSize: '0.9rem' }}>Nessuna misurazione registrata in questo intervallo.</div>
                            <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.7 }}>Registra il tuo peso nella sezione Dati.</div>
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