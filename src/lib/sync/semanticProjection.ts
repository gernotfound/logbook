import equal from 'fast-deep-equal';
import { type DocumentData } from './documentProjection';
import { calculateLoggedMealTotals } from '../nutrition/calculateLoggedMealTotals';

export type MergePolicy = 'keyed' | 'ordered-keyed' | 'atomic' | 'property' | 'ignore';

export interface VectorClock {
    [actorId: string]: number;
}

export interface FieldStamp {
    clock: VectorClock;
    actorId: string;
    seq: number;
    deleted?: boolean;
}

export interface SyncMeta {
    protocolVersion: 1;
    clock: VectorClock;
    fields: Record<string, FieldStamp>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseVectorClock(raw: unknown, context: string): VectorClock {
    if (!isRecord(raw)) throw new Error(`Invalid ${context}`);
    const clock: VectorClock = {};
    for (const [actor, seq] of Object.entries(raw)) {
        if (!actor.trim()) throw new Error(`Invalid actor ID in ${context}`);
        if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) throw new Error(`Invalid seq in ${context}`);
        clock[actor] = seq;
    }
    return clock;
}

export function parseSyncMeta(raw: unknown): SyncMeta {
    if (!isRecord(raw)) throw new Error('Invalid SyncMeta');
    if (raw.protocolVersion !== 1) throw new Error('Unsupported protocolVersion');

    const clock = parseVectorClock(raw.clock, 'clock');
    if (!isRecord(raw.fields)) throw new Error('Invalid fields map');

    const fields: Record<string, FieldStamp> = {};
    for (const [path, stampRaw] of Object.entries(raw.fields)) {
        if (!path) throw new Error('Invalid field path');
        if (!isRecord(stampRaw)) throw new Error('Invalid FieldStamp');
        if (typeof stampRaw.actorId !== 'string' || !stampRaw.actorId.trim()) throw new Error('Invalid actorId in FieldStamp');
        if (typeof stampRaw.seq !== 'number' || !Number.isInteger(stampRaw.seq) || stampRaw.seq < 0) throw new Error('Invalid seq in FieldStamp');

        const fieldStamp: FieldStamp = {
            clock: parseVectorClock(stampRaw.clock, 'field clock'),
            actorId: stampRaw.actorId,
            seq: stampRaw.seq
        };

        if ('deleted' in stampRaw) {
            if (typeof stampRaw.deleted !== 'boolean') throw new Error('Invalid deleted flag in FieldStamp');
            fieldStamp.deleted = stampRaw.deleted;
        }

        fields[path] = fieldStamp;
    }

    return { protocolVersion: 1, clock, fields };
}

export interface SemanticOperation {
    docPath: string;
    path: string[];
    isDelete: boolean;
    value?: unknown;
    actorId: string;
    seq: number;
    clock: VectorClock;
    guard?: { path: string[], equals: any };
}

export function diffDocuments(
    base: Map<string, DocumentData>,
    desired: Map<string, DocumentData>,
    actorId: string,
    seq: number,
    clock: VectorClock
): SemanticOperation[] {
    const ops: SemanticOperation[] = [];
    const allPaths = new Set([...base.keys(), ...desired.keys()]);

    for (const docPath of allPaths) {
        const bDoc = base.get(docPath) ?? {};
        const dDoc = desired.get(docPath) ?? {};

        const allProps = new Set([...Object.keys(bDoc), ...Object.keys(dDoc)]);
        for (const prop of allProps) {
            traverseAndDiff(docPath, [prop], bDoc[prop], dDoc[prop], actorId, seq, clock, ops);
        }
    }

    // Active workout children are valid only while the same session is active.
    for (const op of ops) {
        if (op.docPath === '' && op.path[0] === 'activeWorkout' && op.path.length > 1) {
            const dRoot: DocumentData = desired.get('') ?? {};
            const bRoot: DocumentData = base.get('') ?? {};
            const aw = dRoot.activeWorkout ?? bRoot.activeWorkout;
            if (isRecord(aw)) {
                const awId = aw.id;
                const hasStableId =
                    (typeof awId === 'string' && awId.trim().length > 0) ||
                    (typeof awId === 'number' && Number.isFinite(awId));
                if (hasStableId) op.guard = { path: ['activeWorkout', 'id'], equals: awId };
            }
        }
    }

    return ops;
}

