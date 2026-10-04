import { CURRENT_SYNC_PROTOCOL } from '../../schemaEvolution';
import type { DocumentData } from '../documentProjection';
import { calculateLoggedMealTotals } from '../../nutrition/calculateLoggedMealTotals';
import type { FieldStamp, SemanticOperation, StampLike, SyncMeta, VectorClock } from './contracts';
import { compareStamps, coversVectorClock, fieldKey, mergeVectors, pathFromFieldKey } from './metadata';
import { getMergePolicy, identitySeed, resolveIdentity } from './policy';

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

function operationStamp(operation: SemanticOperation): StampLike {
    return {
        clock: operation.clock,
        isDelete: operation.isDelete,
        actorId: operation.actorId,
        seq: operation.seq,
    };
}

function fieldStamp(stamp: FieldStamp): StampLike {
    return {
        clock: stamp.clock,
        isDelete: stamp.deleted,
        actorId: stamp.actorId,
        seq: stamp.seq,
    };
}

function guardMatches(doc: DocumentData, operation: SemanticOperation): boolean {
    if (!operation.guard) return true;
    let target: any = doc;
    for (const segment of operation.guard.path) {
        if (target === null || target === undefined) return false;
        target = target[segment];
    }
    return target === operation.guard.equals;
}

function deleteBarrier(stamp: FieldStamp | undefined): VectorClock | undefined {
    if (!stamp) return undefined;
    if (stamp.deleteClock) return stamp.deleteClock;
    return stamp.deleted ? stamp.clock : undefined;
}

function requiredAncestorClock(stamp: FieldStamp): VectorClock {
    const barrier = deleteBarrier(stamp);
    return barrier ? mergeVectors(stamp.clock, barrier) : stamp.clock;
}

function blockedByAncestor(meta: SyncMeta, operation: SemanticOperation): boolean {
    for (let i = 1; i < operation.path.length; i++) {
        const ancestor = meta.fields[fieldKey(operation.path.slice(0, i))];
        if (!ancestor) continue;
        if (!coversVectorClock(operation.clock, requiredAncestorClock(ancestor))) return true;
    }
    return false;
}

function readSemanticValue(doc: DocumentData, docPath: string, path: string[]): unknown {
    if (!path.length) return undefined;
    if (path[path.length - 1] === '$order') {
        const collection = readSemanticValue(doc, docPath, path.slice(0, -1));
        if (!Array.isArray(collection)) return [];
        return collection.map(item => resolveIdentity(path.slice(0, -1), item));
    }

    let current: any = doc;
    for (let i = 0; i < path.length; i++) {
        if (current === null || current === undefined) return undefined;
        const currentPath = path.slice(0, i + 1);
        const policy = getMergePolicy(docPath, currentPath);

        if (policy === 'keyed' || policy === 'ordered-keyed') {
            const arr = current[path[i]];
            if (!Array.isArray(arr)) return undefined;
            if (i + 1 >= path.length) return arr;
            const itemId = path[i + 1];
            const item = arr.find((value: any) => resolveIdentity(currentPath, value) === String(itemId));
            if (item === undefined) return undefined;
            if (i + 1 === path.length - 1) return item;
            current = item;
            i++;
        } else {
            if (i === path.length - 1) return current[path[i]];
            current = current[path[i]];
        }
    }
    return current;
}

function applyWinnerToDocument(
    doc: DocumentData,
    operation: SemanticOperation,
    ordersToApply: Map<any[], { path: string[], orderIds: string[] }>,
): void {
    const p = operation.path;
    const isOrderPayload = p[p.length - 1] === '$order';

    let current: any = doc;
    let parentIsArray = false;
    let arrRef: any[] = [];
    let itemIndex = -1;

    for (let i = 0; i < p.length - 1; i++) {
        const currentPath = p.slice(0, i + 1);
        const pol = getMergePolicy(operation.docPath, currentPath);

        if (pol === 'keyed' || pol === 'ordered-keyed') {
            if (!Array.isArray(current[p[i]])) current[p[i]] = [];
            const arr = current[p[i]] as any[];
            const itemId = p[i + 1];

            if (i + 1 === p.length - 1) {
                if (isOrderPayload) {
                    ordersToApply.set(arr, { path: currentPath, orderIds: operation.value as string[] });
                    parentIsArray = false;
                    break;
                }
                parentIsArray = true;
                arrRef = arr;
                itemIndex = arr.findIndex((x: any) => resolveIdentity(currentPath, x) === String(itemId));
                break;
            }

            let idx = arr.findIndex((x: any) => resolveIdentity(currentPath, x) === String(itemId));
            if (idx < 0) {
                arr.push(identitySeed(currentPath, itemId));
                idx = arr.length - 1;
            }
            current = arr[idx];
            i++;
        } else {
            if (current[p[i]] === undefined || current[p[i]] === null) current[p[i]] = {};
            current = current[p[i]];
        }
    }

    const lastSeg = p[p.length - 1];
    if (isOrderPayload) {
        return;
    }
    if (parentIsArray) {
        if (operation.isDelete) {
            if (itemIndex >= 0) arrRef.splice(itemIndex, 1);
        } else if (itemIndex >= 0) {
            if (typeof operation.value === 'object' && operation.value !== null) arrRef[itemIndex] = { ...arrRef[itemIndex], ...operation.value };
            else arrRef[itemIndex] = operation.value;
        } else {
            arrRef.push(operation.value);
        }
        return;
    }
    if (operation.isDelete) delete current[lastSeg];
    else current[lastSeg] = operation.value;
}

