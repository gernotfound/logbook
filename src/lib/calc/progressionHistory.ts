import type { WorkoutSession } from '../../types';

function sessionTimestamp(session: WorkoutSession, preferEnd = false): number | undefined {
    const candidates = preferEnd
        ? [session.globalEndTime, session.endTime, session.globalStartTime]
        : [session.globalStartTime, session.globalEndTime, session.endTime];
    return candidates.find(value => typeof value === 'number' && Number.isFinite(value));
}

export function isSessionEarlier(candidate: WorkoutSession, current: WorkoutSession): boolean {
    if (candidate.id && current.id && candidate.id === current.id) return false;
    if (candidate.date && current.date) {
        if (candidate.date < current.date) return true;
        if (candidate.date > current.date) return false;
    }
    const candidateEnd = sessionTimestamp(candidate, true);
    const currentStart = sessionTimestamp(current, false);
    return candidateEnd !== undefined && currentStart !== undefined && candidateEnd < currentStart;
}

export function compareSessionChronology(a: WorkoutSession, b: WorkoutSession): number {
    const dateCompare = (a.date ?? '').localeCompare(b.date ?? '');
    if (dateCompare !== 0) return dateCompare;
    return (sessionTimestamp(a, false) ?? 0) - (sessionTimestamp(b, false) ?? 0);
}

/** Filter and order an immutable history once per report, not once per exercise. */
export function orderedEarlierSessions(history: WorkoutSession[], current: WorkoutSession): WorkoutSession[] {
    return history.filter(session => isSessionEarlier(session, current)).sort(compareSessionChronology);
}
