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
    const history = userData?.history || [];
    const nutrition = userData?.nutrition || {};

    // useMemo hooks MUST be called unconditionally (before any conditional return)
    const streak = useMemo(() => calcStreak(history), [history]);
    const totalWorkouts = history.length;

    // Chronological array for charts and TDEE calc
    const { sortedDates, tdeeCalc } = useMemo(() => {
        const dates = Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
        const cData = dates.map(d => ({ date: d, ...nutrition[d] }));
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
                    return (w && !isNaN(parseFloat(w))) ? parseFloat(w) : null;
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
    const currentWeight = todayNutrition.weight || 
                          ((Object.values(nutrition) as any[]).find(n => n?.weight)?.weight) || 
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
        tdeeCalc, recentDates, chartData
    };
}
