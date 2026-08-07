import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';

function getWorkoutTimestamp(w: any): number | null {
    if (!w) return null;
    if (typeof w.globalStartTime === 'number' && !isNaN(w.globalStartTime)) return w.globalStartTime;
    if (typeof w.globalEndTime === 'number' && !isNaN(w.globalEndTime)) return w.globalEndTime;
    if (typeof w.endTime === 'number' && !isNaN(w.endTime)) return w.endTime;
    if (w.date) {
        const parsed = new Date(w.date.includes('T') ? w.date : `${w.date}T12:00:00`).getTime();
        if (!isNaN(parsed)) return parsed;
    }
    return null;
}

function getWorkoutDateStr(w: any): string | null {
    if (!w) return null;
    if (w.date) return w.date;
    const ts = getWorkoutTimestamp(w);
    return ts ? Logic.getLocalDateString(ts) : null;
}

function getMuscleCategory(mId: string): { key: string; label: string } {
    if (!mId) return { key: 'other', label: 'Altro' };
    const id = mId.toLowerCase();
    if (id.startsWith('chest')) return { key: 'chest', label: 'Petto' };
    if (id.startsWith('lat') || id.startsWith('back') || id.startsWith('rhomboid') || id.startsWith('lower_back')) return { key: 'back', label: 'Dorso' };
    if (id.startsWith('delt') || id.startsWith('shoulder')) return { key: 'shoulders', label: 'Spalle' };
    if (id.startsWith('trap')) return { key: 'traps', label: 'Trapezi' };
    if (id.startsWith('bicep') || id.startsWith('brachial')) return { key: 'biceps', label: 'Bicipiti' };
    if (id.startsWith('tricep')) return { key: 'triceps', label: 'Tricipiti' };
    if (id.startsWith('quad')) return { key: 'quads', label: 'Quadricipiti' };
    if (id.startsWith('hamstring')) return { key: 'hamstrings', label: 'Femorali' };
    if (id.startsWith('glute') || id.startsWith('abductor')) return { key: 'glutes', label: 'Glutei' };
    if (id.startsWith('calv')) return { key: 'calves', label: 'Polpacci' };
    if (id.startsWith('ab') || id.startsWith('oblique') || id.startsWith('core')) return { key: 'abs', label: 'Addome' };
    if (id.startsWith('forearm') || id.startsWith('hand')) return { key: 'forearms', label: 'Avambracci' };
    if (id.startsWith('adductor')) return { key: 'adductors', label: 'Adduttori' };
    if (id.startsWith('leg')) return { key: 'legs', label: 'Gambe' };
    return { key: id, label: id.charAt(0).toUpperCase() + id.slice(1) };
}

function calcStreak(history: any[]) {
    if (!history || history.length === 0) return 0;
    
    // Build a set of workout date strings
    const workoutDates = new Set(
        history
            .map((w: any) => getWorkoutDateStr(w))
            .filter((d): d is string => Boolean(d))
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
            const workoutTime = getWorkoutTimestamp(w);
            if (!workoutTime) return;

            const msPassed = now - workoutTime;
            const hoursPassed = msPassed / (1000 * 60 * 60);
            
            const isRecent72h = hoursPassed >= 0 && hoursPassed <= MAX_HOURS;
            const isRecent7d = msPassed >= 0 && msPassed <= SEVEN_DAYS;
            
            if (!isRecent72h && !isRecent7d) return;

            const baseFatigue = Math.max(0, 1 - (hoursPassed / MAX_HOURS));

            (w.exercises || []).forEach((ex: any) => {
                const libEx = library.find((l: any) => l.id === ex.exId);
                if (!libEx) return;

                // Calculate completed sets (regular sets + dropsets)
                let completedSets = 0;
                (ex.sets || []).forEach((s: any) => {
                    const hasValues = (s.kg !== undefined && s.kg !== '') || (s.reps !== undefined && s.reps !== '') || (s.time !== undefined && s.time !== '');
                    const isDone = s.done === true || hasValues || s.done === undefined;
                    if (isDone) {
                        completedSets += 1;
                        if (Array.isArray(s.dropsets)) {
                            completedSets += s.dropsets.length;
                        }
                    }
                });

                if (isRecent7d && completedSets > 0) {
                    const uniqueCategories = new Set<string>();
                    (libEx.muscles || []).forEach((mId: string) => {
                        if (!mId || typeof mId !== 'string') return;
                        const { label } = getMuscleCategory(mId);
                        uniqueCategories.add(label);
                    });
                    uniqueCategories.forEach((label) => {
                        volume.set(label, (volume.get(label) || 0) + completedSets);
                    });
                }

                if (isRecent72h && completedSets > 0) {
                    // Primary muscles
                    (libEx.muscles || []).forEach((mId: string) => {
                        if (!mId || typeof mId !== 'string') return;
                        const atomicPaths = (Logic.GROUP_MAP as any)[mId] || [mId];
                        atomicPaths.forEach((path: string) => {
                            fatigue.set(path, Math.max(fatigue.get(path) || 0, baseFatigue));
                        });
                        fatigue.set(mId, Math.max(fatigue.get(mId) || 0, baseFatigue));
                    });
                    // Secondary muscles (50% fatigue)
                    (libEx.secondaryMuscles || []).forEach((mId: string) => {
                        if (!mId || typeof mId !== 'string') return;
                        const atomicPaths = (Logic.GROUP_MAP as any)[mId] || [mId];
                        atomicPaths.forEach((path: string) => {
                            fatigue.set(path, Math.max(fatigue.get(path) || 0, baseFatigue * 0.5));
                        });
                        fatigue.set(mId, Math.max(fatigue.get(mId) || 0, baseFatigue * 0.5));
                    });
                }
            });
        });

        const colors: Record<string, string> = {};
        fatigue.forEach((val, pathOrId) => {
            if (val > 0.7) colors[pathOrId] = '#ef4444'; // Affaticamento alto (oggi/recente)
            else if (val > 0.35) colors[pathOrId] = '#f97316'; // Affaticamento medio (ieri)
            else if (val > 0.05) colors[pathOrId] = '#eab308'; // Affaticamento lieve (recupero quasi completo)
        });

        const sortedVolume = Array.from(volume.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7);
        const vChartData = {
            labels: sortedVolume.map(v => v[0]),
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
                label: 'Peso corporeo (kg)',
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
        return getWorkoutDateStr(s) === todayStr;
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
