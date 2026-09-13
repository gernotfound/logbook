import equal from 'fast-deep-equal';
// import { UserDataSchema } from '../schema';
// import type { UserData } from '../../types';
import { type DocumentData } from './documentProjection';

export type MergePolicy = 'keyed' | 'ordered-keyed' | 'atomic';

export interface VectorClock {
    [actorId: string]: number;
}

export interface SemanticOperation {
    docPath: string;
    property: string;
    itemId?: string;
    value: unknown;
    isDelete: boolean;
    actorId: string;
    seq: number;
    clock: VectorClock;
}

export function getMergePolicy(docPath: string, property: string): MergePolicy {
    if (docPath === '') {
        if (['library', 'routines', 'customFoods', 'trainingCycles', 'supplements'].includes(property)) {
            return 'ordered-keyed';
        }
        return 'atomic';
    }
    return 'atomic';
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

        for (const property of allProps) {
            const bVal = bDoc[property];
            const dVal = dDoc[property];
            if (equal(bVal, dVal)) continue;

            const policy = getMergePolicy(docPath, property);
            if (policy === 'atomic') {
                ops.push({
                    docPath,
                    property,
                    value: dVal === undefined ? null : dVal,
                    isDelete: dVal === undefined,
                    actorId,
                    seq,
                    clock
                });
            } else if (policy === 'ordered-keyed') {
                const bArr = Array.isArray(bVal) ? bVal : [];
                const dArr = Array.isArray(dVal) ? dVal : [];
                const bMap = new Map(bArr.map((item: any) => [String(item.id), item]));
                const dMap = new Map(dArr.map((item: any, idx: number) => [String(item.id), { ...item, $order: idx }]));
                
                const allIds = new Set([...bMap.keys(), ...dMap.keys()]);
                for (const id of allIds) {
                    const bItem = bMap.get(id);
                    const dItem = dMap.get(id);
                    if (!equal(bItem, dItem)) {
                        ops.push({
                            docPath,
                            property,
                            itemId: id,
                            value: dItem === undefined ? null : dItem,
                            isDelete: dItem === undefined,
                            actorId,
                            seq,
                            clock
                        });
                    }
                }
            }
        }
    }
    return ops;
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

export function stampWins(opA: SemanticOperation, opB: SemanticOperation): boolean {
    // True if opA wins over opB
    if (dominates(opA.clock, opB.clock)) return true;
    if (dominates(opB.clock, opA.clock)) return false;
    
    // Concurrent
    if (opA.isDelete && !opB.isDelete) return true;
    if (opB.isDelete && !opA.isDelete) return false;
    
    // Normal tie-break
    if (opA.actorId === opB.actorId) return opA.seq > opB.seq;
    return opA.actorId > opB.actorId;
}

export function applySemanticOperations(
    base: Map<string, DocumentData>,
    ops: SemanticOperation[]
): Map<string, DocumentData> {
    // In a real implementation we would maintain state and only apply winning ops.
    // For this migration, we simplify to just projecting the changes over base.
    const result = new Map<string, DocumentData>();
    for (const [path, doc] of base.entries()) {
        result.set(path, { ...doc });
    }

    // Group ops by property
    const grouped = new Map<string, SemanticOperation[]>();
    for (const op of ops) {
        const key = `${op.docPath}:${op.property}${op.itemId ? `:${op.itemId}` : ''}`;
        const existing = grouped.get(key) || [];
        existing.push(op);
        grouped.set(key, existing);
    }

    for (const [, opList] of grouped.entries()) {
        // Find winning op
        let winner = opList[0];
        for (let i = 1; i < opList.length; i++) {
            if (stampWins(opList[i], winner)) {
                winner = opList[i];
            }
        }

        const doc = result.get(winner.docPath) || {};
        const policy = getMergePolicy(winner.docPath, winner.property);

        if (policy === 'atomic') {
            if (winner.isDelete) {
                delete doc[winner.property];
            } else {
                doc[winner.property] = winner.value;
            }
        } else if (policy === 'ordered-keyed') {
            const arr = Array.isArray(doc[winner.property]) ? [...(doc[winner.property] as any[])] : [];
            const idx = arr.findIndex((x: any) => String(x.id) === winner.itemId);
            if (winner.isDelete) {
                if (idx >= 0) arr.splice(idx, 1);
            } else {
                if (idx >= 0) arr[idx] = winner.value;
                else arr.push(winner.value);
            }
            doc[winner.property] = arr.sort((a: any, b: any) => (a.$order || 0) - (b.$order || 0)).map((x: any) => {
                const copy = { ...x };
                delete copy.$order;
                return copy;
            });
        }
        result.set(winner.docPath, doc);
    }

    return result;
}
