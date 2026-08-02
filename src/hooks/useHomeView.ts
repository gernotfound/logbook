import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';

function calcStreak(history: any[]) {
    if (!history || history.length === 0) return 0;
    
    // Build a set of workout date strings
    const workoutDates = new Set(
        history
            .filter((w: any) => w.globalStartTime)
            .map((w: any) => Logic.getLocalDateString(w.globalStartTime))
    );

    let streak = 0;
    const today = new Date();
    const todayStr = Logic.getLocalDateString(today);
    
    // Check if worked out today or yesterday to begin streak count
    const startDate = workoutDates.has(todayStr) ? new Date(today) : (() => {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = Logic.getLocalDateString(yesterday);
        return workoutDates.has(yStr) ? yesterday : null;
    })();
    
    if (!startDate) return 0;
    
    const cur = new Date(startDate);
    while (true) {
        const dateStr = Logic.getLocalDateString(cur);
        if (workoutDates.has(dateStr)) {
            streak++;
            cur.setDate(cur.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

export function useHomeView() {
    const userData = useAppStore(state => state.userData);

    // Always derive safe values — required before any useMemo (Rules of Hooks)
    const history = useMemo(() => userData?.history || [], [userData?.history]);
    const nutrition = useMemo(() => userData?.nutrition || {}, [userData?.nutrition]);

    // useMemo hooks MUST be called unconditionally (before any conditional return)
    const streak = useMemo(() => calcStreak(history), [history]);
    const totalWorkouts = history.length;
    const library = useMemo(() => userData?.library || [], [userData?.library]);

    // Calculate Heatmap & Volume
    const { muscleColors, volumeChartData } = useMemo(() => {
        const MAX_HOURS = 72;
        const now = Date.now();
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        
        const fatigue = new Map<string, number>();
        const volume = new Map<string, number>();

        history.forEach((w: any) => {
            if (!w.globalStartTime) return;
            const msPassed = now - w.globalStartTime;
            const hoursPassed = msPassed / (1000 * 60 * 60);
            
            const isRecent72h = hoursPassed <= MAX_HOURS;
            const isRecent7d = msPassed <= SEVEN_DAYS;
            
            if (!isRecent72h && !isRecent7d) return;

            const baseFatigue = Math.max(0, 1 - (hoursPassed / MAX_HOURS));

            (w.exercises || []).forEach((ex: any) => {
                const libEx = library.find((l: any) => l.id === ex.exId);
                if (!libEx) return;

                const completedSets = ex.sets?.filter((s: any) => s.done).length || 0;

                if (isRecent7d && completedSets > 0) {
                    (libEx.muscles || []).forEach((mId: string) => {
                        if (!mId || typeof mId !== 'string') return;
                        const majorId = mId.split('_')[0]; 
                        volume.set(majorId, (volume.get(majorId) || 0) + completedSets);
                    });
                }

                if (isRecent72h) {
                    (libEx.muscles || []).forEach((mId: string) => {
                        if (!mId || typeof mId !== 'string') return;
                        const atomicPaths = (Logic.GROUP_MAP as any)[mId] || [mId];
                        atomicPaths.forEach((path: string) => {
                            fatigue.set(path, Math.max(fatigue.get(path) || 0, baseFatigue));
                        });
                    });
                    (libEx.secondaryMuscles || []).forEach((mId: string) => {
                        if (!mId || typeof mId !== 'string') return;
                        const atomicPaths = (Logic.GROUP_MAP as any)[mId] || [mId];
                        atomicPaths.forEach((path: string) => {
                            fatigue.set(path, Math.max(fatigue.get(path) || 0, baseFatigue * 0.5));
                        });
                    });
                }
            });
        });

        const colors: Record<string, string> = {};
        fatigue.forEach((val, path) => {
            if (val > 0.7) colors[path] = '#ef4444'; 
            else if (val > 0.4) colors[path] = '#f97316'; 
            else if (val > 0.1) colors[path] = '#eab308'; 
        });

        const labelMap: Record<string, string> = {
            'chest': 'Petto', 'back': 'Dorso', 'legs': 'Gambe', 'quads': 'Quadricipiti',
            'hamstrings': 'Femorali', 'glutes': 'Glutei', 'calves': 'Polpacci',
            'shoulders': 'Spalle', 'delts': 'Spalle', 'biceps': 'Bicipiti',
            'triceps': 'Tricipiti', 'core': 'Core', 'abs': 'Addome', 'lats': 'Dorso'
        };

        const sortedVolume = Array.from(volume.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7);
        const vChartData = {
            labels: sortedVolume.map(v => labelMap[v[0]] || v[0]),
            datasets: [{
                data: sortedVolume.map(v => v[1]),
                backgroundColor: 'rgba(14, 165, 233, 0.6)',
                borderColor: 'var(--primary-color)',
                borderWidth: 1,
                borderRadius: 4
            }]
        };

        return { muscleColors: colors, volumeChartData: vChartData };
    }, [history, library]);

    // Chronological array for charts and TDEE calc
    const { sortedDates, tdeeCalc } = useMemo(() => {
        const dates = Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
        const cData = dates.map(d => ({ ...nutrition[d], date: d }));
        const tCalc = Logic.calculateTDEE(cData);
        return { sortedDates: dates, tdeeCalc: tCalc };
    }, [nutrition]);

    // Chart Logic (Last 14 days)
    const recentDates = useMemo(() => sortedDates.slice(-14), [sortedDates]);
    const chartData = useMemo(() => ({
        labels: recentDates.map(d => d.slice(5).replace('-', '/')),
        datasets: [
            {
                label: 'Peso Corporeo (kg)',
                data: recentDates.map(d => {
                    const w = nutrition[d]?.weight;
                    return (w && !isNaN(parseFloat(String(w)))) ? parseFloat(String(w)) : null;
                }),
                borderColor: 'var(--primary-color)',
                backgroundColor: 'rgba(14, 165, 233, 0.2)',
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: 'var(--primary-color)',
                spanGaps: true // connect across null values
            }
        ]
    }), [recentDates, nutrition]);

    // Early return AFTER all hooks
    if (!userData) {
        return { loading: true };
    }

    const todayStr = Logic.getLocalDateString();
    
    // Calculate today's workout
    const todaysWorkout = history.find((s: any) => {
        if (!s.globalStartTime) return false;
        return Logic.getLocalDateString(s.globalStartTime) === todayStr;
    });
    const isRestDay = !todaysWorkout;

    // Calculate today's nutrition
    const todayNutrition = nutrition[todayStr] || { kcal: 0, carbs: 0, pro: 0, fat: 0 };
    const kcalEaten = todayNutrition.kcal || 0;
    const carbs = todayNutrition.carbs || 0;
    const pro = todayNutrition.pro || 0;
    const fat = todayNutrition.fat || 0;

    // Get Targets from planning
    const kcalTarget = userData?.nutritionPlanning?.normocalorica?.kcal || 
                       userData?.nutritionPlanning?.totalKcal || 2500;
    
    // Get BF % — use today's or most recent measurement
    const sortedNutritionDates = Object.keys(nutrition).sort((a, b) => b.localeCompare(a));
    const recentWeight = sortedNutritionDates.map(d => nutrition[d]).find(n => n?.weight)?.weight;
    const currentWeight = todayNutrition.weight || 
                          recentWeight || 
                          userData?.nutritionPlanning?.weight || 80;
    let bf = "--";
    if (userData.profile && Object.keys(userData.profile).length > 0) {
        const calcBf = Logic.calculateBodyFat(currentWeight, userData.profile);
        if (calcBf) bf = Number(calcBf).toFixed(1);
    }

    return {
        loading: false,
        isRestDay, todaysWorkout,
        kcalEaten, carbs, pro, fat, kcalTarget,
        bf, streak, totalWorkouts,
        tdeeCalc, recentDates, chartData,
        muscleColors, volumeChartData
    };
}
