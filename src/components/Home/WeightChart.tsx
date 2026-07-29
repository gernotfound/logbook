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

export default function WeightChart({ chartData }: { chartData: any }) {
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: (ctx: any) => `${ctx.parsed.y} kg`
                }
            }
        },
        scales: {
            y: { 
                beginAtZero: false,
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#ccc' }
            },
            x: {
                grid: { display: false },
                ticks: { color: '#ccc', maxTicksLimit: 7 }
            }
        }
    };

    return <Line data={chartData} options={chartOptions as any} />;
}
