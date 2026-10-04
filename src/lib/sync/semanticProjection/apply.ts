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

type UpdateCandidate = {
    stamp: StampLike;
    value: unknown;
    legacyClock?: VectorClock;
    guard?: SemanticOperation['guard'];
    operation?: SemanticOperation;
    source: 'visible' | 'hidden' | 'new';
};

type DeleteCandidate = {
    stamp: StampLike;
    legacyClock?: VectorClock;
    guard?: SemanticOperation['guard'];
    operation?: SemanticOperation;
    remote: boolean;
};

function operationDot(operation: SemanticOperation): VectorClock {
    return { [operation.actorId]: operation.seq };
}

function legacyResolvedLoser(stamp: FieldStamp | undefined, operation: SemanticOperation): boolean {
    if (!stamp) return false;
    const dot = operationDot(operation);
    const legacyWinners = [
        ...(stamp.legacyClock ? [{ clock: stamp.clock, legacyClock: stamp.legacyClock }] : []),
        ...(stamp.candidates ?? [])
            .filter(candidate => candidate.legacyClock)
            .map(candidate => ({ clock: candidate.clock, legacyClock: candidate.legacyClock! })),
    ];
    return legacyWinners.some(candidate =>
        coversVectorClock(candidate.legacyClock, dot)
        && !coversVectorClock(operation.clock, candidate.clock));
}

function maxCandidate<T extends { stamp: StampLike }>(candidates: T[]): T {
    let winner = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        if (compareStamps(candidates[i].stamp, winner.stamp) > 0) winner = candidates[i];
    }
    return winner;
}

function candidateGuardMatches(doc: DocumentData, guard: SemanticOperation['guard'] | undefined): boolean {
    if (!guard) return true;
    let target: any = doc;
    for (const segment of guard.path) {
        if (target === null || target === undefined) return false;
        target = target[segment];
    }
    return target === guard.equals;
}

function normalizeUpdateCandidates(
    candidates: UpdateCandidate[],
    barrier: VectorClock | undefined,
    doc: DocumentData,
): UpdateCandidate[] {
    const byDot = new Map<string, UpdateCandidate>();
    for (const candidate of candidates) {
        if (barrier && !coversVectorClock(candidate.stamp.clock, barrier)) continue;
        if (!candidateGuardMatches(doc, candidate.guard)) continue;
        const key = `${candidate.stamp.actorId}:${candidate.stamp.seq}`;
        const existing = byDot.get(key);
        if (!existing || candidate.source === 'visible' || (existing.source === 'hidden' && candidate.source === 'new')) {
            byDot.set(key, candidate);
        }
    }

    const unique = [...byDot.values()];
    return unique.filter((candidate, index) =>
        !unique.some((other, otherIndex) =>
            index !== otherIndex && coversVectorClock(other.stamp.clock, candidate.stamp.clock)
            && !coversVectorClock(candidate.stamp.clock, other.stamp.clock)));
}

function persistHiddenCandidates(candidates: UpdateCandidate[], winner: UpdateCandidate) {
    return candidates
        .filter(candidate => candidate !== winner)
        .sort((left, right) =>
            left.stamp.actorId.localeCompare(right.stamp.actorId) || left.stamp.seq - right.stamp.seq)
        .map(candidate => ({
            clock: { ...candidate.stamp.clock },
            actorId: candidate.stamp.actorId,
            seq: candidate.stamp.seq,
            value: structuredClone(candidate.value),
            ...(candidate.legacyClock ? { legacyClock: { ...candidate.legacyClock } } : {}),
            ...(candidate.guard ? { guard: structuredClone(candidate.guard) } : {}),
        }));
}

function canonicalStamp(stamp: FieldStamp): FieldStamp {
    const barrier = deleteBarrier(stamp);
    return {
        clock: { ...stamp.clock },
        actorId: stamp.actorId,
        seq: stamp.seq,
        ...(stamp.deleted ? { deleted: true } : {}),
        ...(barrier ? { deleteClock: { ...barrier } } : {}),
        ...(stamp.legacyClock ? { legacyClock: { ...stamp.legacyClock } } : {}),
        ...(stamp.guard ? { guard: structuredClone(stamp.guard) } : {}),
        ...(stamp.candidates?.length ? {
            candidates: stamp.candidates.map(candidate => ({
                clock: { ...candidate.clock },
                actorId: candidate.actorId,
                seq: candidate.seq,
                value: structuredClone(candidate.value),
                ...(candidate.legacyClock ? { legacyClock: { ...candidate.legacyClock } } : {}),
                ...(candidate.guard ? { guard: structuredClone(candidate.guard) } : {}),
            })),
        } : {}),
    };
}

type CapturedDescendant = {
    key: string;
    path: string[];
    stamp: FieldStamp;
    visibleValue?: unknown;
};

type ProtectedDescendant = {
    key: string;
    path: string[];
    stamp: FieldStamp;
    value?: unknown;
};

