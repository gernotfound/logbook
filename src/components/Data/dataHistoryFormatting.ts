import { formatSleepTime } from '../../lib/utils/date';
import type { MeasurementHistoryDay } from '../../types';

export { hasMeasurementData } from '../../lib/nutrition/measurementPresence';

export function hasFiniteValue(value: unknown): boolean {
    return value !== undefined && value !== null
        && !(typeof value === 'string' && value.trim() === '')
        && Number.isFinite(Number(value));
}

export function finiteAverage(days: MeasurementHistoryDay[], key: 'weight' | 'bf'): number | null {
    const values = days
        .filter(day => hasFiniteValue(day?.[key]))
        .map(day => Number(day[key]));
    if (values.length === 0) return null;
    // Sum of individually finite values may overflow even if their mean fits.
    // Scaling each contribution first avoids reporting an artificial infinity.
    const mean = values.reduce((sum, value) => sum + value / values.length, 0);
    return Number.isFinite(mean) ? mean : null;
}

const DECIMAL_FORMATTER = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

export function formatDecimal(value: number): string {
    return DECIMAL_FORMATTER.format(value);
}

export function recordSummary(day: MeasurementHistoryDay): string {
    const parts: string[] = [];
    if (hasFiniteValue(day?.weight)) parts.push(`${formatDecimal(Number(day.weight))} kg`);
    if (hasFiniteValue(day?.bf)) parts.push(`BF ${formatDecimal(Number(day.bf))}%`);
    if (hasFiniteValue(day?.waist)) parts.push(`Vita ${formatDecimal(Number(day.waist))} cm`);
    const sleep = formatSleepTime(day?.sleepHours);
    if (sleep) parts.push(`Sonno ${sleep}`);
    return parts.join(' · ') || 'Dati registrati';
}
