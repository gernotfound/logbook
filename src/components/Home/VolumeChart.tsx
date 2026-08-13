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
    animation: {
        duration: 400,
        easing: 'easeOutQuart'
    },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#38bdf8',
            borderColor: 'rgba(255, 255, 255, 0.15)',
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
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: '#94a3b8', stepSize: 1, font: { size: 11 } }
        },
        x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 11 } }
        }
    }
};

export default function VolumeChart({ chartData }: { chartData: any }) {
    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: '40px' }}>Nessun dato sul volume questa settimana.</div>;
    }
    return <Bar data={chartData} options={CHART_OPTIONS as any} />;
}
