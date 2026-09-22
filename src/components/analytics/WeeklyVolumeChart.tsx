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
import { Dumbbell } from 'lucide-react';
import { useChartAppearance } from '../../hooks/useChartAppearance';
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

const EMPTY_HISTORY: WorkoutSession[] = [];
const EMPTY_LIBRARY: Exercise[] = [];

const PERIOD_OPTIONS = [
  { id: 4, label: '4 sett' },
  { id: 8, label: '8 sett' },
  { id: 12, label: '12 sett' },
  { id: 24, label: '24 sett' },
];

export default function WeeklyVolumeChart({
  history = EMPTY_HISTORY,
  library = EMPTY_LIBRARY,
  userWeight = 80,
  defaultWeeks = 8,
  onSelectWeek
}: WeeklyVolumeChartProps) {
  const { colors, reducedMotion } = useChartAppearance();
  const [selectedWeeks, setSelectedWeeks] = useState<number>(defaultWeeks);
  const [isCalculating, setIsCalculating] = useState(true);
  const { calculateVolumeStats } = useAnalyticsWorker();

  const [calcResult, setCalcResult] = useState<{points: any[], stats: any}>({
    points: [],
    stats: { hasData: false, currentWeekVolumeKg: 0, avgWeeklyVolumeKg: 0, percentageChange: null }
  });

  const [prevParams, setPrevParams] = useState({ history, library, userWeight, selectedWeeks });
  if (history !== prevParams.history || library !== prevParams.library || userWeight !== prevParams.userWeight || selectedWeeks !== prevParams.selectedWeeks) {
    setPrevParams({ history, library, userWeight, selectedWeeks });
    setIsCalculating(true);
  }

  useEffect(() => {
    let isMounted = true;

    calculateVolumeStats(history, library, userWeight, selectedWeeks)
      .then((res: any) => {
        if (isMounted) {
          setCalcResult(res);
          setIsCalculating(false);
        }
      })
      .catch((err: any) => {
        if (!isMounted) return;
        console.error("Errore calcolo grafico volume:", err);
        setIsCalculating(false);
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
          backgroundColor: colors.primary,
          hoverBackgroundColor: colors.primary,
          borderColor: colors.primary,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    };
  }, [points, colors]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: reducedMotion ? 0 : 350,
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
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.primary,
          borderColor: colors.grid,
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
          grid: { color: colors.grid },
          ticks: {
            color: colors.muted,
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
          ticks: { color: colors.muted, font: { size: 11 } }
        }
      }
    };
  }, [points, onSelectWeek, colors, reducedMotion]);

  return (
    <section className="card analytics-card" id="weekly-volume-chart-card" aria-busy={isCalculating}>
      <div className="home-chart-header">
        <div>
          <h2>Volume di allenamento settimanale</h2>
          {stats.hasData && <div className="analytics-stat-line">
            <span>Attuale: <strong>{stats.currentWeekVolumeKg.toLocaleString('it-IT')} kg</strong></span>
            <span>Media: <strong>{stats.avgWeeklyVolumeKg.toLocaleString('it-IT')} kg</strong></span>
            {stats.percentageChange !== null && <span className="analytics-change">{stats.percentageChange > 0 ? '+' : ''}{stats.percentageChange.toFixed(1)}%</span>}
          </div>}
        </div>
        <div className="chart-period-control" role="group" aria-label="Periodo del volume di allenamento">
          {PERIOD_OPTIONS.map(p => <button key={p.id} type="button" aria-pressed={selectedWeeks === p.id} onClick={() => setSelectedWeeks(p.id)}>{p.label}</button>)}
        </div>
      </div>
      {isCalculating && <div className="analytics-loading" role="status"><div className="spinner" />Aggiornamento grafico...</div>}
      <div className="home-chart-canvas">
        {stats.hasData ? <Bar data={chartData} options={chartOptions as any} role="img" aria-label={`Volume settimanale. Attuale: ${stats.currentWeekVolumeKg} kg; media: ${stats.avgWeeklyVolumeKg} kg.`} /> : (
          <div className="home-chart-empty"><Dumbbell size={32} aria-hidden="true" /><p>Nessun dato di allenamento nelle settimane selezionate.</p><p className="text-sm">Completa una sessione per visualizzare il volume di allenamento.</p></div>
        )}
      </div>
    </section>
  );
}
