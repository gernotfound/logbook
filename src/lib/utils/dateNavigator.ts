import { formatItalianDate } from './date';

/** Shared date-navigation semantics; callers retain their distinct UI styling. */
export function getDateNavigatorState(date: string, today: string, disabled = false) {
    const isToday = date === today;
    return {
        isToday,
        formattedDate: formatItalianDate(date),
        // Canonical YYYY-MM-DD dates sort in local calendar order, including across years.
        nextDisabled: disabled || date >= today,
    };
}
