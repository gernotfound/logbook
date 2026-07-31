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

const CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: false },
        tooltip: {
            callbacks: {
                label: (ctx: any) => `${ctx.parsed.y} sets`
            }
        }
    },
    scales: {
        y: { 
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: '#ccc', stepSize: 1 }
        },
        x: {
            grid: { display: false },
            ticks: { color: '#ccc' }
        }
    }
};

export default function VolumeChart({ chartData }: { chartData: any }) {
    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: '40px' }}>Nessun dato sul volume questa settimana.</div>;
    }
    return <Bar data={chartData} options={CHART_OPTIONS as any} />;
}
