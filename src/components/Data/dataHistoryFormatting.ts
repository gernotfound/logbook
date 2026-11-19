import { formatSleepTime } from '../../lib/utils/date';
import type { MeasurementHistoryDay } from '../../types';

export const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_FORMATTER = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const DAY_FORMATTER = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});


export function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function dateFromKey(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
}

export function monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    const label = MONTH_FORMATTER.format(new Date(year, month - 1, 1, 12, 0, 0));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

export function dayLabel(key: string): string {
    const label = DAY_FORMATTER.format(dateFromKey(key));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

const MEASUREMENT_FIELDS = ['weight', 'bf', 'waist', 'neck', 'hip', 'chest', 'shoulders', 'biceps', 'thighs', 'calves'] as const satisfies readonly (keyof MeasurementHistoryDay)[];

export function hasMeasurementData(day: MeasurementHistoryDay): boolean {
    return MEASUREMENT_FIELDS.some(key => day?.[key] !== undefined && day?.[key] !== null && day?.[key] !== '');
}

export function hasFiniteValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

export function finiteAverage(days: MeasurementHistoryDay[], key: 'weight' | 'bf'): number | null {
    const values = days
        .filter(day => hasFiniteValue(day?.[key]))
        .map(day => Number(day[key]));
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    if (day?.sleepHours) parts.push(`Sonno ${formatSleepTime(day.sleepHours)}`);
    return parts.join(' · ') || 'Dati registrati';
}
