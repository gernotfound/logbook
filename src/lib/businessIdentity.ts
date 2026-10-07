const MAX_BUSINESS_ID_LENGTH = 160;

export function normalizeBusinessId(value: unknown): string | null {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        value = String(value);
    }
    if (typeof value !== 'string') return null;
    const id = value.trim();
    if (
        !id
        || id.length > MAX_BUSINESS_ID_LENGTH
        || id === 'undefined'
        || id === 'null'
        || id.includes('/')
    ) return null;
    return id;
}

export function isValidBusinessId(value: unknown): boolean {
    return normalizeBusinessId(value) !== null;
}

export function requireBusinessId(value: unknown, label: string): string {
    const id = normalizeBusinessId(value);
    if (!id) throw new Error(`${label}: identificativo non valido`);
    return id;
}