type ProtectedDescendant = {
    key: string;
    path: string[];
    stamp: FieldStamp;
    value?: unknown;
};

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
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { ...meta.clock },
            fields: Object.fromEntries(Object.entries(meta.fields).map(([key, stamp]) => [
                key,
                { ...stamp, clock: { ...stamp.clock } },
            ])),
        };
    }

    for (const [path] of base.entries()) {
        if (!resultMetas[path]) resultMetas[path] = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} };
    }
    for (const op of ops) {
        if (!resultMetas[op.docPath]) resultMetas[op.docPath] = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} };
    }

    const grouped = new Map<string, SemanticOperation[]>();
    for (const op of ops) {
        const key = `${op.docPath}:${fieldKey(op.path)}`;
        const existing = grouped.get(key) || [];
        existing.push(op);
        grouped.set(key, existing);
    }

    const groupedEntries = Array.from(grouped.entries()).sort((a, b) =>
        a[1][0].path.length - b[1][0].path.length || a[0].localeCompare(b[0]));
    const ordersToApply = new Map<any[], { path: string[], orderIds: string[] }>();

    for (const [, opList] of groupedEntries) {
        const docPath = opList[0].docPath;
        const meta = resultMetas[docPath];
        const doc = resultDocs.get(docPath) || {};

        // Every delivered event advances only the document frontier. Field stamps
        // remain immutable timestamps of the actual winning event in protocol 2.
        meta.clock = mergeVectors(meta.clock, ...opList.map(operation => operation.clock));

        const eligible = opList.filter(operation =>
            guardMatches(doc, operation) && !blockedByAncestor(meta, operation));

        if (!eligible.length) {
            resultDocs.set(docPath, doc);
            continue;
        }

        let winner = eligible[0];
        for (let i = 1; i < eligible.length; i++) {
            if (compareStamps(operationStamp(eligible[i]), operationStamp(winner)) > 0) winner = eligible[i];
        }

        const fk = fieldKey(winner.path);
        const remoteStamp = meta.fields[fk];
        if (remoteStamp && !stampWins(operationStamp(winner), fieldStamp(remoteStamp))) {
            resultDocs.set(docPath, doc);
            continue;
        }

        const nextStamp: FieldStamp = {
            clock: { ...winner.clock },
            actorId: winner.actorId,
            seq: winner.seq,
            ...(winner.isDelete ? { deleted: true } : {}),
        };

        // Preserve descendants whose own total causal timestamp outranks an
        // ancestor write. Lower-ranked descendants are semantically shadowed and
        // their stamps are removed, so parent-before-child and child-before-parent
        // delivery converge to the same business and causal state.
        const protectedBefore = Object.entries(meta.fields)
            .filter(([key, stamp]) => key.startsWith(`${fk}/`) && stampWins(fieldStamp(stamp), fieldStamp(nextStamp)))
            .map(([key]) => key);

        const preservedValues = new Map<string, unknown>();
        for (const key of protectedBefore) {
            const stamp = meta.fields[key];
            if (!stamp.deleted) {
                const path = pathFromFieldKey(key);
                preservedValues.set(key, structuredClone(readSemanticValue(doc, winner.docPath, path)));
            }
        }

        applyWinnerToDocument(doc, winner, ordersToApply);
        meta.fields[fk] = nextStamp;

        const prefix = `${fk}/`;
        const protectedDescendants: ProtectedDescendant[] = [];
        for (const [key, stamp] of Object.entries(meta.fields)) {
            if (!key.startsWith(prefix)) continue;
            if (stampWins(fieldStamp(stamp), fieldStamp(nextStamp))) {
                protectedDescendants.push({
                    key,
                    path: pathFromFieldKey(key),
                    stamp,
                    ...(stamp.deleted ? {} : {
                        value: preservedValues.has(key)
                            ? preservedValues.get(key)
                            : structuredClone(readSemanticValue(doc, winner.docPath, pathFromFieldKey(key))),
                    }),
                });
            }
        }
        for (const [key] of Object.entries(meta.fields)) {
            if (key.startsWith(prefix) && !protectedDescendants.some(item => item.key === key)) delete meta.fields[key];
        }
        protectedDescendants
            .sort((left, right) => left.path.length - right.path.length || left.key.localeCompare(right.key))
            .forEach(item => applyWinnerToDocument(doc, {
                docPath: winner.docPath,
                path: item.path,
                isDelete: item.stamp.deleted === true,
                ...(item.stamp.deleted ? {} : { value: item.value }),
                actorId: item.stamp.actorId,
                seq: item.stamp.seq,
                clock: item.stamp.clock,
            }, ordersToApply));

        resultDocs.set(docPath, doc);
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
