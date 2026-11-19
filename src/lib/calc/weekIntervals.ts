import { startOfWeek, endOfWeek, subWeeks, format, parseISO, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
// Type-only reference to the public facade; no runtime dependency cycle.
import type { WeekInterval } from './analytics';

export function generateWeekIntervals(
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): WeekInterval[] {
    const requestedWeeks = Number.isFinite(numWeeks) ? Math.trunc(numWeeks) : 8;
    const validWeeks = Math.max(1, Math.min(52, requestedWeeks || 8));
    const ref = typeof referenceDate === 'string' ? parseISO(referenceDate) : referenceDate;
    const baseDate = isValid(ref) ? ref : new Date();

    const currentWeekMonday = startOfWeek(baseDate, { weekStartsOn: 1 });
    const intervals: WeekInterval[] = [];

    for (let i = validWeeks - 1; i >= 0; i--) {
        const start = subWeeks(currentWeekMonday, i);
        const end = endOfWeek(start, { weekStartsOn: 1 });
        const weekStartStr = format(start, 'yyyy-MM-dd');
        const weekEndStr = format(end, 'yyyy-MM-dd');

        const label = validWeeks <= 12
            ? format(start, 'd MMM', { locale: it })
            : format(start, 'dd/MM');

        intervals.push({
            weekIndex: validWeeks - 1 - i,
            startDate: start,
            endDate: end,
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            label
        });
    }

    return intervals;
}

export function referenceDayFor(referenceDate: Date | string): string {
    const parsed = typeof referenceDate === 'string' ? parseISO(referenceDate) : referenceDate;
    return format(isValid(parsed) ? parsed : new Date(), 'yyyy-MM-dd');
}
