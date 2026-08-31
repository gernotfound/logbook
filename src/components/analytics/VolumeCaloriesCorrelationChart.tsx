import { useState, useMemo, useEffect } from 'react';
import { Chart } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { useAnalyticsWorker } from '../../hooks/useAnalyticsWorker';
import type { WorkoutSession, NutritionDay, Exercise } from '../../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export interface VolumeCaloriesCorrelationChartProps {
  history?: WorkoutSession[];
  nutrition?: Record<string, NutritionDay>;
  library?: Exercise[];
  userWeight?: number;
  defaultWeeks?: number;
}

const PERIOD_OPTIONS = [
  { id: 4, label: '4 sett' },
  { id: 8, label: '8 sett' },
  { id: 12, label: '12 sett' },
  { id: 24, label: '24 sett' },
];

export default function VolumeCaloriesCorrelationChart({
  history = [],
  nutrition = {},
  library = [],
  userWeight = 80,
  defaultWeeks = 8
}: VolumeCaloriesCorrelationChartProps) {
  const [selectedWeeks, setSelectedWeeks] = useState<number>(defaultWeeks);
  const [isCalculating, setIsCalculating] = useState(true);
  const { calculateCorrelationStats } = useAnalyticsWorker();

  const [calcResult, setCalcResult] = useState<{points: any[], stats: any}>({
    points: [],
    stats: { hasData: false, correlationCoefficient: null, correlationInsight: '', avgWeeklyVolumeKg: 0, avgDailyKcal: 0, validDataPointsCount: 0 }
  });

  useEffect(() => {
    let isMounted = true;
    setIsCalculating(true);
    
    calculateCorrelationStats(history, nutrition, library, userWeight, selectedWeeks)
      .then((res: any) => {
        if (isMounted) {
          setCalcResult(res);
          setIsCalculating(false);
        }
      })
      .catch((err: any) => {
        console.error("Errore calcolo grafico correlazione:", err);
        if (isMounted) setIsCalculating(false);
      });

    return () => { isMounted = false; };
  }, [history, nutrition, library, userWeight, selectedWeeks, calculateCorrelationStats]);

  const { points, stats } = calcResult;

  const chartData = useMemo(() => {
    return {
      labels: points.map(p => p.label),
      datasets: [
        {
          type: 'bar' as const,
          label: 'Volume di allenamento (kg)',
          data: points.map(p => p.volumeKg),
          yAxisID: 'yVolume',
          backgroundColor: 'rgba(0, 229, 255, 0.45)',
          hoverBackgroundColor: 'rgba(0, 229, 255, 0.85)',
          borderColor: '#00e5ff',
          borderWidth: 1.5,
          borderRadius: 5,
          borderSkipped: false,
          order: 2
        },
        {
          type: 'line' as const,
          label: 'Calorie medie giornaliere (kcal)',
          data: points.map(p => (p.avgDailyKcal > 0 ? p.avgDailyKcal : null)),
          yAxisID: 'yCalories',
          borderColor: '#ffb703',
          backgroundColor: 'rgba(255, 183, 3, 0.12)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#ffb703',
          pointBorderWidth: 2,
          pointHoverBackgroundColor: '#ffffff',
          pointHoverBorderColor: '#ffb703',
          pointHoverBorderWidth: 3,
          tension: 0.35,
          spanGaps: true,
          order: 1
        }
      ]
    };
  }, [points]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false
      },
      animation: {
        duration: 350,
        easing: 'easeOutQuart' as const
      },
      plugins: {
        legend: {
          display: true,
          position: 'top' as const,
          align: 'end' as const,
          labels: {
            color: '#9ba3af',
            font: { size: 11 },
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(13, 13, 13, 0.95)',
          titleColor: '#f0f0f0',
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          boxPadding: 4,
          callbacks: {
            title: (items: any[]) => {
              if (!items || items.length === 0) return '';
              const idx = items[0].dataIndex;
              const p = points[idx];
              return p ? `Settimana ${p.weekStart} - ${p.weekEnd}` : items[0].label;
            },
            label: (ctx: any) => {
              const idx = ctx.dataIndex;
              const p = points[idx];
              if (ctx.dataset.yAxisID === 'yVolume') {
                const volKg = ctx.parsed.y || 0;
                const ton = (volKg / 1000).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
                const formattedKg = volKg.toLocaleString('it-IT');
                const workouts = p ? ` (${p.workoutCount} ${p.workoutCount === 1 ? 'sessione' : 'sessioni'})` : '';
                return `Volume: ${formattedKg} kg (${ton} t)${workouts}`;
              }
              if (ctx.dataset.yAxisID === 'yCalories') {
                const kcal = ctx.parsed.y || 0;
                const logged = p ? ` (${p.loggedNutritionDays}/7 gg registrati)` : '';
                return `Calorie medie: ${kcal.toLocaleString('it-IT')} kcal/giorno${logged}`;
              }
              return `${ctx.dataset.label}: ${ctx.formattedValue}`;
            }
          }
        }
      },
      scales: {
        yVolume: {
          type: 'linear' as const,
          position: 'left' as const,
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: {
            color: '#00e5ff',
            font: { size: 11 },
            callback: (val: any) => {
              const num = Number(val);
              if (num >= 1000) {
                return `${(num / 1000).toFixed(1)} t`;
              }
              return `${num} kg`;
            }
          }
        },
        yCalories: {
          type: 'linear' as const,
          position: 'right' as const,
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#ffb703',
            font: { size: 11 },
            callback: (val: any) => `${Number(val)} kcal`
          }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#9ba3af', font: { size: 11 } }
        }
      }
    };
  }, [points]);

  return (
    <div className="card" id="volume-calories-correlation-card" style={{ padding: '16px', marginBottom: '20px', position: 'relative' }}>
      {isCalculating && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(13,13,13,0.5)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit' }}>
          <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '15px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={{margin: 0}}>Correlazione volume vs calorie</h2>
            {stats.correlationCoefficient !== null && (
              <span style={{
                fontWeight: '600',
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '6px',
                background: stats.correlationCoefficient >= 0.2 ? 'rgba(0, 229, 255, 0.15)' : (stats.correlationCoefficient <= -0.2 ? 'rgba(255, 183, 3, 0.15)' : 'rgba(255, 255, 255, 0.08)'),
                color: stats.correlationCoefficient >= 0.2 ? 'var(--primary-color)' : (stats.correlationCoefficient <= -0.2 ? 'var(--warning-color)' : 'var(--text-muted)'),
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                r = {stats.correlationCoefficient > 0 ? `+${stats.correlationCoefficient.toFixed(2)}` : stats.correlationCoefficient.toFixed(2)}
              </span>
            )}
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.4, maxWidth: '540px' }}>
            {stats.correlationInsight}
          </div>
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
            const isActive = selectedWeeks === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedWeeks(p.id)}
                style={{
                  background: isActive ? 'var(--primary-color)' : 'transparent',
                  color: isActive ? '#000000' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '6px 10px',
                  fontSize: '0.85rem',
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

      <div style={{ height: '240px', width: '100%', position: 'relative' }}>
        {stats.hasData ? (
          <Chart type="bar" data={chartData as any} options={chartOptions as any} />
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
            <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⚡</div>
            <div style={{ fontSize: '0.95rem' }}>Dati insufficienti per calcolare la correlazione.</div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.7 }}>Registra allenamenti e pasti per visualizzare la relazione tra apporto energetico e carichi.</div>
          </div>
        )}
      </div>
    </div>
  );
}