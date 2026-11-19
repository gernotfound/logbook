import { format, isValid, parseISO, addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { isBoundedCycleCount, MAX_CALCULATED_CYCLE_WEEKS } from './cycleLimits';
import type { TrainingCycle } from '../../types';
import type { CycleTimelineInfo } from './planning';

function invalidCycleTimeline(formattedRange: string): CycleTimelineInfo {
    return {
        formattedStartDate: '',
        formattedEndDate: '',
        formattedRange,
        currentWeek: 0,
        totalWeeks: 0,
        isStarted: false,
        isEnded: false,
        progressPercent: 0,
        statusLabel: 'Parametri del ciclo da correggere',
    };
}

export function calculateCycleTimeline(
    cycle: TrainingCycle | null | undefined,
    currentDate: Date | string = new Date()
): CycleTimelineInfo {
    let totalWeeks = cycle?.durationWeeks ?? 4;
    if (!isBoundedCycleCount(totalWeeks, MAX_CALCULATED_CYCLE_WEEKS)) {
        return invalidCycleTimeline('Parametri del ciclo non validi');
    }

    if (!cycle?.startDate) {
        return {
            formattedStartDate: '',
            formattedEndDate: '',
            formattedRange: `${totalWeeks} settimane`,
            currentWeek: 1,
            totalWeeks,
            isStarted: true,
            isEnded: false,
            progressPercent: 0,
            statusLabel: `${totalWeeks} settimane`
        };
    }

    let parsedStart: Date | null = null;
    try {
        parsedStart = typeof cycle.startDate === 'string' && !cycle.startDate.includes('T')
            ? parseISO(cycle.startDate)
            : new Date(cycle.startDate);
    } catch {
        // An invalid persisted date must not be misrepresented as starting today.
    }
    if (!parsedStart || !isValid(parsedStart)) {
        return invalidCycleTimeline('Data di inizio del ciclo non valida');
    }

    let today: Date;
    try {
        today = typeof currentDate === 'string'
            ? (!currentDate.includes('T') ? parseISO(currentDate) : new Date(currentDate))
            : currentDate;
        if (!isValid(today)) {
            today = new Date();
        }
    } catch {
        today = new Date();
    }

    const start = startOfDay(parsedStart);
    let end = addDays(start, totalWeeks * 7 - 1);
    if (cycle.endDate) {
        try {
            const parsedEnd = typeof cycle.endDate === 'string' && !cycle.endDate.includes('T')
                ? parseISO(cycle.endDate)
                : new Date(cycle.endDate);
            if (isValid(parsedEnd) && differenceInCalendarDays(parsedEnd, start) >= 0) {
                end = startOfDay(parsedEnd);
            }
        } catch {
            // fallback to computed end
        }
    }
    const now = startOfDay(today);

    const formattedStartDate = format(start, 'dd/MM/yyyy');
    const formattedEndDate = format(end, 'dd/MM/yyyy');
    const formattedRange = `dal ${formattedStartDate} al ${formattedEndDate}`;

    const diffDays = differenceInCalendarDays(now, start);
    const totalDays = differenceInCalendarDays(end, start) + 1;
    totalWeeks = Math.ceil(totalDays / 7);
    // An explicit end date can extend a valid duration beyond the safe
    // computation window; the timeline and schedule must reject it together.
    if (!isBoundedCycleCount(totalWeeks, MAX_CALCULATED_CYCLE_WEEKS)) {
        return invalidCycleTimeline('Periodo del ciclo non valido');
    }

    if (diffDays < 0) {
        const daysToStart = Math.abs(diffDays);
        return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd'),
            formattedStartDate,
            formattedEndDate,
            formattedRange,
            currentWeek: 0,
            totalWeeks,
            isStarted: false,
            isEnded: false,
            progressPercent: 0,
            statusLabel: daysToStart === 1 ? 'Inizia domani' : `Inizia tra ${daysToStart} giorni`,
            daysRemaining: daysToStart
        };
    }

    if (diffDays >= totalDays) {
        return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd'),
            formattedStartDate,
            formattedEndDate,
            formattedRange,
            currentWeek: totalWeeks,
            totalWeeks,
            isStarted: true,
            isEnded: true,
            progressPercent: 100,
            statusLabel: 'Ciclo completato',
            daysRemaining: 0
        };
    }

    const currentWeek = Math.min(totalWeeks, Math.floor(diffDays / 7) + 1);
    const progressPercent = Math.min(100, Math.max(1, Math.round(((diffDays + 1) / totalDays) * 100)));
    const daysRemaining = totalDays - (diffDays + 1);

    return {
        startDate: format(start, 'yyyy-MM-dd'),
        endDate: format(end, 'yyyy-MM-dd'),
        formattedStartDate,
        formattedEndDate,
        formattedRange,
        currentWeek,
        totalWeeks,
        isStarted: true,
        isEnded: false,
        progressPercent,
        statusLabel: `Settimana ${currentWeek} di ${totalWeeks}`,
        daysRemaining
    };
}
