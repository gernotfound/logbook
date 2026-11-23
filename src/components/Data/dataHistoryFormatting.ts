import { formatSleepTime } from '../../lib/utils/date';
import { parseMeasurementNumber } from '../../lib/nutrition/measurementInput';
import type { MeasurementHistoryDay } from '../../types';

export { hasMeasurementData } from '../../lib/nutrition/measurementPresence';

export function hasFiniteValue(value: unknown): boolean {
    return parseMeasurementNumber(value) !== null;
}

export function finiteAverage(days: MeasurementHistoryDay[], key: 'weight' | 'bf'): number | null {
    const values = days
        .map(day => parseMeasurementNumber(day?.[key]))
        .filter((value): value is number => value !== null);
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

// History may contain numeric strings from a supported import; display must
// apply the same complete-decimal grammar used when saving measurements.
export function formatHistoryDecimal(value: unknown): string {
    const parsed = parseMeasurementNumber(value);
    return parsed === null ? '—' : formatDecimal(parsed);
}

export function recordSummary(day: MeasurementHistoryDay): string {
    const parts: string[] = [];
    if (hasFiniteValue(day?.weight)) parts.push(`${formatHistoryDecimal(day.weight)} kg`);
    if (hasFiniteValue(day?.bf)) parts.push(`BF ${formatHistoryDecimal(day.bf)}%`);
    if (hasFiniteValue(day?.waist)) parts.push(`Vita ${formatHistoryDecimal(day.waist)} cm`);
    const sleep = formatSleepTime(day?.sleepHours);
    if (sleep) parts.push(`Sonno ${sleep}`);
    return parts.join(' · ') || 'Dati registrati';
}
