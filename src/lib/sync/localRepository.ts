import { get, update } from 'idb-keyval';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import { reconcile, type DataConflict } from './reconcile';
import { getNutritionConflictFingerprint } from '../utils/object';
import equal from 'fast-deep-equal';
import { applyConflictChoice } from './conflictResolution';

export interface PendingOperation {
    id: string;
    revision: number;
    base: UserData;
    desired: UserData;
    conflicts?: DataConflict[];
}

export interface LocalEnvelope {
    version: 2;
    owner: string;
    revision: number;
    data: UserData;
    baseline: UserData;
    completeMonths: string[];
    pending: PendingOperation[];
    conflicts?: DataConflict[];
    resolvedConflicts?: Array<{ conflict: DataConflict; choice: 'local' | 'remote'; revision: number }>;
}

const keyFor = (owner: string) => {
    if (!owner) throw new Error('Owner richiesto per la persistenza locale');
    return `logbook:v2:${owner}`;
};
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

function validate(value: LocalEnvelope | undefined, owner: string): LocalEnvelope | undefined {
    if (!value) return undefined;
    if (value.version !== 2 || value.owner !== owner || !Array.isArray(value.pending) || !Number.isSafeInteger(value.revision)) {
        throw new Error('Archivio locale non riconosciuto: conservato per il recupero');
    }
    return { ...value, data: parse(value.data), baseline: parse(value.baseline), pending: value.pending.map(op => ({ ...op, base: parse(op.base), desired: parse(op.desired) })) };
}

export async function readLocal(owner: string): Promise<LocalEnvelope | undefined> {
    return validate(await get<LocalEnvelope>(keyFor(owner)), owner);
}

export async function commitLocal(owner: string, data: UserData, initialBase: UserData): Promise<PendingOperation> {
    // Clone before opening the transaction: caller mutations cannot alter an accepted operation.
    const desired = structuredClone(parse(data));
    const fallback = structuredClone(parse(initialBase));
    let operation!: PendingOperation;
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        operation = {
            id: generateId('write'), revision: (current?.revision ?? 0) + 1,
            base: fallback, desired,
        };
        const merged = reconcile(fallback, desired, current?.data ?? fallback);
        return {
            ...current,
            version: 2, owner, revision: operation.revision, data: parse(merged.value),
            baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [],
            pending: owner === 'guest' ? [] : [...(current?.pending ?? []), operation],
            conflicts: [...(current?.conflicts ?? []), ...merged.conflicts],
        };
    });
    return operation;
}

export async function resolveLocalConflicts(owner: string, expectedRevision: number, expected: DataConflict[], choices: Array<'local' | 'remote'>, isCurrent: () => boolean): Promise<LocalEnvelope> {
    if (!expected.length || choices.length !== expected.length || choices.some(choice => choice !== 'local' && choice !== 'remote')) throw new Error('Scegli una versione per ogni conflitto.');
    let saved!: LocalEnvelope;
    await update<LocalEnvelope>(keyFor(owner), raw => {
        if (!isCurrent()) throw new Error('Sessione cambiata durante la risoluzione.');
        const current = validate(raw, owner);
        if (!current || current.revision !== expectedRevision || !equal(current.conflicts, expected)) throw new Error('I conflitti sono cambiati. Riapri il confronto prima di confermare.');
        let baseline: unknown = current.baseline;
        let desired: unknown = current.data;
        expected.forEach((conflict, index) => {
            baseline = applyConflictChoice(baseline, conflict, 'remote');
            desired = applyConflictChoice(desired, conflict, choices[index]);
        });
        const revision = current.revision + 1;
        const operation: PendingOperation = { id: generateId('resolution'), revision, base: parse(baseline), desired: parse(desired) };
        saved = { ...current, revision, baseline: operation.base, data: operation.desired, conflicts: [],
            pending: owner === 'guest' ? [] : [...current.pending, operation],
            resolvedConflicts: [...(current.resolvedConflicts ?? []), ...expected.map((conflict, index) => ({ conflict, choice: choices[index], revision }))] };
        return saved;
    });
    return saved;
}

export async function acknowledgeLocal(owner: string, id: string, remote: UserData): Promise<void> {
    const parsed = parse(remote);
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current || current.pending[0]?.id !== id) throw new Error('Conferma obsoleta o fuori ordine');
        const pending = current.pending.slice(1);
        return { ...current, baseline: parsed, data: pending.length ? current.data : parsed, pending };
    });
}

