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
import { ChartNoAxesCombined } from 'lucide-react';
import { useChartAppearance } from '../../hooks/useChartAppearance';
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

const EMPTY_HISTORY: WorkoutSession[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_NUTRITION: Record<string, NutritionDay> = {};

const PERIOD_OPTIONS = [
  { id: 4, label: '4 sett' },
  { id: 8, label: '8 sett' },
  { id: 12, label: '12 sett' },
  { id: 24, label: '24 sett' },
];

export default function VolumeCaloriesCorrelationChart({
  history = EMPTY_HISTORY,
  nutrition = EMPTY_NUTRITION,
  library = EMPTY_LIBRARY,
  userWeight = 80,
  defaultWeeks = 8
}: VolumeCaloriesCorrelationChartProps) {
  const { colors, reducedMotion } = useChartAppearance();
  const [selectedWeeks, setSelectedWeeks] = useState<number>(defaultWeeks);
  const [isCalculating, setIsCalculating] = useState(true);
  const { calculateCorrelationStats } = useAnalyticsWorker();

  const [calcResult, setCalcResult] = useState<{points: any[], stats: any}>({
    points: [],
    stats: { hasData: false, correlationCoefficient: null, correlationInsight: '', avgWeeklyVolumeKg: 0, avgDailyKcal: 0, validDataPointsCount: 0 }
  });

  const [prevParams, setPrevParams] = useState({ history, nutrition, library, userWeight, selectedWeeks });
  if (history !== prevParams.history || nutrition !== prevParams.nutrition || library !== prevParams.library || userWeight !== prevParams.userWeight || selectedWeeks !== prevParams.selectedWeeks) {
    setPrevParams({ history, nutrition, library, userWeight, selectedWeeks });
    setIsCalculating(true);
  }

  useEffect(() => {
    let isMounted = true;

    calculateCorrelationStats(history, nutrition, library, userWeight, selectedWeeks)
      .then((res: any) => {
        if (isMounted) {
          setCalcResult(res);
          setIsCalculating(false);
        }
      })
      .catch((err: any) => {
        if (!isMounted) return;
        console.error("Errore calcolo grafico correlazione:", err);
        setIsCalculating(false);
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
          backgroundColor: colors.primary,
          hoverBackgroundColor: colors.primary,
          borderColor: colors.primary,
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
          borderColor: colors.warning,
          backgroundColor: colors.warning,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: colors.surface,
          pointBorderColor: colors.warning,
          pointBorderWidth: 2,
          pointHoverBackgroundColor: colors.surface,
          pointHoverBorderColor: colors.warning,
          pointHoverBorderWidth: 3,
          tension: 0.35,
          spanGaps: true,
          fill: false,
          order: 1
        }
      ]
    };
  }, [points, colors]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false
      },
      animation: {
        duration: reducedMotion ? 0 : 350,
        easing: 'easeOutQuart' as const
      },
      plugins: {
        legend: {
          display: true,
          position: 'top' as const,
          align: 'end' as const,
          labels: {
            color: colors.muted,
            font: { size: 11 },
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.text,
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
          grid: { color: colors.grid },
          ticks: {
            color: colors.primary,
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
            color: colors.warning,
            font: { size: 11 },
            callback: (val: any) => `${Number(val)} kcal`
          }
        },
        x: {
          grid: { display: false },
          ticks: { color: colors.muted, font: { size: 11 } }
        }
      }
    };
  }, [points, colors, reducedMotion]);

  return (
    <section className="card analytics-card" id="volume-calories-correlation-card" aria-busy={isCalculating}>
      <div className="home-chart-header">
        <div>
          <h2>Correlazione volume vs calorie</h2>
          {stats.correlationCoefficient !== null && <div className="analytics-stat-line"><span>r = {stats.correlationCoefficient > 0 ? '+' : ''}{stats.correlationCoefficient.toFixed(2)}</span></div>}
          <p className="analytics-insight">{stats.correlationInsight}</p>
        </div>
        <div className="chart-period-control" role="group" aria-label="Periodo della correlazione volume e calorie">
          {PERIOD_OPTIONS.map(p => <button key={p.id} type="button" aria-pressed={selectedWeeks === p.id} onClick={() => setSelectedWeeks(p.id)}>{p.label}</button>)}
        </div>
      </div>
      {isCalculating && <div className="analytics-loading" role="status"><div className="spinner" />Aggiornamento grafico...</div>}
      <div className="home-chart-canvas">
        {stats.hasData ? <Chart type="bar" data={chartData as any} options={chartOptions as any} role="img" aria-label={`Volume e calorie nelle ultime ${selectedWeeks} settimane. ${stats.correlationInsight}`} /> : (
          <div className="home-chart-empty"><ChartNoAxesCombined size={32} aria-hidden="true" /><p>Dati insufficienti per calcolare la correlazione.</p><p className="text-sm">Registra allenamenti e pasti per visualizzare la relazione tra apporto energetico e carichi.</p></div>
        )}
      </div>
    </section>
  );
}
