import { getLocalDateString } from '../../utils/date';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requireId(value: unknown, label: string): string {
    const id = String(value ?? '').trim();
    if (!id || id === 'undefined' || id === 'null' || id.includes('/')) {
        throw new Error(`${label}: identificativo non valido`);
    }
    return id;
}

export function requireDate(date: string): string {
    if (!DATE_RE.test(date) || getLocalDateString(new Date(`${date}T12:00:00`)) !== date) {
        throw new Error('Data dominio non valida');
    }
    return date;
}

export function assertUnique<T>(items: readonly T[], identity: (item: T) => string, label: string): void {
    const seen = new Set<string>();
    for (const item of items) {
        const id = identity(item);
        if (seen.has(id)) throw new Error(`${label}: identificativo duplicato ${id}`);
        seen.add(id);
    }
}

export function applyPatch<T extends object>(target: T, patch: Partial<T>): T {
    const result = { ...target } as T;
    for (const key of Object.keys(patch) as Array<keyof T>) {
        const value = patch[key];
        if (value === undefined) Reflect.deleteProperty(result, key);
        else Object.assign(result, { [key]: value });
    }
    return result;
}

export function upsertById<T>(
    items: readonly T[] | undefined,
    item: T,
    identity: (value: T) => string,
    label: string,
): T[] {
    const current = [...(items ?? [])];
    assertUnique(current, identity, label);
    const id = identity(item);
    const index = current.findIndex(value => identity(value) === id);
    if (index < 0) current.push(item);
    else current[index] = item;
    assertUnique(current, identity, label);
    return current;
}

export function deleteById<T>(
    items: readonly T[] | undefined,
    id: string,
    identity: (value: T) => string,
    label: string,
): T[] {
    const current = [...(items ?? [])];
    assertUnique(current, identity, label);
    return current.filter(value => identity(value) !== id);
}

export function reorderByIds<T>(
    items: readonly T[] | undefined,
    ids: readonly string[],
    identity: (value: T) => string,
    label: string,
): T[] {
    const current = [...(items ?? [])];
    assertUnique(current, identity, label);
    const normalized = ids.map(id => requireId(id, label));
    if (new Set(normalized).size !== normalized.length) throw new Error(`${label}: ordine duplicato`);
    const currentIds = current.map(identity);
    if (normalized.length !== currentIds.length || currentIds.some(id => !normalized.includes(id))) {
        throw new Error(`${label}: l'ordine deve contenere esattamente le entità correnti`);
    }
    const byId = new Map(current.map(item => [identity(item), item]));
    return normalized.map(id => byId.get(id)!);
}
