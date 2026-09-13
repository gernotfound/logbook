import equal from 'fast-deep-equal';
import { type DocumentData } from './documentProjection';

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

export interface SemanticOperation {
    docPath: string;
    path: string[];
    isDelete: boolean;
    value?: unknown;
    actorId: string;
    seq: number;
    clock: VectorClock;
}

export function fieldKey(path: string[]): string {
    return path.map(p => encodeURIComponent(String(p))).join('/');
}

export function getMergePolicy(docPath: string, path: string[]): MergePolicy {
    if (docPath === '') {
        const root = path[0];
        if (root === 'profile') return 'property';
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
        if (path.length === 1) return 'property'; // day properties
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
                if (path.length === 4) return 'keyed'; // or ordered-keyed
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
    if (collection === 'exercises') return String(item.exId ?? item.id);
    if (path[0] === 'trainingCycles' && collection === 'routines') return String(item.routineId);
    return String(item.id ?? item.exId ?? item.routineId);
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
        if (bVal === undefined || dVal === undefined || typeof bVal !== 'object' || typeof dVal !== 'object' || bVal === null || dVal === null || Array.isArray(bVal) || Array.isArray(dVal)) {
            // fallback to atomic if not objects
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
            if (bVal.id !== dVal.id) {
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
        }

        const allKeys = new Set([...Object.keys(bVal), ...Object.keys(dVal)]);
        for (const k of allKeys) {
            traverseAndDiff(docPath, [...currentPath, k], bVal[k], dVal[k], actorId, seq, clock, ops);
        }
    } else if (policy === 'keyed' || policy === 'ordered-keyed') {
        const bArr = Array.isArray(bVal) ? bVal : [];
        const dArr = Array.isArray(dVal) ? dVal : [];
        const bMap = new Map(bArr.map((item: any) => [resolveIdentity(currentPath, item), item]));
        const dMap = new Map(dArr.map((item: any, idx: number) => [resolveIdentity(currentPath, item), policy === 'ordered-keyed' ? { ...item, $order: idx } : item]));
        
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
                    // Both exist, they are objects, we can diff their properties
                    traverseAndDiff(docPath, [...currentPath, id], bItem, dItem, actorId, seq, clock, ops);
                }
            }
        }
    }
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
            // Note: we start at path length 1
            traverseAndDiff(docPath, [prop], bDoc[prop], dDoc[prop], actorId, seq, clock, ops);
        }
    }
    return ops;
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
    // Post-merge normalization (e.g. recalculating nutrition macros)
    for (const [path, doc] of docs.entries()) {
        if (path.startsWith('nutrition_months/')) {
            for (const [, dayData] of Object.entries(doc)) {
                if (dayData && typeof dayData === 'object' && Array.isArray((dayData as any).meals)) {
                    const meals = (dayData as any).meals;
                    let kcal = 0, carbs = 0, pro = 0, fat = 0;
                    for (const m of meals) {
                        kcal += Number(m.kcal) || 0;
                        carbs += Number(m.carbs) || 0;
                        pro += Number(m.pro) || 0;
                        fat += Number(m.fat) || 0;
                    }
                    (dayData as any).kcal = Math.round(kcal);
                    (dayData as any).carbs = Math.round(carbs);
                    (dayData as any).pro = Math.round(pro);
                    (dayData as any).fat = Math.round(fat);
                }
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
    for (const [path, doc] of base.entries()) {
        // Deep clone to avoid mutating base
        resultDocs.set(path, JSON.parse(JSON.stringify(doc)));
    }

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

    const groupedEntries = Array.from(grouped.entries()).sort((a, b) => {
        const pathLenA = a[1][0].path.length;
        const pathLenB = b[1][0].path.length;
        return pathLenA - pathLenB;
    });

    for (const [, opList] of groupedEntries) {
        let winner = opList[0];
        for (let i = 1; i < opList.length; i++) {
            if (stampWins(opList[i], winner)) winner = opList[i];
        }

        const fk = fieldKey(winner.path);
        const meta = resultMetas[winner.docPath];
        const remoteStamp = meta.fields[fk];

        const localStampLike: StampLike = {
            clock: winner.clock,
            isDelete: winner.isDelete,
            actorId: winner.actorId,
            seq: winner.seq
        };

        let jointClock = winner.clock;

        if (remoteStamp) {
            const remoteStampLike: StampLike = {
                clock: remoteStamp.clock,
                isDelete: remoteStamp.deleted,
                actorId: remoteStamp.actorId,
                seq: remoteStamp.seq
            };
            if (!stampWins(localStampLike, remoteStampLike)) {
                // Remote wins. But we still need to join clocks in the meta!
                meta.fields[fk] = {
                    ...remoteStamp,
                    clock: mergeVectors(remoteStamp.clock, winner.clock)
                };
                meta.clock = mergeVectors(meta.clock, winner.clock);
                continue;
            }
            jointClock = mergeVectors(remoteStamp.clock, winner.clock);
        }

        // Ancestor causal barrier
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
        
        // Navigation array
        const p = winner.path;
        
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
                let idx = arr.findIndex((x: any) => resolveIdentity(currentPath, x) === String(itemId));
                
                if (i + 1 === p.length - 1) {
                    parentIsArray = true;
                    arrRef = arr;
                    itemIndex = idx;
                    break;
                } else {
                    if (idx < 0) {
                        arr.push(identitySeed(currentPath, itemId));
                        idx = arr.length - 1;
                    }
                    current = arr[idx];
                    i++; // skip itemId
                }
            } else {
                if (current[p[i]] === undefined) current[p[i]] = {};
                current = current[p[i]];
            }
        }

        const lastSeg = p[p.length - 1];
        
        if (parentIsArray) {
            if (winner.isDelete) {
                if (itemIndex >= 0) arrRef.splice(itemIndex, 1);
            } else {
                if (itemIndex >= 0) {
                    if (typeof winner.value === 'object' && winner.value !== null) {
                        arrRef[itemIndex] = { ...arrRef[itemIndex], ...winner.value };
                    } else {
                        arrRef[itemIndex] = winner.value;
                    }
                } else {
                    arrRef.push(winner.value);
                }
            }
            const parentPolicy = getMergePolicy(winner.docPath, p.slice(0, -1));
            if (parentPolicy === 'ordered-keyed') {
                arrRef.sort((a: any, b: any) => (a.$order || 0) - (b.$order || 0));
                for(const item of arrRef) delete item.$order;
            }
        } else {
            if (winner.isDelete) {
                delete current[lastSeg];
            } else {
                current[lastSeg] = winner.value;
            }
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
    
    normalizeDomainData(resultDocs);

    return { documents: resultDocs, syncMetas: resultMetas };
}