export function fieldKey(path: string[]): string {
    return path.map(p => encodeURIComponent(String(p))).join('/');
}

export function getMergePolicy(docPath: string, path: string[]): MergePolicy {
    if (docPath === '') {
        const root = path[0];
        if (['profile', 'nutritionPlanning', 'catalogOverrides'].includes(root)) return 'property';
        if (['library', 'customFoods'].includes(root)) {
            if (path.length === 1) return 'keyed';
            return 'property';
        }
        if (['routines', 'trainingCycles', 'supplements'].includes(root)) {
            if (path.length === 1) return 'ordered-keyed';
            if (root === 'routines' && path.length === 3 && path[2] === 'exercises') return 'ordered-keyed';
            if (root === 'trainingCycles' && path.length === 3 && path[2] === 'routines') return 'ordered-keyed';
            return 'property';
        }
        if (['history'].includes(root)) {
            if (path.length === 1) return 'keyed';
            return 'property';
        }
        if (root === 'activeWorkout') {
            if (path.length === 1) return 'property';
            if (path[1] === 'exercises') {
                if (path.length === 2) return 'ordered-keyed';
                if (path.length === 3) return 'property';
                if (path[3] === 'sets') {
                    if (path.length === 4) return 'keyed';
                    return 'property';
                }
                return 'property';
            }
            return 'property';
        }
        return 'atomic';
    }

    if (docPath.startsWith('nutrition_months/')) {
        if (path.length === 1) return 'property';
        const prop = path[1];
        if (path.length === 2 && ['kcal', 'carbs', 'pro', 'fat'].includes(String(prop))) return 'ignore';
        if (prop === 'meals' || prop === 'supplementsIntake') {
            if (path.length === 2) return 'keyed';
            return 'property';
        }
        return 'property';
    }

    if (docPath.startsWith('history_months/')) {
        if (path.length === 1) return 'property';
        if (path[1] === 'exercises') {
            if (path.length === 2) return 'ordered-keyed';
            if (path.length === 3) return 'property';
            if (path[3] === 'sets') {
                if (path.length === 4) return 'keyed';
                return 'property';
            }
            return 'property';
        }
        return 'property';
    }

    return 'atomic';
}

export function resolveIdentity(path: string[], item: any): string {
    const collection = path[path.length - 1];
    let id: any;
    if (collection === 'exercises') id = item.exId ?? item.id;
    else if (path[0] === 'trainingCycles' && collection === 'routines') id = item.routineId;
    else id = item.id ?? item.exId ?? item.routineId;

    const strId = String(id);
    if (id === undefined || id === null || strId === '' || strId === 'undefined' || strId === 'null') {
        throw new Error(`Invalid identity in ${collection}`);
    }
    return strId;
}

function identitySeed(path: string[], itemId: string): Record<string, string> {
    const collection = path[path.length - 1];
    if (collection === 'exercises') return { exId: itemId };
    if (path[0] === 'trainingCycles' && collection === 'routines') return { routineId: itemId };
    return { id: itemId };
}

