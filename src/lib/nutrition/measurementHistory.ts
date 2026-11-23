import type { NutritionDay } from '../../types';
import { MEASUREMENT_FIELDS, hasMeasurementData } from './measurementPresence';

const MEASUREMENT_SNAPSHOT_FIELDS = [...MEASUREMENT_FIELDS, 'bfProvenance', 'measurementTime'] as const;
const SLEEP_FIELDS = ['sleepHours', 'sleepDeep', 'sleepLight', 'sleepRem', 'sleepAwake'] as const;

export type MeasurementSnapshot = Pick<NutritionDay, typeof MEASUREMENT_SNAPSHOT_FIELDS[number]>;

export function captureMeasurement(day: NutritionDay): MeasurementSnapshot {
    // The deletion witness must not change when the originating day's
    // nested BF provenance is edited while confirmation is pending.
    return structuredClone(Object.fromEntries(MEASUREMENT_SNAPSHOT_FIELDS
        .filter(field => day[field] !== undefined)
        .map(field => [field, day[field]]))) as MeasurementSnapshot;
}

export const MEASUREMENT_CLEAR_PATCH: Readonly<MeasurementSnapshot> = Object.freeze(
    Object.fromEntries(MEASUREMENT_SNAPSHOT_FIELDS.map(field => [field, undefined])),
);

export function selectMeasurementHistory(nutrition: Record<string, NutritionDay>): NutritionDay[] {
    return Object.values(nutrition)
        .filter(day => day && (hasMeasurementData(day)
            || SLEEP_FIELDS.some(field => day[field] !== undefined && day[field] !== null && day[field] !== '')))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
