/**
 * Parse a complete, finite, unsigned decimal measurement. This is the same
 * input boundary for US Navy calculations and persisted body metrics:
 * Number() would reinterpret hexadecimal, binary or exponent notation.
 */
export function parseMeasurementNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

export interface BodyMeasurementDraft {
    weight: string;
    waist: string;
    neck: string;
    hip: string;
    chest: string;
    shoulders: string;
    biceps: string;
    thighs: string;
    calves: string;
}

type BodyMeasurementValues = {
    weight: number;
} & {
    [K in Exclude<keyof BodyMeasurementDraft, 'weight'>]: number | undefined;
};

type Preparation =
    | { ok: true; values: BodyMeasurementValues }
    | { ok: false; reason: 'weight' | 'optional' };

function optionalPositiveDecimal(value: string): number | undefined | null {
    if (value === '') return undefined;
    const parsed = parseMeasurementNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

export function prepareBodyMeasurements(form: BodyMeasurementDraft): Preparation {
    const weight = parseMeasurementNumber(form.weight);
    if (weight === null || weight <= 0) return { ok: false, reason: 'weight' };
    const parsed = {
        waist: optionalPositiveDecimal(form.waist),
        neck: optionalPositiveDecimal(form.neck),
        hip: optionalPositiveDecimal(form.hip),
        chest: optionalPositiveDecimal(form.chest),
        shoulders: optionalPositiveDecimal(form.shoulders),
        biceps: optionalPositiveDecimal(form.biceps),
        thighs: optionalPositiveDecimal(form.thighs),
        calves: optionalPositiveDecimal(form.calves),
    };
    if (Object.values(parsed).some(value => value === null)) {
        return { ok: false, reason: 'optional' };
    }
    return {
        ok: true,
        values: {
            weight,
            waist: parsed.waist ?? undefined,
            neck: parsed.neck ?? undefined,
            hip: parsed.hip ?? undefined,
            chest: parsed.chest ?? undefined,
            shoulders: parsed.shoulders ?? undefined,
            biceps: parsed.biceps ?? undefined,
            thighs: parsed.thighs ?? undefined,
            calves: parsed.calves ?? undefined,
        },
    };
}
