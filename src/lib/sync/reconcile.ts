import equal from 'fast-deep-equal';

export interface DataConflict {
    path: string[];
    base: unknown;
    local: unknown;
    remote: unknown;
}

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function keyedArray(value: unknown): value is Array<Record<string, unknown> & { id: string | number }> {
    if (!Array.isArray(value)) return false;
    const ids = new Set<string>();
    return value.every(item => {
        if (!record(item) || !['string', 'number'].includes(typeof item.id)) return false;
        const id = String(item.id);
        if (!id || ids.has(id)) return false;
        ids.add(id);
        return true;
    });
}

/** Apply intentional changes only; absence in an unchanged partial snapshot is not a deletion. */
export function reconcile(base: unknown, local: unknown, remote: unknown, path: string[] = []): { value: unknown; conflicts: DataConflict[] } {
    if (equal(local, base)) return { value: remote, conflicts: [] };
    if (equal(remote, base) || equal(remote, local)) return { value: local, conflicts: [] };

    if (keyedArray(local) && keyedArray(remote) && (base === undefined || keyedArray(base))) {
        const toMap = (items: Array<{ id: string | number }>) => Object.fromEntries(items.map(item => [String(item.id), item]));
        const merged = reconcile(toMap((base ?? []) as Array<{ id: string | number }>), toMap(local), toMap(remote), path);
        const values = merged.value as Record<string, unknown>;
        const ids = new Set([...local, ...remote].map(item => String(item.id)));
        return { value: [...ids].filter(id => values[id] !== undefined).map(id => values[id]), conflicts: merged.conflicts };
    }
    if (record(local) && record(remote) && (base === undefined || record(base))) {
        const original = (base ?? {}) as Record<string, unknown>;
        const value: Record<string, unknown> = {};
        const conflicts: DataConflict[] = [];
        for (const key of new Set([...Object.keys(original), ...Object.keys(local), ...Object.keys(remote)])) {
            const next = reconcile(original[key], local[key], remote[key], [...path, key]);
            if (next.value !== undefined) Object.defineProperty(value, key, { value: next.value, enumerable: true, writable: true, configurable: true });
            conflicts.push(...next.conflicts);
        }
        return { value, conflicts };
    }
    return { value: remote, conflicts: [{ path, base, local, remote }] };
}
