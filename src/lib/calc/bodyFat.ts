interface NavyMeasurements {
    gender: 'M' | 'F';
    height: number;
    waist: number;
    neck: number;
    hip?: number;
}

/** A measurement must be a complete, finite decimal value, not a numeric prefix. */
export function parseBodyFatMeasurement(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

function calculateUsNavyBodyFat({ gender, height, waist, neck, hip }: NavyMeasurements): number | null {
    if (![height, waist, neck].every(Number.isFinite) || height < 50 || height > 250 || waist <= 0 || neck <= 0) {
        return null;
    }
    let denominator: number;
    if (gender === 'M') {
        if (waist <= neck) return null;
        denominator = 1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height);
    } else {
        if (hip === undefined || !Number.isFinite(hip) || hip <= 0 || waist + hip <= neck) return null;
        denominator = 1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(height);
    }
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    const bf = 495 / denominator - 450;
    return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
}

function calculateFromMeasurements(gender: 'M' | 'F', inputs: Record<string, unknown>): number | null {
    const height = parseBodyFatMeasurement(inputs.height);
    const waist = parseBodyFatMeasurement(inputs.waist);
    const neck = parseBodyFatMeasurement(inputs.neck);
    if (height === null || waist === null || neck === null) return null;
    if (gender === 'F') {
        const hip = parseBodyFatMeasurement(inputs.hip);
        return hip === null ? null : calculateUsNavyBodyFat({ gender, height, waist, neck, hip });
    }
    return calculateUsNavyBodyFat({ gender, height, waist, neck });
}

export function calculateBodyFatByMethod(method: unknown, params: unknown): number | null {
    if (typeof method !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) return null;
    const normalized = method.trim().toLowerCase();
    if (normalized !== 'navy_male' && normalized !== 'navy_female') return null;
    return calculateFromMeasurements(normalized === 'navy_male' ? 'M' : 'F', params as Record<string, unknown>);
}

export function calculateBodyFat(weight: unknown, profile: unknown): number | null {
    const parsedWeight = parseBodyFatMeasurement(weight);
    if (parsedWeight === null || parsedWeight <= 0 || !profile || typeof profile !== 'object' || Array.isArray(profile)) {
        return null;
    }
    const inputs = profile as Record<string, unknown>;
    if (inputs.gender !== 'M' && inputs.gender !== 'F') return null;
    return calculateFromMeasurements(inputs.gender, inputs);
}
