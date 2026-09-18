import { useMemo } from 'react';
import { useChartAppearance } from '../../hooks/useChartAppearance';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

function makeOptions(colors: ReturnType<typeof useChartAppearance>['colors'], reducedMotion: boolean) { return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
        duration: reducedMotion ? 0 : 400,
        easing: 'easeOutQuart'
    },
    interaction: {
        mode: 'index',
        intersect: false
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
            displayColors: false,
            callbacks: {
                title: (items: any) => {
                    if (!items || !items.length) return '';
                    return `Data: ${items[0].label}`;
                },
                label: (ctx: any) => `Peso: ${ctx.parsed.y} kg`
            }
        }
    },
    scales: {
        y: {
            beginAtZero: false,
            grid: { color: colors.grid },
            ticks: {
                color: colors.muted,
                callback: (val: any) => `${val} kg`,
                font: { size: 11 }
            }
        },
        x: {
            grid: { display: false },
            ticks: {
                color: colors.muted,
                maxTicksLimit: 7,
                maxRotation: 0,
                autoSkip: true,
                font: { size: 11 }
            }
        }
    }
}; }

export default function WeightChart({ chartData }: { chartData: any }) {
    const { colors, reducedMotion } = useChartAppearance();
    const options = useMemo(() => makeOptions(colors, reducedMotion), [colors, reducedMotion]);
    const data = useMemo(() => ({ ...chartData, datasets: (chartData?.datasets || []).map((dataset: any) => ({
        ...dataset, borderColor: colors.primary, backgroundColor: colors.primary,
        pointBackgroundColor: colors.primary, pointBorderColor: colors.surface, fill: false,
    })) }), [chartData, colors]);
    return <Line data={data} options={options as any} role="img" aria-label="Andamento del peso corporeo in chilogrammi" />;
}
