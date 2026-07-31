import { lazy, Suspense } from 'react';
import { useHomeView } from '../../hooks/useHomeView';
import MuscleModel from '../Training/MuscleModel';

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
      <h2 style={{ marginTop: '10px', marginBottom: '25px' }}>Panoramica di Oggi</h2>
      
      {isRestDay ? (
        <div className="card" id="home-workout-widget" style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '4px solid var(--primary-color)' }}>
          <div style={{ fontSize: '2.5rem' }}>😴</div>
          <div>
              <h3 style={{ margin: 0 }}>Riposo</h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>Nessun allenamento oggi.</p>
          </div>
          <button className="btn btn-small btn-primary" style={{ marginLeft: 'auto', marginBottom: 0 }} onClick={() => onNavigate('training')}>Vai</button>
        </div>
      ) : (
        <div className="card" id="home-workout-widget" style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '4px solid var(--success-color)' }}>
           <div style={{ fontSize: '2.5rem' }}>💪</div>
           <div>
              <h3 style={{ margin: 0 }}>Allenamento Completato</h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>{todaysWorkout?.routineName || 'Sessione'} — {todaysWorkout?.exercises?.length || 0} Esercizi</p>
           </div>
        </div>
      )}

      <div className="card" id="home-nutrition-widget">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>Nutrizione Odierna</h3>
              <button className="btn-icon" style={{ color: 'var(--primary-color)' }} onClick={() => onNavigate('nutrition')}>✏️</button>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)' }}>{kcalEaten || 0}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>kcal assunte</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--warning-color)' }}>{kcalTarget}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>TDEE teorico</div>
              </div>
          </div>

          <div className="progress-bg" style={{ marginBottom: '20px' }}>
              <div className="progress-fill" style={{ width: `${(kcalTarget || 0) > 0 ? Math.min(((kcalEaten || 0)/(kcalTarget || 1))*100, 100) : 0}%`, background: 'linear-gradient(90deg, var(--warning-color), #fcd34d)' }}></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--success-color)', fontWeight: 'bold' }}>CARBO</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{carbs}g</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 'bold' }}>PRO</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{pro}g</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--danger-color)', fontWeight: 'bold' }}>GRASSI</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{fat}g</div>
              </div>
          </div>
      </div>

      {/* Real TDEE Estimator Widget */}
      <div className="card" style={{ border: '1px solid rgba(46, 204, 113, 0.3)', background: 'linear-gradient(145deg, rgba(0, 0, 0, 0.6) 0%, rgba(46, 204, 113, 0.05) 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                  <h3 style={{ margin: 0, color: 'var(--success-color)' }}>TDEE Reale Stimato</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Basato sull'andamento del peso</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                  {tdeeCalc?.error ? (
                      <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>-- kcal</span>
                  ) : (
                      <span style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--success-color)' }}>{tdeeCalc?.tdee} <span style={{fontSize:'1rem'}}>kcal</span></span>
                  )}
              </div>
          </div>
          
          <div style={{ marginTop: '15px', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.85rem' }}>
              {tdeeCalc?.error ? (
                  <div style={{ color: 'var(--warning-color)', textAlign: 'center' }}>
                      ⏳ {tdeeCalc?.message}
                  </div>
              ) : (
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Media Calorie Assunte ({tdeeCalc?.daysTracked}gg):</span>
                          <span style={{ fontWeight: 'bold' }}>{tdeeCalc?.avgKcal} kcal</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Variazione Peso Totale:</span>
                          <span style={{ fontWeight: 'bold', color: Number(tdeeCalc?.weightDiff || 0) > 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>{Number(tdeeCalc?.weightDiff || 0) > 0 ? '+' : ''}{tdeeCalc?.weightDiff} kg</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Deficit/Surplus Teorico:</span>
                          <span style={{ fontWeight: 'bold' }}>{(tdeeCalc as any)?.dailyDeficit! > 0 ? '+' : ''}{(tdeeCalc as any)?.dailyDeficit} kcal/gg</span>
                      </div>
                  </div>
              )}
          </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Massa Grassa (Stima)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>{bf} %</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Streak Attuale 🔥</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: (streak || 0) > 0 ? 'var(--warning-color)' : 'var(--text-main)', marginTop: '5px' }}>{streak || 0} gg</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Totale Sessioni</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>💪 {totalWorkouts}</div>
          </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: '1 1 calc(50% - 15px)', minWidth: '150px', marginBottom: 0 }}>
              <h3 style={{ marginBottom: '10px', fontSize: '0.9rem', textAlign: 'center' }}>Stato Muscolare (72h)</h3>
              <div style={{ padding: '0', margin: '0 -15px' }}>
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
          <h3 style={{ marginBottom: '15px' }}>Trend Peso Corporeo (Ultimi 14gg)</h3>
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
