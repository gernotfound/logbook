import { lazy, Suspense } from 'react';
import { useHomeView } from '../../hooks/useHomeView';
import MuscleModel from '../Training/MuscleModel';
import HomeWorkoutWidget from './widgets/HomeWorkoutWidget';
import HomeNutritionWidget from './widgets/HomeNutritionWidget';
import HomeTdeeWidget from './widgets/HomeTdeeWidget';

const WeightChart = lazy(() => import('./WeightChart'));
const VolumeChart = lazy(() => import('./VolumeChart'));

const PERIOD_OPTIONS = [
  { id: '7d', label: '1 sett' },
  { id: '30d', label: '1 mese' },
  { id: '180d', label: '6 mesi' },
  { id: '365d', label: '1 anno' }
] as const;

const HomeView = ({ onNavigate }: any) => {
  const {
      loading, isRestDay, todaysWorkout,
      kcalEaten, carbs, pro, fat, kcalTarget,
      bf, streak, totalWorkouts,
      tdeeCalc, recentDates, chartData,
      weightPeriod, setWeightPeriod, weightStats,
      muscleColors, volumeChartData
  } = useHomeView();
  
  if (loading) {
      return <div className="view-section active"><div className="spinner"></div></div>;
  }

  return (
    <div id="view-home" className="view-section active">
      <h2 style={{ marginTop: '10px', marginBottom: '25px' }}>Panoramica di oggi</h2>
      
      <HomeWorkoutWidget
        isRestDay={isRestDay}
        todaysWorkout={todaysWorkout}
        onNavigate={onNavigate}
      />

      <HomeNutritionWidget
        kcalEaten={kcalEaten}
        kcalTarget={kcalTarget}
        carbs={carbs}
        pro={pro}
        fat={fat}
        onNavigate={onNavigate}
      />

      <HomeTdeeWidget tdeeCalc={tdeeCalc} />

      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Massa grassa (stima)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>{bf !== '--' ? `${bf} %` : '--'}</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Streak attuale 🔥</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: (streak || 0) > 0 ? 'var(--warning-color)' : 'var(--text-main)', marginTop: '5px' }}>{streak || 0} gg</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Totale sessioni</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>💪 {totalWorkouts}</div>
          </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: '1 1 calc(50% - 15px)', minWidth: '150px', marginBottom: 0, overflow: 'hidden' }}>
              <h3 style={{ marginBottom: '10px', fontSize: '0.9rem', textAlign: 'center' }}>Stato muscolare (72h)</h3>
              <div style={{ padding: '0', margin: '0' }}>
                  <MuscleModel muscleColors={muscleColors} interactive={false} />
              </div>
          </div>
          
          <div className="card" style={{ flex: '1 1 calc(50% - 15px)', minWidth: '150px', marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ marginBottom: '10px', fontSize: '0.9rem', textAlign: 'center' }}>Volume (7gg)</h3>
              <div style={{ flex: 1, minHeight: '150px', width: '100%', position: 'relative' }}>
                  <Suspense fallback={<div className="spinner" style={{ margin: 'auto' }}></div>}>
                      <VolumeChart chartData={volumeChartData} />
                  </Suspense>
              </div>
          </div>
      </div>

      <div className="card" id="home-chart-widget" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '15px' }}>
              <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Trend peso corporeo</h3>
                  {weightStats?.latestWeight ? (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span>Ultimo: <strong style={{ color: 'var(--text-main)' }}>{weightStats.latestWeight} kg</strong></span>
                          {weightStats.weightDelta !== null && (
                              <span style={{
                                  fontWeight: '600',
                                  fontSize: '0.8rem',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: weightStats.weightDelta < 0 ? 'rgba(74, 222, 128, 0.15)' : (weightStats.weightDelta > 0 ? 'rgba(248, 113, 113, 0.15)' : 'rgba(255, 255, 255, 0.08)'),
                                  color: weightStats.weightDelta < 0 ? '#4ade80' : (weightStats.weightDelta > 0 ? '#f87171' : 'var(--text-muted)')
                              }}>
                                  {weightStats.weightDelta > 0 ? `+${weightStats.weightDelta.toFixed(1)}` : weightStats.weightDelta.toFixed(1)} kg
                              </span>
                          )}
                          {weightStats.minWeight !== null && weightStats.maxWeight !== null && weightStats.minWeight !== weightStats.maxWeight && (
                              <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                  (min {weightStats.minWeight} • max {weightStats.maxWeight} kg)
                              </span>
                          )}
                      </div>
                  ) : null}
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
  );
};

export default HomeView;