function traverseAndDiff(
    docPath: string,
    currentPath: string[],
    bVal: any,
    dVal: any,
    actorId: string,
    seq: number,
    clock: VectorClock,
    ops: SemanticOperation[]
) {
    if (equal(bVal, dVal)) return;

    const policy = getMergePolicy(docPath, currentPath);
    if (policy === 'ignore') return;

    if (policy === 'atomic') {
        ops.push({
            docPath,
            path: currentPath,
            value: dVal === undefined ? null : dVal,
            isDelete: dVal === undefined,
            actorId,
            seq,
            clock
        });
    } else if (policy === 'property') {
        const isPropertyContainer = (
            (docPath.startsWith('nutrition_months/') && currentPath.length === 1) ||
            (docPath.startsWith('history_months/') && currentPath.length === 1) ||
            (docPath === '' && currentPath.length === 1 && ['profile', 'nutritionPlanning', 'catalogOverrides'].includes(currentPath[0]))
        );
        let effBVal = bVal;
        const effDVal = dVal;

        // New property containers are expanded so independent concurrent children can converge.
        // Deletions are intentionally NOT expanded: they must remain a parent tombstone.
        if (isPropertyContainer && effBVal === undefined && effDVal !== undefined && typeof effDVal === 'object' && effDVal !== null && !Array.isArray(effDVal)) {
            effBVal = {};
        }

        if (effBVal === undefined || effDVal === undefined || typeof effBVal !== 'object' || typeof effDVal !== 'object' || effBVal === null || effDVal === null || Array.isArray(effBVal) || Array.isArray(effDVal)) {
            ops.push({
                docPath,
                path: currentPath,
                value: dVal === undefined ? null : dVal,
                isDelete: dVal === undefined,
                actorId,
                seq,
                clock
            });
            return;
        }

        if (currentPath.length === 1 && currentPath[0] === 'activeWorkout') {
            // A session without stable identity cannot safely support child-level operations.
            if (!effBVal.id || !effDVal.id || effBVal.id !== effDVal.id) {
                ops.push({
                    docPath,
                    path: currentPath,
                    value: dVal,
                    isDelete: false,
                    actorId,
                    seq,
                    clock
                });
                return;
            }
        }

        const allKeys = new Set([...Object.keys(effBVal), ...Object.keys(effDVal)]);
        for (const k of allKeys) {
            traverseAndDiff(docPath, [...currentPath, k], effBVal[k], effDVal[k], actorId, seq, clock, ops);
        }
    } else if (policy === 'keyed' || policy === 'ordered-keyed') {
        const bArr = Array.isArray(bVal) ? bVal : [];
        const dArr = Array.isArray(dVal) ? dVal : [];

        let valid = true;
        const bMap = new Map<string, any>();
        const dMap = new Map<string, any>();

        try {
            for (const item of bArr) {
                const id = resolveIdentity(currentPath, item);
                if (bMap.has(id)) { valid = false; break; }
                bMap.set(id, item);
            }
            if (valid) {
                for (const item of dArr) {
                    const id = resolveIdentity(currentPath, item);
                    if (dMap.has(id)) { valid = false; break; }
                    dMap.set(id, item);
                }
            }
        } catch {
            valid = false;
        }

        if (!valid) {
            ops.push({
                docPath,
                path: currentPath,
                value: dVal === undefined ? null : dVal,
                isDelete: dVal === undefined,
                actorId,
                seq,
                clock
            });
            return;
        }

        if (policy === 'ordered-keyed') {
            const bOrder = bArr.map((item: any) => resolveIdentity(currentPath, item));
            const dOrder = dArr.map((item: any) => resolveIdentity(currentPath, item));
            if (!equal(bOrder, dOrder)) {
                ops.push({
                    docPath,
                    path: [...currentPath, '$order'],
                    value: dOrder,
                    isDelete: false,
                    actorId,
                    seq,
                    clock
                });
            }
        }

        const allIds = new Set([...bMap.keys(), ...dMap.keys()]);
        for (const id of allIds) {
            const bItem = bMap.get(id);
            const dItem = dMap.get(id);
            if (!equal(bItem, dItem)) {
                if (dItem === undefined) {
                    ops.push({
                        docPath,
                        path: [...currentPath, id],
                        isDelete: true,
                        actorId,
                        seq,
                        clock
                    });
                } else if (bItem === undefined) {
                    ops.push({
                        docPath,
                        path: [...currentPath, id],
                        value: dItem,
                        isDelete: false,
                        actorId,
                        seq,
                        clock
                    });
                } else {
                    traverseAndDiff(docPath, [...currentPath, id], bItem, dItem, actorId, seq, clock, ops);
                }
            }
        }
    }
}

export function mergeVectors(...clocks: VectorClock[]): VectorClock {
    const res: VectorClock = {};
    for (const c of clocks) {
        for (const [a, s] of Object.entries(c)) {
            res[a] = Math.max(res[a] || 0, s);
        }
    }
    return res;
}

export function dominates(clockA: VectorClock, clockB: VectorClock): boolean {
    let hasStrictlyGreater = false;
    for (const actor of Object.keys(clockB)) {
        const aVal = clockA[actor] || 0;
        const bVal = clockB[actor] || 0;
        if (aVal < bVal) return false;
        if (aVal > bVal) hasStrictlyGreater = true;
    }
    for (const actor of Object.keys(clockA)) {
        if ((clockA[actor] || 0) > (clockB[actor] || 0)) hasStrictlyGreater = true;
    }
    return hasStrictlyGreater;
}

export interface StampLike {
    clock: VectorClock;
    isDelete?: boolean;
    actorId: string;
    seq: number;
}

