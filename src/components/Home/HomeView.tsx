import { lazy, Suspense } from 'react';
import { useHomeView } from '../../hooks/useHomeView';
import MuscleModel from '../Training/MuscleModel';
import HomeWorkoutWidget from './widgets/HomeWorkoutWidget';
import HomeNutritionWidget from './widgets/HomeNutritionWidget';
import HomeTdeeWidget from './widgets/HomeTdeeWidget';

const WeightChart = lazy(() => import('./WeightChart'));
const VolumeChart = lazy(() => import('./VolumeChart'));

const HomeView = ({ onNavigate }: any) => {
  const {
      loading, isRestDay, todaysWorkout,
      kcalEaten, carbs, pro, fat, kcalTarget,
      bf, streak, totalWorkouts,
      tdeeCalc, recentDates, chartData,
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
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>{bf} %</div>
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

      <div className="card" id="home-chart-widget">
          <h3 style={{ marginBottom: '15px' }}>Trend peso corporeo (ultimi 14gg)</h3>
          <div style={{ height: '200px', width: '100%' }}>
              {recentDates && recentDates.length > 0 && chartData ? (
                  <Suspense fallback={<div className="spinner" style={{ margin: 'auto' }}></div>}>
                      <WeightChart chartData={chartData} />
                  </Suspense>
              ) : (
                  <p style={{textAlign:'center', color:'var(--text-muted)', paddingTop:'80px'}}>Nessun dato sul peso. Registra una misurazione!</p>
              )}
          </div>
      </div>
    </div>
  );
};

export default HomeView;