export async function preserveConflicts(owner: string, id: string, conflicts: DataConflict[]): Promise<void> {
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current || !current.pending.some(op => op.id === id)) throw new Error('Operazione non trovata');
        return { ...current, pending: current.pending.map(op => op.id === id ? { ...op, conflicts } : op) };
    });
}

export async function acknowledgeThrough(owner: string, revision: number, remote: UserData, expected?: UserData, months: string[] = []): Promise<void> {
    const parsed = parse(remote);
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current) throw new Error('Archivio locale non trovato');
        const pending = current.pending.filter(op => op.revision > revision);
        const merged = expected ? reconcile(expected, current.data, parsed) : { value: current.data, conflicts: [] };
        return { ...current, baseline: parsed, data: current.revision === revision ? parsed : parse(merged.value), pending,
            completeMonths: [...new Set([...current.completeMonths, ...months])], conflicts: [...(current.conflicts ?? []), ...merged.conflicts] };
    });
}

export async function initializeLocal(owner: string, data: UserData, completeMonths?: string[]): Promise<void> {
    const parsed = structuredClone(parse(data));
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        // A fetch must never replace a durable pending edit, including one from another tab.
        if (current?.pending.length) return current;
        return { ...current, version: 2, owner, revision: current?.revision ?? 0, data: parsed, baseline: parsed, completeMonths: completeMonths ?? current?.completeMonths ?? [], pending: [], conflicts: current?.conflicts ?? [] };
    });
}

export async function hydrateLocal(owner: string, cloudData: UserData, months: string[]): Promise<LocalEnvelope> {
    const cloud = structuredClone(parse(cloudData));
    const complete = new Set(months);
    let saved!: LocalEnvelope;
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current) {
            saved = { version: 2, owner, revision: 0, data: cloud, baseline: cloud, completeMonths: months, pending: [] };
        } else {
            const history = (current.baseline.history ?? []).filter(workout => !complete.has((workout.date ?? '').slice(0, 7)));
            const nutrition = Object.fromEntries(Object.entries(current.baseline.nutrition ?? {}).filter(([date]) => !complete.has(date.slice(0, 7))));
            const remote = parse({ ...cloud, history: [...history, ...(cloud.history ?? [])], nutrition: { ...nutrition, ...cloud.nutrition }, pendingConflicts: current.data.pendingConflicts });
            const merged = reconcile(current.baseline, current.data, remote);
            saved = { ...current, data: parse(merged.value), baseline: remote, completeMonths: [...new Set([...current.completeMonths, ...months])], conflicts: [...(current.conflicts ?? []), ...merged.conflicts] };
        }
        return saved;
    });
    return saved;
}

export async function clearNutritionConflict(owner: string, fingerprint: string, fallback: UserData): Promise<UserData> {
    let saved!: UserData;
    const clear = (data: UserData): UserData => {
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) return data;
        const { nutritionPlanning: _resolved, ...remaining } = data.pendingConflicts ?? {};
        const { pendingConflicts: _old, ...rest } = data;
        return Object.keys(remaining).length ? { ...rest, pendingConflicts: remaining } : rest;
    };
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        const data = current?.data ?? fallback;
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) throw new Error('Conflitto cambiato durante la risoluzione');
        saved = parse(clear(data));
        return {
            ...(current ?? { version: 2, owner, revision: 0, completeMonths: [], pending: [] }),
            data: saved, baseline: clear(current?.baseline ?? data),
            pending: (current?.pending ?? []).map(op => ({ ...op, base: clear(op.base), desired: clear(op.desired) })),
        };
    });
    return saved;
}

export async function revertRejectedConsent(owner: string, expected: UserData['legalConsent'], previous: UserData['legalConsent']): Promise<void> {
    const revert = (data: UserData) => equal(data.legalConsent, expected) ? parse({ ...data, legalConsent: previous }) : data;
    await update<LocalEnvelope>(keyFor(owner), raw => {
        const current = validate(raw, owner);
        if (!current) return raw!;
        return { ...current, data: revert(current.data), pending: current.pending.map(op => ({ ...op, base: revert(op.base), desired: revert(op.desired) })) };
    });
}

export async function preserveLegacyCache(): Promise<boolean> {
    const legacy = await get('logbook_cached_user_data');
    if (legacy === undefined) return false;
    // Do not attribute an unowned legacy cache or REST token to the currently signed-in user.
    await update('logbook:recovery:legacy', original => original ?? legacy);
    return true;
}