export function stampWins(opA: StampLike, opB: StampLike): boolean {
    if (dominates(opA.clock, opB.clock)) return true;
    if (dominates(opB.clock, opA.clock)) return false;

    if (opA.isDelete && !opB.isDelete) return true;
    if (opB.isDelete && !opA.isDelete) return false;

    if (opA.actorId === opB.actorId) return opA.seq > opB.seq;
    return opA.actorId > opB.actorId;
}

export function normalizeDomainData(docs: Map<string, DocumentData>) {
    for (const [path, doc] of docs.entries()) {
        if (path.startsWith('nutrition_months/')) {
            for (const [, dayData] of Object.entries(doc)) {
                if (dayData && typeof dayData === 'object' && Array.isArray((dayData as any).meals)) {
                    const totals = calculateLoggedMealTotals((dayData as any).meals);
                    (dayData as any).kcal = totals.kcal;
                    (dayData as any).carbs = totals.carbs;
                    (dayData as any).pro = totals.pro;
                    (dayData as any).fat = totals.fat;
                }
            }
        } else if (path.startsWith('history_months/')) {
            for (const [id, workoutData] of Object.entries(doc)) {
                if (id === '_sync') continue;
                if (!workoutData || typeof workoutData !== 'object' || !(workoutData as any).id) delete doc[id];
            }
        }
    }
}