function captureDescendant(doc: DocumentData, docPath: string, key: string, stamp: FieldStamp): CapturedDescendant {
    const path = pathFromFieldKey(key);
    return {
        key,
        path,
        stamp: canonicalStamp(stamp),
        ...(stamp.deleted ? {} : { visibleValue: structuredClone(readSemanticValue(doc, docPath, path)) }),
    };
}

function reconcileCapturedDescendant(
    captured: CapturedDescendant,
    ancestor: FieldStamp,
    doc: DocumentData,
): ProtectedDescendant | undefined {
    const required = requiredAncestorClock(ancestor);
    const stamp = captured.stamp;

    if (stamp.deleted) {
        if (!coversVectorClock(stamp.clock, required) || !candidateGuardMatches(doc, stamp.guard)) return undefined;
        return { key: captured.key, path: captured.path, stamp: canonicalStamp(stamp) };
    }

    const candidates: UpdateCandidate[] = [{
        stamp: fieldStamp(stamp),
        value: structuredClone(captured.visibleValue),
        legacyClock: stamp.legacyClock ? { ...stamp.legacyClock } : undefined,
        guard: stamp.guard ? structuredClone(stamp.guard) : undefined,
        source: 'visible',
    }];
    for (const candidate of stamp.candidates ?? []) {
        candidates.push({
            stamp: {
                clock: candidate.clock,
                isDelete: false,
                actorId: candidate.actorId,
                seq: candidate.seq,
            },
            value: structuredClone(candidate.value),
            legacyClock: candidate.legacyClock ? { ...candidate.legacyClock } : undefined,
            guard: candidate.guard ? structuredClone(candidate.guard) : undefined,
            source: 'hidden',
        });
    }

    const descendantBarrier = deleteBarrier(stamp);
    const requiredBarrier = descendantBarrier
        ? mergeVectors(descendantBarrier, required)
        : required;
    const survivors = normalizeUpdateCandidates(candidates, requiredBarrier, doc);
    if (!survivors.length) return undefined;

    const selected = maxCandidate(survivors);
    const hidden = persistHiddenCandidates(survivors, selected);
    const nextStamp: FieldStamp = {
        clock: { ...selected.stamp.clock },
        actorId: selected.stamp.actorId,
        seq: selected.stamp.seq,
        ...(descendantBarrier ? { deleteClock: { ...descendantBarrier } } : {}),
        ...(selected.legacyClock ? { legacyClock: { ...selected.legacyClock } } : {}),
        ...(selected.guard ? { guard: structuredClone(selected.guard) } : {}),
        ...(hidden.length ? { candidates: hidden } : {}),
    };
    return {
        key: captured.key,
        path: captured.path,
        stamp: nextStamp,
        value: structuredClone(selected.value),
    };
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
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { ...meta.clock },
            fields: Object.fromEntries(Object.entries(meta.fields).map(([key, stamp]) => [
                key,
                canonicalStamp(stamp),
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

        // Every delivered event advances the document frontier. Guard/ancestor
        // rejection never mutates the winning field timestamp.
        meta.clock = mergeVectors(meta.clock, ...opList.map(operation => operation.clock));

        const eligible = opList.filter(operation =>
            guardMatches(doc, operation) && !blockedByAncestor(meta, operation));

        if (!eligible.length) {
            resultDocs.set(docPath, doc);
            continue;
        }

        const fk = fieldKey(opList[0].path);
        const remoteStamp = meta.fields[fk];
        const deleteOperations = eligible.filter(operation =>
            operation.isDelete && !legacyResolvedLoser(remoteStamp, operation));

        // A delete barrier is monotone and survives later recreation. Any update
        // that has not observed every delete remains permanently stale for this field.
        let barrier = deleteBarrier(remoteStamp);
        if (deleteOperations.length) {
            barrier = mergeVectors(barrier ?? {}, ...deleteOperations.map(operationDot));
        }

        const rawUpdateCandidates: UpdateCandidate[] = [];
        if (remoteStamp && !remoteStamp.deleted) {
            rawUpdateCandidates.push({
                stamp: fieldStamp(remoteStamp),
                value: structuredClone(readSemanticValue(doc, docPath, opList[0].path)),
                legacyClock: remoteStamp.legacyClock ? { ...remoteStamp.legacyClock } : undefined,
                guard: remoteStamp.guard ? structuredClone(remoteStamp.guard) : undefined,
                source: 'visible',
            });
            for (const candidate of remoteStamp.candidates ?? []) {
                rawUpdateCandidates.push({
                    stamp: {
                        clock: candidate.clock,
                        isDelete: false,
                        actorId: candidate.actorId,
                        seq: candidate.seq,
                    },
                    value: structuredClone(candidate.value),
                    legacyClock: candidate.legacyClock ? { ...candidate.legacyClock } : undefined,
                    guard: candidate.guard ? structuredClone(candidate.guard) : undefined,
                    source: 'hidden',
                });
            }
        }
        for (const operation of eligible) {
            if (operation.isDelete || legacyResolvedLoser(remoteStamp, operation)) continue;
            rawUpdateCandidates.push({
                stamp: operationStamp(operation),
                value: structuredClone(operation.value),
                guard: operation.guard ? structuredClone(operation.guard) : undefined,
                operation,
                source: 'new',
            });
        }

        const updateCandidates = normalizeUpdateCandidates(rawUpdateCandidates, barrier, doc);
        let selectedStamp: StampLike;
        let selectedLegacyClock: VectorClock | undefined;
        let selectedGuard: SemanticOperation['guard'] | undefined;
        let selectedOperation: SemanticOperation | undefined;
        let hiddenCandidates: ReturnType<typeof persistHiddenCandidates> = [];

        if (updateCandidates.length) {
            const selected = maxCandidate(updateCandidates);
            selectedStamp = selected.stamp;
            selectedLegacyClock = selected.legacyClock ? { ...selected.legacyClock } : undefined;
            selectedGuard = selected.guard ? structuredClone(selected.guard) : undefined;
            hiddenCandidates = persistHiddenCandidates(updateCandidates, selected);
            if (selected.source === 'new') {
                selectedOperation = selected.operation;
            } else if (selected.source === 'hidden') {
                selectedOperation = {
                    docPath,
                    path: [...opList[0].path],
                    value: structuredClone(selected.value),
                    isDelete: false,
                    actorId: selected.stamp.actorId,
                    seq: selected.stamp.seq,
                    clock: { ...selected.stamp.clock },
                    ...(selected.guard ? { guard: structuredClone(selected.guard) } : {}),
                };
            }
        } else {
            const deleteCandidates: DeleteCandidate[] = [];
            if (remoteStamp?.deleted) {
                deleteCandidates.push({
                    stamp: fieldStamp(remoteStamp),
                    legacyClock: remoteStamp.legacyClock ? { ...remoteStamp.legacyClock } : undefined,
                    guard: remoteStamp.guard ? structuredClone(remoteStamp.guard) : undefined,
                    remote: true,
                });
            }
            for (const operation of deleteOperations) {
                deleteCandidates.push({
                    stamp: operationStamp(operation),
                    guard: operation.guard ? structuredClone(operation.guard) : undefined,
                    operation,
                    remote: false,
                });
            }
            if (!deleteCandidates.length) {
                resultDocs.set(docPath, doc);
                continue;
            }
            const selected = maxCandidate(deleteCandidates);
            selectedStamp = selected.stamp;
            selectedLegacyClock = selected.legacyClock ? { ...selected.legacyClock } : undefined;
            selectedGuard = selected.guard ? structuredClone(selected.guard) : undefined;
            selectedOperation = selected.operation;
        }

        const nextStamp: FieldStamp = {
            clock: { ...selectedStamp.clock },
            actorId: selectedStamp.actorId,
            seq: selectedStamp.seq,
            ...(selectedStamp.isDelete ? { deleted: true } : {}),
            ...(barrier ? { deleteClock: { ...barrier } } : {}),
            ...(selectedLegacyClock ? { legacyClock: selectedLegacyClock } : {}),
            ...(selectedGuard ? { guard: selectedGuard } : {}),
            ...(hiddenCandidates.length ? { candidates: hiddenCandidates } : {}),
        };

        if (!nextStamp.deleted && nextStamp.deleteClock && !coversVectorClock(nextStamp.clock, nextStamp.deleteClock)) {
            throw new Error('Visible causal winner does not cover delete barrier');
        }

        let protectedDescendants: ProtectedDescendant[] = [];
        if (selectedOperation) {
            const prefix = `${fk}/`;
            const capturedDescendants = Object.entries(meta.fields)
                .filter(([key]) => key.startsWith(prefix))
                .map(([key, stamp]) => captureDescendant(doc, docPath, key, stamp));

            applyWinnerToDocument(doc, selectedOperation, ordersToApply);

            protectedDescendants = capturedDescendants
                .map(captured => reconcileCapturedDescendant(captured, nextStamp, doc))
                .filter((item): item is ProtectedDescendant => item !== undefined);

            for (const [key] of Object.entries(meta.fields)) {
                if (key.startsWith(prefix)) delete meta.fields[key];
            }
            for (const item of protectedDescendants) meta.fields[item.key] = item.stamp;
        }

        meta.fields[fk] = nextStamp;

        if (selectedOperation) {
            protectedDescendants
                .sort((left, right) => left.path.length - right.path.length || left.key.localeCompare(right.key))
                .forEach(item => applyWinnerToDocument(doc, {
                    docPath,
                    path: item.path,
                    isDelete: item.stamp.deleted === true,
                    ...(item.stamp.deleted ? {} : { value: item.value }),
                    actorId: item.stamp.actorId,
                    seq: item.stamp.seq,
                    clock: item.stamp.clock,
                    ...(item.stamp.guard ? { guard: structuredClone(item.stamp.guard) } : {}),
                }, ordersToApply));
        }

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
