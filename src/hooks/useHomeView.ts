import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Exercise, NutritionDay, WorkoutSession } from '../types';
import { calculateHomeWeightSeries, selectLatestHomeMeasurements, summarizeHomeNutrition, type HomeWeightPeriod, type HomeWeightStats } from '../lib/calc/homeHealthMetrics';
import { useAppStore } from '../store/useAppStore';
import { GROUP_MAP } from '../lib/constants/muscles';
import { getLocalDateString } from '../lib/utils/date';
import { buildHomeMuscleExposureIndex, calculateHomeWorkoutStreak, getHomeWorkoutDate, getRecentHomeMuscles } from '../lib/calc/homeTrainingMetrics';

const HOME_CLOCK_REFRESH_MS = 60 * 1000;

function buildHomeWeightChart(series: ReturnType<typeof calculateHomeWeightSeries>) {
    const numDays = series.points.length;
    return {
        labels: series.dates.map(date => {
            const parts = date.split('-');
            return numDays <= 180
                ? `${parts[2]}/${parts[1]}`
                : `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
        }),
        datasets: [{
            label: 'Peso corporeo (kg)',
            data: series.points,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: numDays <= 7 ? 5 : (numDays <= 30 ? 4 : (numDays <= 180 ? 3 : 2)),
            pointHoverRadius: 7,
            pointBorderWidth: 2,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: '#38bdf8',
            pointHoverBorderWidth: 3,
            spanGaps: true,
        }],
    };
}

export type HomeViewState = 
    | { loading: true }
    | {
        loading: false;
        isRestDay: boolean;
        todaysWorkout: WorkoutSession | undefined;
        kcalEaten: number;
        carbs: number;
        pro: number;
        fat: number;
        kcalTarget: number;
        bf: string;
        bfSource: string | null;
        streak: number;
        totalWorkouts: number;
        chartData: ReturnType<typeof buildHomeWeightChart>;
        weightPeriod: HomeWeightPeriod;
        setWeightPeriod: (p: HomeWeightPeriod) => void;
        weightStats: HomeWeightStats;
        lastRecordedWeight: number | null;
        muscleColors: Record<string, string>;
        activePains: string[];
        painColors: Record<string, string>;
        toggleActivePain: (muscleId: string) => void;
        history: WorkoutSession[];
        nutrition: Record<string, NutritionDay>;
        library: Exercise[];
        userWeight: number;
    };

const EMPTY_HISTORY: WorkoutSession[] = [];
const EMPTY_NUTRITION: Record<string, NutritionDay> = {};
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_PAINS: string[] = [];

export function useHomeView(isActive = true): HomeViewState {
    const hasUserData = useAppStore(state => !!state.userData);
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const activePains = useAppStore(state => state.userData?.activePains || EMPTY_PAINS);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const nutritionPlanning = useAppStore(state => state.userData?.nutritionPlanning);
    const [homeClockNow, setHomeClockNow] = useState(() => Date.now());
    const homeDay = getLocalDateString(homeClockNow);

    useEffect(() => {
        if (!isActive) return;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let immediateId: ReturnType<typeof setTimeout> | null = null;
        let active = true;

        const scheduleNextRefresh = () => {
            if (!active || document.visibilityState !== 'visible') return;
            timeoutId = setTimeout(() => {
                if (!active || document.visibilityState !== 'visible') return;
                setHomeClockNow(Date.now());
                scheduleNextRefresh();
            }, HOME_CLOCK_REFRESH_MS);
        };

        const handleVisibilityChange = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = null;
            if (document.visibilityState === 'visible') {
                setHomeClockNow(Date.now());
                scheduleNextRefresh();
            }
        };

        // Timestamps remain authoritative while the document is hidden.
        if (document.visibilityState === 'visible') {
            immediateId = setTimeout(() => {
                if (active) setHomeClockNow(Date.now());
            }, 0);
            scheduleNextRefresh();
        }
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            active = false;
            if (timeoutId) clearTimeout(timeoutId);
            if (immediateId) clearTimeout(immediateId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isActive]);

    const painColors = useMemo(() => {
        const colors: Record<string, string> = {};
        const DANGER_COLOR = 'var(--muscle-pain)';
        (activePains || []).forEach(mId => {
            if (!mId || typeof mId !== 'string') return;
            colors[mId] = DANGER_COLOR;
            const atomicPaths = GROUP_MAP[mId];
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
    const streak = useMemo(() => calculateHomeWorkoutStreak(history, new Date(`${homeDay}T12:00:00`).getTime()), [history, homeDay]);
    const totalWorkouts = history.length;

    // Pre-calcola una Map per cercare gli esercizi in O(1) invece di O(n) ad ogni iterazione dello storico
    const libraryMap = useMemo(() => new Map(library.map((l): [string, Exercise] => [l.id, l])), [library]);

    const exposureIndex = useMemo(
        () => buildHomeMuscleExposureIndex(history, libraryMap),
        [history, libraryMap],
    );
    const muscleColors = useMemo(() => {
        const colors: Record<string, string> = {};
        for (const id of getRecentHomeMuscles(exposureIndex, homeClockNow)) {
            colors[id] = 'var(--muscle-recent)';
        }
        return colors;
    }, [exposureIndex, homeClockNow]);

    const latestMeasurements = useMemo(() => selectLatestHomeMeasurements(nutrition), [nutrition]);

    // Chart Logic (Configured period: 7d, 30d, 180d, 365d)
    const [weightPeriod, setWeightPeriod] = useState<HomeWeightPeriod>('7d');

    const { chartData, weightStats } = useMemo(() => {
        const series = calculateHomeWeightSeries(nutrition, weightPeriod, homeDay);
        return { chartData: buildHomeWeightChart(series), weightStats: series.stats };
    }, [nutrition, weightPeriod, homeDay]);

    const todaysWorkout = useMemo(
        () => history.find(s => getHomeWorkoutDate(s) === homeDay),
        [history, homeDay]
    );

    // Early return AFTER all hooks
    if (!hasUserData) {
        return { loading: true };
    }

    const isRestDay = !todaysWorkout;
    const { kcalEaten, carbs, pro, fat, kcalTarget, bf, bfSource, userWeight } =
        summarizeHomeNutrition(nutrition[homeDay], nutritionPlanning, latestMeasurements);

    return {
        loading: false,
        isRestDay, todaysWorkout,
        kcalEaten, carbs, pro, fat, kcalTarget,
        bf, bfSource, streak, totalWorkouts,
        chartData,
        weightPeriod, setWeightPeriod, weightStats,
        lastRecordedWeight: latestMeasurements.recentWeight ?? null,
        muscleColors,
        activePains, painColors, toggleActivePain,
        history, nutrition, library,
        userWeight
    };
}
