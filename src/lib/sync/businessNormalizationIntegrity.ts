function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLosslessScalarNormalization(raw: unknown, normalized: unknown): boolean {
    if (typeof raw === 'string' && typeof normalized === 'number') {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        const numeric = Number(trimmed);
        // A parsed integer outside the safe range may already have lost digits.
        return Number.isFinite(numeric)
            && (!Number.isInteger(numeric) || Number.isSafeInteger(numeric))
            && numeric === normalized;
    }
    if (typeof raw === 'number' && typeof normalized === 'string') {
        return Number.isFinite(raw) && String(raw) === normalized;
    }
    if (typeof raw === 'string' && typeof normalized === 'boolean') {
        if (raw === 'true' || raw === '1') return normalized;
        if (raw === 'false' || raw === '0') return !normalized;
        return false;
    }
    if (typeof raw === 'number' && typeof normalized === 'boolean') {
        return (raw === 0 || raw === 1) && normalized === (raw === 1);
    }
    return false;
}

export function findLossyNormalization(raw: unknown, normalized: unknown, path: string[] = []): string[] | null {
    if (Object.is(raw, normalized) || isLosslessScalarNormalization(raw, normalized)) return null;

    if (Array.isArray(raw)) {
        if (!Array.isArray(normalized) || raw.length !== normalized.length) return path;
        for (let index = 0; index < raw.length; index++) {
            const mismatch = findLossyNormalization(raw[index], normalized[index], [...path, String(index)]);
            if (mismatch) return mismatch;
        }
        return null;
    }

    if (isRecord(raw)) {
        if (!isRecord(normalized)) return path;
        for (const [key, value] of Object.entries(raw)) {
            if (!Object.hasOwn(normalized, key)) return [...path, key];
            const mismatch = findLossyNormalization(value, normalized[key], [...path, key]);
            if (mismatch) return mismatch;
        }
        return null;
    }

    return path;
}

