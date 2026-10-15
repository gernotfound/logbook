import { useState, useMemo, useCallback, useEffect } from 'react';
import { subDays, format } from 'date-fns';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';
import { computeWeeklyWeightSeries } from '../lib/calc/analytics';

const HOME_CLOCK_REFRESH_MS = 60 * 1000;

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

function calcStreak(history: any[], nowMs: number): number {
    if (!history || history.length === 0) return 0;
    const workoutDates = new Set<string>(
        history
            .map((w: any) => getWorkoutDateStr(w))
            .filter((d): d is string => Boolean(d))
    );

    let streak = 0;
    const today = new Date(nowMs);
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

export type HomeViewState = 
    | { loading: true }
    | {
        loading: false;
        isRestDay: boolean;
        todaysWorkout: any;
        kcalEaten: number;
        carbs: number;
        pro: number;
        fat: number;
        kcalTarget: number;
        bf: string;
        bfSource: string | null;
        streak: number;
        totalWorkouts: number;
        chartData: any;
        weightPeriod: string;
        setWeightPeriod: (p: any) => void;
        weightStats: any;
        muscleColors: any;
        activePains: string[];
        painColors: Record<string, string>;
        toggleActivePain: (muscleId: string) => void;
        history: any[];
        nutrition: Record<string, any>;
        library: any[];
        userWeight: number;
    };

const EMPTY_HISTORY: any[] = [];
const EMPTY_NUTRITION: Record<string, any> = {};
const EMPTY_LIBRARY: any[] = [];
const EMPTY_PAINS: string[] = [];

export function useHomeView(): HomeViewState {
    const hasUserData = useAppStore(state => !!state.userData);
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const activePains = useAppStore(state => state.userData?.activePains || EMPTY_PAINS);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const nutritionPlanning = useAppStore(state => state.userData?.nutritionPlanning);
    const [homeClockNow, setHomeClockNow] = useState(() => Date.now());
    const homeDay = Logic.getLocalDateString(homeClockNow);

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let active = true;

        const scheduleNextRefresh = () => {
            timeoutId = setTimeout(() => {
                if (!active) return;
                setHomeClockNow(Date.now());
                scheduleNextRefresh();
            }, HOME_CLOCK_REFRESH_MS);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') setHomeClockNow(Date.now());
        };

        scheduleNextRefresh();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            active = false;
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    const painColors = useMemo(() => {
        const colors: Record<string, string> = {};
        const DANGER_COLOR = 'var(--muscle-pain)';
        (activePains || []).forEach(mId => {
            if (!mId || typeof mId !== 'string') return;
            colors[mId] = DANGER_COLOR;
            const atomicPaths = (Logic.GROUP_MAP as any)[mId];
            if (Array.isArray(atomicPaths)) {
                atomicPaths.forEach((path: string) => {
                    colors[path] = DANGER_COLOR;
                });
            }
        });
        return colors;
    }, [activePains]);

    const toggleActivePain = useCallback((muscleId: string) => {
        if (!muscleId || typeof muscleId !== 'string') return;
        const nextPains = activePains.includes(muscleId)
            ? activePains.filter(p => p !== muscleId)
            : [...activePains, muscleId];
        void dispatchDomainOperation({ type: 'active-pains.set', pains: nextPains }).catch(() => {
            // The sync slice reconciles the optimistic state and exposes saveError/syncHealth.
            // Attach a rejection handler here so a failed local commit never becomes unhandled.
        });
    }, [activePains, dispatchDomainOperation]);

    // useMemo hooks MUST be called unconditionally (before any conditional return)
    const streak = useMemo(() => calcStreak(history, new Date(`${homeDay}T12:00:00`).getTime()), [history, homeDay]);
    const totalWorkouts = history.length;

    // Pre-calcola una Map per cercare gli esercizi in O(1) invece di O(n) ad ogni iterazione dello storico
    const libraryMap = useMemo(() => new Map(library.map((l: any) => [l.id, l])), [library]);

    // The Home recovery map only uses factual exposure within the last 72 hours.
    // Weekly volume for charts is calculated separately by the analytics engine.
    const muscleColors = useMemo(() => {
        const recentExposure = new Set<string>();
        history.forEach((w: any) => {
            const workoutTime = getWorkoutTimestamp(w);
            if (!workoutTime) return;
            const hoursPassed = (homeClockNow - workoutTime) / (1000 * 60 * 60);
            if (!(hoursPassed >= 0 && hoursPassed <= 72)) return;

            (w.exercises || []).forEach((ex: any) => {
                const libEx = libraryMap.get(ex.exId);
                if (!libEx) return;
                const hasWorkSet = (ex.sets || []).some((s: any) => {
                    const hasValues = (s.kg !== undefined && s.kg !== '') || (s.reps !== undefined && s.reps !== '') || (s.time !== undefined && s.time !== '');
                    return s.done === true || hasValues || s.done === undefined;
                });
                if (!hasWorkSet) return;

                for (const mId of [...(libEx.muscles || []), ...(libEx.secondaryMuscles || [])]) {
                    if (!mId || typeof mId !== 'string') continue;
                    const atomicPaths = (Logic.GROUP_MAP as any)[mId] || [mId];
                    atomicPaths.forEach((path: string) => recentExposure.add(path));
                    recentExposure.add(mId);
                }
            });
        });

        const colors: Record<string, string> = {};
        recentExposure.forEach(pathOrId => {
            colors[pathOrId] = 'var(--muscle-recent)';
        });
        return colors;
    }, [history, libraryMap, homeClockNow]);

    // Resolve the latest observations once per nutrition update, not on every clock refresh.
    const { recentWeight, recentNutritionWithBf } = useMemo(() => {
        const dates = Object.keys(nutrition).sort((a, b) => b.localeCompare(a));
        let weight: string | number | undefined;
        let bfDay: (typeof nutrition)[string] | undefined;
        for (const date of dates) {
            const day = nutrition[date];
            if (weight === undefined && day?.weight) weight = day.weight;
            if (!bfDay && day?.bf !== undefined && day?.bf !== null && day?.bf !== '') bfDay = day;
            if (weight !== undefined && bfDay) break;
        }
        return { recentWeight: weight, recentNutritionWithBf: bfDay };
    }, [nutrition]);

    // Chart Logic (Configured period: 7d, 30d, 180d, 365d)
    const [weightPeriod, setWeightPeriod] = useState<'7d' | '30d' | '180d' | '365d'>('7d');

    const { chartData, weightStats } = useMemo(() => {
        const daysMap: Record<string, number> = {
            '7d': 7,
            '30d': 30,
            '180d': 180,
            '365d': 365
        };
        const numDays = daysMap[weightPeriod] || 7;
        const today = new Date(`${homeDay}T12:00:00`);

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
        const weeksMap: Record<string, number> = { '7d': 1, '30d': 5, '180d': 26, '365d': 52 };
        const weeklyWeight = computeWeeklyWeightSeries(nutrition, weeksMap[weightPeriod] || 1, today);
        const latestWeeklyAverage = weeklyWeight.stats.latestAverageWeightKg;
        const latestWeeklyCoverage = {
            recordedDays: weeklyWeight.stats.latestRecordedDaysCount,
            daysConsidered: weeklyWeight.stats.latestDaysConsidered,
        };
        const recentWeeklyAverages = weeklyWeight.points
            .filter(point => point.averageWeightKg !== null)
            .slice(-4);

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
                maxWeight,
                latestWeeklyAverage,
                latestWeeklyCoverage,
                recentWeeklyAverages
            }
        };
    }, [nutrition, weightPeriod, homeDay]);

    const todaysWorkout = useMemo(
        () => history.find((s: any) => getWorkoutDateStr(s) === homeDay),
        [history, homeDay]
    );

    // Early return AFTER all hooks
    if (!hasUserData) {
        return { loading: true };
    }

    const todayStr = homeDay;
    const isRestDay = !todaysWorkout;

    // Calculate today's nutrition
    const todayNutrition = nutrition[todayStr] || { kcal: 0, carbs: 0, pro: 0, fat: 0 };
    const kcalEaten = todayNutrition.kcal || 0;
    const carbs = todayNutrition.carbs || 0;
    const pro = todayNutrition.pro || 0;
    const fat = todayNutrition.fat || 0;

    // Get Targets from planning
    let kcalTarget = nutritionPlanning?.normocalorica?.kcal || 2500;
    
    if (nutritionPlanning) {
        const isDayOn = todayNutrition.isDayOn;
        
        const latestWeight = parseFloat(String(recentWeight)) || 80;
        const w = nutritionPlanning.weight || latestWeight;
        const targetMacros = isDayOn === true
            ? nutritionPlanning.onMacros
            : isDayOn === false
                ? nutritionPlanning.offMacros
                : undefined;
        
        if (targetMacros) {
            const calc = Logic.calculateMacrosFromKg(w, targetMacros.carbsPerKg, targetMacros.proPerKg, targetMacros.fatPerKg);
            kcalTarget = Math.round(calc.totalKcal);
        }
    }
    
    // Get BF % — use today's or most recent measurement
    const currentWeight = todayNutrition.weight || 
                          recentWeight || 
                          nutritionPlanning?.weight || 80;
    const resolvedUserWeight = typeof currentWeight === 'number' ? currentWeight : (parseFloat(String(currentWeight)) || 80);
    
    let bf = "--";
    let bfSource: string | null = null;
    const selectedBfDay = (todayNutrition.bf !== undefined && todayNutrition.bf !== null && todayNutrition.bf !== '')
        ? todayNutrition
        : recentNutritionWithBf;
    const directBf = selectedBfDay?.bf;

    if (directBf !== undefined && directBf !== null && directBf !== '') {
        const num = parseFloat(String(directBf));
        if (!isNaN(num)) {
            bf = num.toFixed(1);
            bfSource = selectedBfDay?.bfProvenance?.method === 'manual'
                ? 'Manuale'
                : selectedBfDay?.bfProvenance?.method === 'us_navy'
                    ? 'US Navy'
                    : 'Origine non disponibile';
        }
    }

    return {
        loading: false,
        isRestDay, todaysWorkout,
        kcalEaten, carbs, pro, fat, kcalTarget,
        bf, bfSource, streak, totalWorkouts,
        chartData,
        weightPeriod, setWeightPeriod, weightStats,
        muscleColors,
        activePains, painColors, toggleActivePain,
        history, nutrition, library,
        userWeight: resolvedUserWeight
    };
}
