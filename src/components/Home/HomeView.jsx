import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

/**
 * Calculate consecutive training streak (days in a row up to today).
 */
function calcStreak(history) {
    if (!history || history.length === 0) return 0;
    
    // Build a set of workout date strings
    const workoutDates = new Set(
        history
            .filter(w => w.globalStartTime)
            .map(w => new Date(w.globalStartTime).toISOString().split('T')[0])
    );

    let streak = 0;
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Check if worked out today or yesterday to begin streak count
    const startDate = workoutDates.has(todayStr) ? new Date(today) : (() => {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().split('T')[0];
        return workoutDates.has(yStr) ? yesterday : null;
    })();
    
    if (!startDate) return 0;
    
    const cur = new Date(startDate);
    while (true) {
        const dateStr = cur.toISOString().split('T')[0];
        if (workoutDates.has(dateStr)) {
            streak++;
            cur.setDate(cur.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

const HomeView = ({ onNavigate }) => {
  const { userData } = useAuth();
  
  if (!userData) {
      return <div className="view-section active"><div className="spinner"></div></div>;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const history = userData.history || [];
  const nutrition = userData.nutrition || {};
  
  // Calculate today's workout
  const todaysWorkout = history.find(s => {
      if (!s.globalStartTime) return false;
      return new Date(s.globalStartTime).toISOString().split('T')[0] === todayStr;
  });
  const isRestDay = !todaysWorkout;

  // Calculate today's nutrition
  const todayNutrition = nutrition[todayStr] || { kcal: 0, carbs: 0, pro: 0, fat: 0 };
  const kcalEaten = todayNutrition.kcal || 0;
  const carbs = todayNutrition.carbs || 0;
  const pro = todayNutrition.pro || 0;
  const fat = todayNutrition.fat || 0;

  // Get Targets from planning
  const kcalTarget = userData?.nutritionPlanning?.normocalorica?.kcal || 
                     userData?.nutritionPlanning?.totalKcal || 2500;
  
  // Get BF % — use today's or most recent measurement
  const currentWeight = todayNutrition.weight || 
                        (Object.values(nutrition).reverse().find(n => n.weight)?.weight) || 
                        userData?.nutritionPlanning?.weight || 80;
  let bf = "--";
  if (userData.profile && Object.keys(userData.profile).length > 0) {
      const calcBf = Logic.calculateBodyFat(currentWeight, userData.profile);
      if (calcBf) bf = Number(calcBf).toFixed(1);
  }

  // FIX: Use real consecutive streak calculation
  const streak = calcStreak(history);
  const totalWorkouts = history.length;

  // Chart Logic (Last 14 days)
  const sortedDates = Object.keys(nutrition).sort((a,b) => new Date(a) - new Date(b));
  const recentDates = sortedDates.slice(-14);
  const chartData = {
      labels: recentDates.map(d => d.slice(5).replace('-', '/')),
      datasets: [
          {
              label: 'Peso Corporeo (kg)',
              data: recentDates.map(d => {
                  const w = nutrition[d]?.weight;
                  return (w && !isNaN(parseFloat(w))) ? parseFloat(w) : null;
              }),
              borderColor: '#0ea5e9',
              backgroundColor: 'rgba(14, 165, 233, 0.2)',
              tension: 0.4,
              pointRadius: 4,
              pointBackgroundColor: '#0ea5e9',
              spanGaps: true // connect across null values
          }
      ]
  };

  const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
          legend: { display: false }
      },
      scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { 
              ticks: { color: '#94a3b8' }, 
              grid: { color: 'rgba(255,255,255,0.05)' },
              // Auto-scale based on data, avoid toFixed crash with null check
              grace: '5%'
          }
      }
  };

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
              <p style={{ margin: 0, fontSize: '0.85rem' }}>{todaysWorkout.routineName || 'Sessione'} — {todaysWorkout.exercises?.length || 0} Esercizi</p>
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
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)' }}>{kcalEaten}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>kcal assunte</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--warning-color)' }}>{kcalTarget}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>TDEE stimato</div>
              </div>
          </div>

          <div className="progress-bg" style={{ marginBottom: '20px' }}>
              <div className="progress-fill" style={{ width: `${kcalTarget > 0 ? Math.min((kcalEaten/kcalTarget)*100, 100) : 0}%`, background: 'linear-gradient(90deg, var(--warning-color), #fcd34d)' }}></div>
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
                  <div style={{ fontSize: '0.75rem', color: '#f43f5e', fontWeight: 'bold' }}>GRASSI</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{fat}g</div>
              </div>
          </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Massa Grassa (Stima)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>{bf} %</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Streak Attuale 🔥</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: streak > 0 ? 'var(--warning-color)' : 'var(--text-main)', marginTop: '5px' }}>{streak} gg</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', marginBottom: 0, padding: '15px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Totale Sessioni</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '5px' }}>💪 {totalWorkouts}</div>
          </div>
      </div>

      <div className="card" id="home-chart-widget">
          <h3 style={{ marginBottom: '15px' }}>Trend Peso Corporeo (Ultimi 14gg)</h3>
          <div style={{ position: 'relative', height: '200px', width: '100%' }}>
              {recentDates.length > 0 ? (
                  <Line data={chartData} options={chartOptions} />
              ) : (
                  <p style={{textAlign:'center', color:'var(--text-muted)', paddingTop:'80px'}}>Nessun dato sul peso. Registra una misurazione!</p>
              )}
          </div>
      </div>
    </div>
  );
};

export default HomeView;
