import type { DocumentData } from './documentProjection';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLosslessScalarNormalization(raw: unknown, normalized: unknown): boolean {
    if (typeof raw === 'string' && typeof normalized === 'number') {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) && numeric === normalized;
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

function findLossyNormalization(raw: unknown, normalized: unknown, path: string[] = []): string[] | null {
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

export class CloudDataIntegrityError extends Error {
    constructor(documentPath: string, fieldPath: string[]) {
        const location = fieldPath.length ? fieldPath.join('.') : 'root';
        super(`Dati cloud non validi in Firestore ${documentPath || 'root'} (${location}): sincronizzazione bloccata per evitare una riscrittura distruttiva.`);
        this.name = 'CloudDataIntegrityError';
    }
}

export function assertCloudBusinessPreserved(path: string, raw: DocumentData, normalized: DocumentData): void {
    // normalizeCloudDocument has already removed protocol/schema metadata. Any
    // remaining root key is business data and must survive the canonical projection;
    // unknown same-schema fields are therefore an integrity error, not silent loss.
    const mismatch = findLossyNormalization(raw, normalized);
    if (mismatch) throw new CloudDataIntegrityError(path, mismatch);
}
