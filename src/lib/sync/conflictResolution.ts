import type { DataConflict } from './reconcile';

export function userDataConflictPath(path: string[]): string[] {
    if (path[0] === 'history_months') return ['history', ...path.slice(2)];
    if (path[0] === 'nutrition_months') return ['nutrition', ...path.slice(2)];
    return path;
}

// Array path segments are stable record IDs, never array indices. A missing value
// is a deletion; zero, false and null remain explicit choices.
export function applyConflictChoice(current: unknown, conflict: DataConflict, choice: 'local' | 'remote'): unknown {
    const value = conflict[choice];
    const put = (node: unknown, path: string[]): unknown => {
        if (!path.length) return structuredClone(value);
        const [key, ...rest] = path;
        if (Array.isArray(node)) {
            const index = node.findIndex(item => item && String(item.id) === key);
            const replacement = put(index < 0 ? undefined : node[index], rest);
            const result = [...node];
            if (index < 0) { if (replacement !== undefined) result.push(replacement); }
            else if (replacement === undefined) result.splice(index, 1);
            else result[index] = replacement;
            return result;
        }
        const record = node && typeof node === 'object' ? node as Record<string, unknown> : {};
        const replacement = put(Object.hasOwn(record, key) ? record[key] : undefined, rest);
        return Object.fromEntries([
            ...Object.entries(record).filter(([name]) => name !== key),
            ...(replacement === undefined ? [] : [[key, replacement]]),
        ]);
    };
    return put(current, userDataConflictPath(conflict.path));
}
