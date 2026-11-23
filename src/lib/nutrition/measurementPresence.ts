import type { MeasurementHistoryDay } from '../../types';

// Presence is deliberately distinct from numerical validity: a corrupt or
// unfamiliar stored value must not silently turn a recorded day into "empty".
export const MEASUREMENT_FIELDS = [
    'weight', 'bf', 'waist', 'neck', 'hip', 'chest',
    'shoulders', 'biceps', 'thighs', 'calves',
] as const satisfies readonly (keyof MeasurementHistoryDay)[];

export function hasMeasurementData(day: MeasurementHistoryDay | null | undefined): boolean {
    return MEASUREMENT_FIELDS.some(key =>
        day?.[key] !== undefined && day?.[key] !== null && day?.[key] !== ''
    );
}
