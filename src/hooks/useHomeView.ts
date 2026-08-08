import { useState, useMemo } from 'react';
import { subDays, format } from 'date-fns';
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
    const low = mId.toLowerCase();
    if (low.includes('pett') || low.includes('chest')) return { key: 'chest', label: 'Petto' };
    if (low.includes('dors') || low.includes('schien') || low.includes('lat') || low.includes('back')) return { key: 'back', label: 'Dorso' };
    if (low.includes('spall') || low.includes('delt') || low.includes('shoulder')) return { key: 'shoulders', label: 'Spalle' };
    if (low.includes('quad') || low.includes('femoral') || low.includes('glute') || low.includes('polp') || low.includes('leg') || low.includes('gamb')) return { key: 'legs', label: 'Gambe' };
    if (low.includes('bicip') || low.includes('tricip') || low.includes('avambr') || low.includes('arm') || low.includes('bracc')) return { key: 'arms', label: 'Braccia' };
    if (low.includes('addom') || low.includes('core') || low.includes('abs')) return { key: 'core', label: 'Addome' };
    return { key: 'other', label: 'Altro' };
}

function calcStreak(history: any[]): number {
    if (!history || history.length === 0) return 0;
    const workoutDates = new Set<string>(
        history
            .map((w: any) => getWorkoutDateStr(w))
            .filter((d): d is string => Boolean(d))
    );

    let streak = 0;
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd');
    
    // Check if worked out today or yesterday to begin streak count
    let cur = workoutDates.has(todayStr) 
        ? today 
        : (workoutDates.has(yesterdayStr) ? subDays(today, 1) : null);
    
    if (!cur) return 0;
    
    while (true) {
        const dateStr = format(cur, 'yyyy-MM-dd');
        if (workoutDates.has(dateStr)) {
            streak++;
            cur = subDays(cur, 1);
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

    // Pre-calcola una Map per cercare gli esercizi in O(1) invece di O(n) ad ogni iterazione dello storico
    const libraryMap = useMemo(() => new Map(library.map((l: any) => [l.id, l])), [library]);

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
                const libEx = libraryMap.get(ex.exId);
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
    }, [history, libraryMap]);

    // Chronological array for charts and TDEE calc
    const { sortedDates, tdeeCalc } = useMemo(() => {
        const dates = Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
        const cData = dates.map(d => ({ ...nutrition[d], date: d }));
        const tCalc = Logic.calculateTDEE(cData);
        return { sortedDates: dates, tdeeCalc: tCalc };
    }, [nutrition]);

    // Chart Logic (Configured period: 7d, 30d, 180d, 365d)
    const [weightPeriod, setWeightPeriod] = useState<'7d' | '30d' | '180d' | '365d'>('7d');
    const recentDates = useMemo(() => sortedDates.slice(-14), [sortedDates]);

    const { chartData, weightStats } = useMemo(() => {
        const daysMap: Record<string, number> = {
            '7d': 7,
            '30d': 30,
            '180d': 180,
            '365d': 365
        };
        const numDays = daysMap[weightPeriod] || 7;
        const today = new Date();

        const dateRange: string[] = [];
        for (let i = numDays - 1; i >= 0; i--) {
            dateRange.push(format(subDays(today, i), 'yyyy-MM-dd'));
        }

        const points: (number | null)[] = [];
        const validWeights: number[] = [];

        dateRange.forEach(d => {
            const w = nutrition[d]?.weight;
            if (w !== undefined && w !== null && w !== '' && !isNaN(parseFloat(String(w)))) {
                const parsedWeight = parseFloat(String(w));
                points.push(parsedWeight);
                validWeights.push(parsedWeight);
            } else {
                points.push(null);
            }
        });

        const hasDataInPeriod = validWeights.length > 0;
        const latestWeight = hasDataInPeriod ? validWeights[validWeights.length - 1] : null;
        const firstWeight = hasDataInPeriod ? validWeights[0] : null;
        const weightDelta = (hasDataInPeriod && validWeights.length >= 2 && latestWeight !== null && firstWeight !== null)
            ? (latestWeight - firstWeight)
            : null;
        const minWeight = hasDataInPeriod ? Math.min(...validWeights) : null;
        const maxWeight = hasDataInPeriod ? Math.max(...validWeights) : null;

        const labels = dateRange.map(d => {
            const parts = d.split('-');
            if (numDays <= 180) {
                return `${parts[2]}/${parts[1]}`;
            } else {
                return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
            }
        });

        const cData = {
            labels,
            datasets: [
                {
                    label: 'Peso corporeo (kg)',
                    data: points,
                    borderColor: '#0ea5e9',
                    backgroundColor: 'rgba(14, 165, 233, 0.12)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2.5,
                    pointRadius: numDays <= 7 ? 5 : (numDays <= 30 ? 4 : (numDays <= 180 ? 3 : 2)),
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#0284c7',
                    pointBorderWidth: 2,
                    pointHoverBackgroundColor: '#ffffff',
                    pointHoverBorderColor: '#38bdf8',
                    pointHoverBorderWidth: 3,
                    spanGaps: true
                }
            ]
        };

        return {
            chartData: cData,
            weightStats: {
                hasDataInPeriod,
                latestWeight,
                firstWeight,
                weightDelta,
                minWeight,
                maxWeight
            }
        };
    }, [nutrition, weightPeriod]);

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
    const recentNutritionWithBf = sortedNutritionDates.map(d => nutrition[d]).find(n => n?.bf !== undefined && n?.bf !== null && n?.bf !== '');
    const directBf = (todayNutrition.bf !== undefined && todayNutrition.bf !== null && todayNutrition.bf !== '')
        ? todayNutrition.bf
        : recentNutritionWithBf?.bf;

    if (directBf !== undefined && directBf !== null && directBf !== '') {
        const num = parseFloat(String(directBf));
        if (!isNaN(num)) {
            bf = num.toFixed(1);
        }
    } else {
        // Calcola da circonferenze recenti o profilo se bf non precalcolato
        const recentMeasurement = sortedNutritionDates.map(d => nutrition[d]).find(n => n?.waist && n?.neck);
        if (recentMeasurement?.waist && recentMeasurement?.neck && userData?.profile?.height) {
            const calc = Logic.calculateUsNavyBodyFat({
                gender: userData.profile.gender || 'M',
                height: parseFloat(userData.profile.height),
                waist: parseFloat(recentMeasurement.waist),
                neck: parseFloat(recentMeasurement.neck),
                hip: recentMeasurement.hip ? parseFloat(recentMeasurement.hip) : undefined
            });
            if (calc !== null && !isNaN(calc)) {
                bf = Number(calc).toFixed(1);
            }
        } else if (userData?.profile && Object.keys(userData.profile).length > 0) {
            const calcBf = Logic.calculateBodyFat(currentWeight, userData.profile);
            if (calcBf) bf = Number(calcBf).toFixed(1);
        }
    }

    return {
        loading: false,
        isRestDay, todaysWorkout,
        kcalEaten, carbs, pro, fat, kcalTarget,
        bf, streak, totalWorkouts,
        tdeeCalc, recentDates, chartData,
        weightPeriod, setWeightPeriod, weightStats,
        muscleColors, volumeChartData
    };
}
