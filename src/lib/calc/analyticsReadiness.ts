import type { WorkoutSession } from '../../types';
import { getWorkoutDateString } from './analyticsWeeklyVolume';

interface ReadinessTrendDimension {
    average: number | null;
    latest: number | null;
    previous: number | null;
    deltaFromPrevious: number | null;
    count: number;
}

export interface ReadinessTrendStats {
    energy: ReadinessTrendDimension;
    stress: ReadinessTrendDimension;
    motivation: ReadinessTrendDimension;
    muscleRecovery: ReadinessTrendDimension;
    sessionsWithReadiness: number;
}

/** Uses the recorded check-in time when an imported session lacks workout timestamps. */
function readinessChronologyTimestamp(session: WorkoutSession): number {
    const values = [session.globalStartTime, session.globalEndTime, session.readiness?.capturedAt];
    return values.find(value => typeof value === 'number' && Number.isFinite(value)) ?? 0;
}

export function computeReadinessTrends(
    history: WorkoutSession[] | null | undefined = [],
    maxSessions: number = 12
): ReadinessTrendStats {
    const sessions = (Array.isArray(history) ? history : [])
        .filter(session => session?.readiness)
        .map(session => ({
            session,
            day: getWorkoutDateString(session) ?? '',
            time: readinessChronologyTimestamp(session),
        }))
        .sort((a, b) => b.day.localeCompare(a.day) || b.time - a.time)
        .slice(0, Math.max(1, maxSessions))
        .map(({ session }) => session);

    const dimension = (key: 'energy' | 'stress' | 'motivation' | 'muscleRecovery'): ReadinessTrendDimension => {
        const values = sessions
            .map(session => session.readiness?.[key])
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5);
        const latest = values[0] ?? null;
        const previous = values[1] ?? null;
        return {
            average: values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null,
            latest,
            previous,
            deltaFromPrevious: latest !== null && previous !== null ? Math.round((latest - previous) * 10) / 10 : null,
            count: values.length,
        };
    };

    return {
        energy: dimension('energy'),
        stress: dimension('stress'),
        motivation: dimension('motivation'),
        muscleRecovery: dimension('muscleRecovery'),
        sessionsWithReadiness: sessions.length,
    };
}
