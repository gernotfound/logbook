import { useState, useMemo, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { useAnalyticsWorker } from '../../hooks/useAnalyticsWorker';
import type { WorkoutSession, Exercise } from '../../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export interface WeeklyVolumeChartProps {
  history?: WorkoutSession[];
  library?: Exercise[];
  userWeight?: number;
  defaultWeeks?: number;
  onSelectWeek?: (weekStart: string) => void;
}

const PERIOD_OPTIONS = [
  { id: 4, label: '4 sett' },
  { id: 8, label: '8 sett' },
  { id: 12, label: '12 sett' },
  { id: 24, label: '24 sett' },
];

export default function WeeklyVolumeChart({
  history = [],
  library = [],
  userWeight = 80,
  defaultWeeks = 8,
  onSelectWeek
}: WeeklyVolumeChartProps) {
  const [selectedWeeks, setSelectedWeeks] = useState<number>(defaultWeeks);
  const [isCalculating, setIsCalculating] = useState(true);
  const { calculateVolumeStats } = useAnalyticsWorker();

  const [calcResult, setCalcResult] = useState<{points: any[], stats: any}>({
    points: [],
    stats: { hasData: false, currentWeekVolumeKg: 0, avgWeeklyVolumeKg: 0, percentageChange: null }
  });

  useEffect(() => {
    let isMounted = true;
    setIsCalculating(true);
    
    calculateVolumeStats(history, library, userWeight, selectedWeeks)
      .then((res: any) => {
        if (isMounted) {
          setCalcResult(res);
          setIsCalculating(false);
        }
      })
      .catch((err: any) => {
        console.error("Errore calcolo grafico volume:", err);
        if (isMounted) setIsCalculating(false);
      });

    return () => { isMounted = false; };
  }, [history, library, userWeight, selectedWeeks, calculateVolumeStats]);

  const { points, stats } = calcResult;

  const chartData = useMemo(() => {
    return {
      labels: points.map(p => p.label),
      datasets: [
        {
          label: 'Volume sollevato (kg)',
          data: points.map(p => p.volumeKg),
          backgroundColor: 'rgba(0, 229, 255, 0.65)',
          hoverBackgroundColor: 'rgba(0, 229, 255, 0.95)',
          borderColor: '#00e5ff',
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    };
  }, [points]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 350,
        easing: 'easeOutQuart' as const
      },
      onClick: (_event: any, elements: any[]) => {
        if (elements && elements.length > 0 && onSelectWeek) {
          const index = elements[0].index;
          if (points[index]) {
            onSelectWeek(points[index].weekStart);
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13, 13, 13, 0.95)',
          titleColor: '#f0f0f0',
          bodyColor: '#00e5ff',
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
              const volKg = ctx.parsed.y || 0;
              const ton = (volKg / 1000).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
              const formattedKg = volKg.toLocaleString('it-IT');
              const workouts = p ? ` (${p.workoutCount} ${p.workoutCount === 1 ? 'sessione' : 'sessioni'})` : '';
              return `Volume: ${formattedKg} kg (${ton} t)${workouts}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: {
            color: '#9ba3af',
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
        x: {
          grid: { display: false },
          ticks: { color: '#9ba3af', font: { size: 11 } }
        }
      }
    };
  }, [points, onSelectWeek]);

  return (
    <div className="card" id="weekly-volume-chart-card" style={{ padding: '16px', marginBottom: '20px', position: 'relative' }}>
      {isCalculating && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(13,13,13,0.5)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit' }}>
          <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '15px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Volume di allenamento settimanale</h2>
          {stats.hasData ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>Attuale: <strong style={{ color: 'var(--primary-color)' }}>{stats.currentWeekVolumeKg.toLocaleString('it-IT')} kg</strong></span>
              <span>• Media: <strong style={{ color: 'var(--text-main)' }}>{stats.avgWeeklyVolumeKg.toLocaleString('it-IT')} kg</strong></span>
              {stats.percentageChange !== null && (
                <span style={{
                  fontWeight: '600',
                  fontSize: '0.8rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: stats.percentageChange > 0 ? 'rgba(46, 204, 113, 0.15)' : (stats.percentageChange < 0 ? 'rgba(255, 77, 109, 0.15)' : 'rgba(255, 255, 255, 0.08)'),
                  color: stats.percentageChange > 0 ? '#2ecc71' : (stats.percentageChange < 0 ? '#ff4d6d' : 'var(--text-muted)')
                }}>
                  {stats.percentageChange > 0 ? `+${stats.percentageChange.toFixed(1)}%` : `${stats.percentageChange.toFixed(1)}%`}
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
        {stats.hasData ? (
          <Bar data={chartData} options={chartOptions as any} />
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
            <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🏋️</div>
            <div style={{ fontSize: '0.9rem' }}>Nessun dato di allenamento nelle settimane selezionate.</div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.7 }}>Completa una sessione per visualizzare il volume di allenamento.</div>
          </div>
        )}
      </div>
    </div>
  );
}