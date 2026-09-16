import type { DocumentData } from '../documentProjection';
import { calculateLoggedMealTotals } from '../../nutrition/calculateLoggedMealTotals';
import type { SemanticOperation, StampLike, SyncMeta } from './contracts';
import { fieldKey, mergeVectors, stampWins } from './metadata';
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

        const localStampLike: StampLike = {
            clock: winner.clock,
            isDelete: winner.isDelete,
            actorId: winner.actorId,
            seq: winner.seq
        };

        let jointClock = observedGroupClock;
        let blockedByAncestor = false;

        // Ancestors are the canonical reconciliation boundary for hierarchical paths.
        // Always observe every ancestor clock before consulting the same-field stamp.
        // This makes a deleted ancestor a safe causal summary for descendants that it
        // already covers, which is required for lossless subtree metadata compaction.
        for (let i = 1; i < winner.path.length; i++) {
            const ancKey = fieldKey(winner.path.slice(0, i));
            const ancStamp = meta.fields[ancKey];
            if (!ancStamp) continue;

            jointClock = mergeVectors(jointClock, ancStamp.clock);
            const ancLike: StampLike = {
                clock: ancStamp.clock,
                isDelete: ancStamp.deleted,
                actorId: ancStamp.actorId,
                seq: ancStamp.seq
            };

            if (stampWins(ancLike, localStampLike)) {
                blockedByAncestor = true;
                // The blocking ancestor has observed this contender. Keep its winner
                // identity, but retain the joined causal context for future retries.
                meta.fields[ancKey] = {
                    ...ancStamp,
                    clock: jointClock
                };
                break;
            }
        }

        if (blockedByAncestor) {
            meta.clock = mergeVectors(meta.clock, jointClock);
            continue;
        }

        const remoteStamp = meta.fields[fk];
        if (remoteStamp) {
            const remoteStampLike: StampLike = {
                clock: remoteStamp.clock,
                isDelete: remoteStamp.deleted,
                actorId: remoteStamp.actorId,
                seq: remoteStamp.seq
            };
            if (!stampWins(localStampLike, remoteStampLike)) {
                const observedClock = mergeVectors(remoteStamp.clock, jointClock);
                meta.fields[fk] = {
                    ...remoteStamp,
                    clock: observedClock
                };
                meta.clock = mergeVectors(meta.clock, observedClock);
                continue;
            }
            jointClock = mergeVectors(remoteStamp.clock, jointClock);
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
