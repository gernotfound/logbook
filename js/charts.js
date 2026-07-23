export const ChartsManager = {
    volumeChartInstance: null,
    renderVolumeChart(history) {
        if (typeof Chart === 'undefined') return;
        const canvas = document.getElementById('volumeChart');
        if (!canvas) return;
        if (this.volumeChartInstance) {
            this.volumeChartInstance.destroy();
        }
        const weeklyData = {};
        history.forEach(workout => {
            const date = new Date(workout.date);
            if (isNaN(date)) return;
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
            const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
            const key = `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
            if (!weeklyData[key]) weeklyData[key] = 0;
            let workoutVolume = 0;
            if (workout.exercises && Array.isArray(workout.exercises)) {
                workout.exercises.forEach(ex => {
                    if (ex.sets && Array.isArray(ex.sets)) {
                        ex.sets.forEach(set => {
                            const weight = parseFloat(set.weight) || 0;
                            const reps = parseInt(set.reps) || 0;
                            workoutVolume += (weight * reps);
                        });
                    }
                });
            }
            weeklyData[key] += workoutVolume;
        });
        const sortedKeys = Object.keys(weeklyData).sort();
        const recentKeys = sortedKeys.slice(-12);
        const labels = recentKeys.map(k => {
            const [, w] = k.split('-W');
            return `Sett. ${w}`;
        });
        const data = recentKeys.map(k => weeklyData[k]);
        const ctx = canvas.getContext('2d');
        this.volumeChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Volume Totale (kg x reps)',
                    data: data,
                    backgroundColor: '#10b981', // green / success color
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.parsed.y.toLocaleString() + ' kg';
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: 'rgba(255,255,255,0.7)' } },
                    y: { ticks: { color: 'rgba(255,255,255,0.7)' } }
                }
            }
        });
    }
};
