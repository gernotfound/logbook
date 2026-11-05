import type { CardioIntensity, CardioModality, CardioStructure } from '../types';
import { getLocalDateString, parseDateInput } from './utils/date';

export const CARDIO_MODALITIES: ReadonlyArray<{ value: CardioModality; label: string }> = [
    { value: 'walk', label: 'Camminata' },
    { value: 'treadmill', label: 'Tapis roulant' },
    { value: 'bike', label: 'Cyclette' },
    { value: 'elliptical', label: 'Ellittica' },
    { value: 'stair', label: 'Stair climber' },
    { value: 'run', label: 'Corsa' },
    { value: 'row', label: 'Vogatore' },
    { value: 'swim', label: 'Nuoto' },
    { value: 'other', label: 'Altro' },
];

export const CARDIO_INTENSITIES: ReadonlyArray<{ value: CardioIntensity; label: string }> = [
    { value: 'low', label: 'Bassa' },
    { value: 'moderate', label: 'Moderata' },
    { value: 'high', label: 'Alta' },
];
export const CARDIO_STRUCTURES: ReadonlyArray<{ value: CardioStructure; label: string }> = [
    { value: 'continuous', label: 'Continua' },
    { value: 'intervals', label: 'Intervalli' },
];

export function cardioModalityLabel(value: CardioModality): string {
    return CARDIO_MODALITIES.find(item => item.value === value)?.label ?? 'Altro';
}

export function cardioIntensityLabel(value: CardioIntensity | undefined): string | null {
    if (!value) return null;
    return CARDIO_INTENSITIES.find(item => item.value === value)?.label ?? null;
}

/**
 * Dated-draft witness names admit only lowercase alphanumerics and hyphens.
 * Encode all UTF-16 code units, not a lossy slug: distinct valid business IDs
 * (including "new", underscores and accents) must never share a recovery slot.
 */
export function cardioDraftKind(id: string | null, isCreating: boolean): string {
    if (isCreating) return 'activity-cardio-create';
    if (id === null) return 'activity-cardio-idle';
    let encoded = '';
    for (let i = 0; i < id.length; i++) {
        encoded += id.charCodeAt(i).toString(16).padStart(4, '0');
    }
    return 'activity-cardio-edit-' + encoded;
}

export function localDateTimeToTimestamp(date: string, time: string): number | undefined {
    const validDate = parseDateInput(date);
    if (!validDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
    const [year, month, day] = validDate.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    const candidate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (!Number.isFinite(candidate.getTime()) || getLocalDateString(candidate) !== validDate) return undefined;
    if (candidate.getHours() !== hours || candidate.getMinutes() !== minutes) return undefined;
    return candidate.getTime();
}

export function timestampToLocalTime(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