export function applySemanticOperations(
    base: Map<string, DocumentData>,
    ops: SemanticOperation[],
    remoteSyncMetas: Record<string, SyncMeta> = {}
): { documents: Map<string, DocumentData>, syncMetas: Record<string, SyncMeta> } {
    const resultDocs = new Map<string, DocumentData>();
    for (const [path, doc] of base.entries()) resultDocs.set(path, JSON.parse(JSON.stringify(doc)));

    const resultMetas: Record<string, SyncMeta> = {};
    for (const [path, meta] of Object.entries(remoteSyncMetas)) {
        resultMetas[path] = {
            protocolVersion: 1,
            clock: { ...meta.clock },
            fields: { ...meta.fields }
        };
    }

    for (const [path] of base.entries()) {
        if (!resultMetas[path]) resultMetas[path] = { protocolVersion: 1, clock: {}, fields: {} };
    }
    for (const op of ops) {
        if (!resultMetas[op.docPath]) resultMetas[op.docPath] = { protocolVersion: 1, clock: {}, fields: {} };
    }

    const grouped = new Map<string, SemanticOperation[]>();
    for (const op of ops) {
        const key = `${op.docPath}:${fieldKey(op.path)}`;
        const existing = grouped.get(key) || [];
        existing.push(op);
        grouped.set(key, existing);
    }

    const groupedEntries = Array.from(grouped.entries()).sort((a, b) => a[1][0].path.length - b[1][0].path.length);
    const ordersToApply = new Map<any[], { path: string[], orderIds: string[] }>();

    for (const [, opList] of groupedEntries) {
        let winner = opList[0];
        for (let i = 1; i < opList.length; i++) {
            if (stampWins(opList[i], winner)) winner = opList[i];
        }

        // The winner decides the value, but every contender is causally observed.
        // Without this join, the same operations delivered in one batch vs multiple
        // batches produce different FieldStamp clocks and can diverge on later retries.
        const observedGroupClock = mergeVectors(...opList.map(operation => operation.clock));
        const fk = fieldKey(winner.path);
        const meta = resultMetas[winner.docPath];
        const remoteStamp = meta.fields[fk];

        const localStampLike: StampLike = {
            clock: winner.clock,
            isDelete: winner.isDelete,
            actorId: winner.actorId,
            seq: winner.seq
        };

        let jointClock = observedGroupClock;

        if (remoteStamp) {
            const remoteStampLike: StampLike = {
                clock: remoteStamp.clock,
                isDelete: remoteStamp.deleted,
                actorId: remoteStamp.actorId,
                seq: remoteStamp.seq
            };
            if (!stampWins(localStampLike, remoteStampLike)) {
                const observedClock = mergeVectors(remoteStamp.clock, observedGroupClock);
                meta.fields[fk] = {
                    ...remoteStamp,
                    clock: observedClock
                };
                meta.clock = mergeVectors(meta.clock, observedClock);
                continue;
            }
            jointClock = mergeVectors(remoteStamp.clock, observedGroupClock);
        }

        let blockedByAncestor = false;
        for (let i = 1; i < winner.path.length; i++) {
            const ancKey = fieldKey(winner.path.slice(0, i));
            const ancStamp = meta.fields[ancKey];
            if (ancStamp) {
                const ancLike: StampLike = {
                    clock: ancStamp.clock,
                    isDelete: ancStamp.deleted,
                    actorId: ancStamp.actorId,
                    seq: ancStamp.seq
                };
                if (stampWins(ancLike, localStampLike)) {
                    blockedByAncestor = true;
                    jointClock = mergeVectors(jointClock, ancStamp.clock);
                    break;
                }
            }
        }

        if (blockedByAncestor) {
            meta.clock = mergeVectors(meta.clock, jointClock);
            continue;
        }

        const doc = resultDocs.get(winner.docPath) || {};

        if (winner.guard) {
            let guardPass = true;
            let target: any = doc;
            for (const p of winner.guard.path) {
                if (!target) { guardPass = false; break; }
                target = target[p];
            }
            if (!guardPass || target !== winner.guard.equals) {
                // The operation belongs to another lifecycle. Observe its causal clock,
                // but do not let a stale session become the stamp of the current field.
                meta.clock = mergeVectors(meta.clock, jointClock);
                continue;
            }
        }

        const p = winner.path;
        const isOrderPayload = p[p.length - 1] === '$order';

        let current: any = doc;
        let parentIsArray = false;
        let arrRef: any[] = [];
        let itemIndex = -1;

        for (let i = 0; i < p.length - 1; i++) {
            const currentPath = p.slice(0, i + 1);
            const pol = getMergePolicy(winner.docPath, currentPath);

            if (pol === 'keyed' || pol === 'ordered-keyed') {
                if (!Array.isArray(current[p[i]])) current[p[i]] = [];
                const arr = current[p[i]] as any[];
                const itemId = p[i + 1];

                if (i + 1 === p.length - 1) {
                    if (isOrderPayload) {
                        ordersToApply.set(arr, { path: currentPath, orderIds: winner.value as string[] });
                        parentIsArray = false;
                        break;
                    }
                    parentIsArray = true;
                    arrRef = arr;
                    itemIndex = arr.findIndex((x: any) => resolveIdentity(currentPath, x) === String(itemId));
                    break;
                } else {
                    let idx = arr.findIndex((x: any) => resolveIdentity(currentPath, x) === String(itemId));
                    if (idx < 0) {
                        arr.push(identitySeed(currentPath, itemId));
                        idx = arr.length - 1;
                    }
                    current = arr[idx];
                    i++;
                }
            } else {
                if (current[p[i]] === undefined) current[p[i]] = {};
                current = current[p[i]];
            }
        }

        const lastSeg = p[p.length - 1];

        if (isOrderPayload) {
            // Applied after all entity operations.
        } else if (parentIsArray) {
            if (winner.isDelete) {
                if (itemIndex >= 0) arrRef.splice(itemIndex, 1);
            } else if (itemIndex >= 0) {
                if (typeof winner.value === 'object' && winner.value !== null) arrRef[itemIndex] = { ...arrRef[itemIndex], ...winner.value };
                else arrRef[itemIndex] = winner.value;
            } else {
                arrRef.push(winner.value);
            }
        } else if (winner.isDelete) {
            delete current[lastSeg];
        } else {
            current[lastSeg] = winner.value;
        }

        resultDocs.set(winner.docPath, doc);

        meta.fields[fk] = {
            clock: jointClock,
            actorId: winner.actorId,
            seq: winner.seq,
            ...(winner.isDelete ? { deleted: true } : {})
        };
        meta.clock = mergeVectors(meta.clock, jointClock);
    }

    for (const [arr, { path, orderIds }] of ordersToApply.entries()) {
        const entities = new Map<string, any>();
        for (const item of arr) entities.set(resolveIdentity(path, item), item);

        const winnerOrder = orderIds.filter(id => entities.has(id));
        const missing = [...entities.keys()].filter(id => !winnerOrder.includes(id)).sort();
        const finalOrder = [...winnerOrder, ...missing];

        arr.length = 0;
        for (const id of finalOrder) arr.push(entities.get(id));
    }

    normalizeDomainData(resultDocs);
    return { documents: resultDocs, syncMetas: resultMetas };
}
