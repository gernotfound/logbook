import { useMemo } from 'react';
import { useChartAppearance } from '../../hooks/useChartAppearance';
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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function makeOptions(colors: ReturnType<typeof useChartAppearance>['colors'], reducedMotion: boolean) { return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
        duration: reducedMotion ? 0 : 400,
        easing: 'easeOutQuart'
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
            callbacks: {
                label: (ctx: any) => `${ctx.parsed.y} serie`
            }
        }
    },
    scales: {
        y: {
            beginAtZero: true,
            grid: { color: colors.grid },
            ticks: { color: colors.muted, stepSize: 1, font: { size: 11 } }
        },
        x: {
            grid: { display: false },
            ticks: { color: colors.muted, font: { size: 11 } }
        }
    }
}; }

export default function VolumeChart({ chartData }: { chartData: any }) {
    const { colors, reducedMotion } = useChartAppearance();
    const options = useMemo(() => makeOptions(colors, reducedMotion), [colors, reducedMotion]);
    const data = useMemo(() => ({ ...chartData, datasets: (chartData?.datasets || []).map((dataset: any) => ({
        ...dataset, borderColor: colors.primary, backgroundColor: colors.primary,
        pointBackgroundColor: colors.primary, pointBorderColor: colors.surface, fill: false,
    })) }), [chartData, colors]);
    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        return <div className="home-chart-empty">Nessun dato sul volume questa settimana.</div>;
    }
    return <Bar data={data} options={options as any} role="img" aria-label="Serie completate per gruppo muscolare" />;
}
