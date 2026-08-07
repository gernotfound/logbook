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

const CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#38bdf8',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            padding: 10,
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
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { 
                color: '#94a3b8',
                callback: (val: any) => `${val} kg`,
                font: { size: 11 }
            }
        },
        x: {
            grid: { display: false },
            ticks: { 
                color: '#94a3b8', 
                maxTicksLimit: 7,
                maxRotation: 0,
                autoSkip: true,
                font: { size: 11 }
            }
        }
    }
};

export default function WeightChart({ chartData }: { chartData: any }) {
    return <Line data={chartData} options={CHART_OPTIONS as any} />;
}
