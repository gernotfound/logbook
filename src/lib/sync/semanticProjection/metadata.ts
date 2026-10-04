import { CURRENT_SYNC_PROTOCOL } from '../../schemaEvolution';
import type { FieldCandidate, FieldStamp, OperationGuard, SemanticOperation, StampLike, SyncMeta, VectorClock } from './contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSafeSeq(raw: unknown, context: string): number {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) throw new Error(`Invalid seq in ${context}`);
    return raw;
}

export function parseVectorClock(raw: unknown, context: string): VectorClock {
    if (!isRecord(raw)) throw new Error(`Invalid ${context}`);
    const clock: VectorClock = {};
    for (const [actor, seq] of Object.entries(raw)) {
        if (!actor.trim()) throw new Error(`Invalid actor ID in ${context}`);
        clock[actor] = parseSafeSeq(seq, context);
    }
    return clock;
}

export function coversVectorClock(cover: VectorClock, covered: VectorClock): boolean {
    return Object.entries(covered).every(([actor, seq]) => (cover[actor] ?? 0) >= seq);
}

function assertDotCovered(clock: VectorClock, actorId: string, seq: number, context: string): void {
    if ((clock[actorId] ?? 0) < seq) throw new Error(`Invalid causal dot in ${context}`);
}

function parseGuard(raw: unknown, context: string): OperationGuard | undefined {
    if (raw === undefined) return undefined;
    if (!isRecord(raw)) throw new Error(`Invalid ${context} guard`);
    return {
        path: parsePath(raw.path, `${context} guard path`),
        equals: structuredClone(raw.equals),
    };
}

function parseFieldCandidate(raw: unknown, documentClock: VectorClock, deleteClock: VectorClock | undefined): FieldCandidate {
    if (!isRecord(raw)) throw new Error('Invalid FieldCandidate');
    if (typeof raw.actorId !== 'string' || !raw.actorId.trim()) throw new Error('Invalid actorId in FieldCandidate');
    const seq = parseSafeSeq(raw.seq, 'FieldCandidate');
    const clock = parseVectorClock(raw.clock, 'candidate clock');
    assertDotCovered(clock, raw.actorId, seq, 'FieldCandidate');
    if (!coversVectorClock(documentClock, clock)) throw new Error('Document clock does not cover FieldCandidate');
    if (deleteClock && !coversVectorClock(clock, deleteClock)) throw new Error('FieldCandidate does not cover delete barrier');
    if (!Object.hasOwn(raw, 'value')) throw new Error('Invalid FieldCandidate value');
    const guard = parseGuard(raw.guard, 'FieldCandidate');
    return {
        clock,
        actorId: raw.actorId,
        seq,
        value: structuredClone(raw.value),
        ...(guard ? { guard } : {}),
    };
}

export function parseSyncMeta(raw: unknown): SyncMeta {
    if (!isRecord(raw)) throw new Error('Invalid SyncMeta');
    if (raw.protocolVersion !== CURRENT_SYNC_PROTOCOL) throw new Error('Unsupported protocolVersion');

    const clock = parseVectorClock(raw.clock, 'clock');
    if (!isRecord(raw.fields)) throw new Error('Invalid fields map');

    const fields: Record<string, FieldStamp> = {};
    for (const [path, stampRaw] of Object.entries(raw.fields)) {
        if (!path) throw new Error('Invalid field path');
        if (!isRecord(stampRaw)) throw new Error('Invalid FieldStamp');
        if (typeof stampRaw.actorId !== 'string' || !stampRaw.actorId.trim()) throw new Error('Invalid actorId in FieldStamp');
        const seq = parseSafeSeq(stampRaw.seq, 'FieldStamp');
        const fieldClock = parseVectorClock(stampRaw.clock, 'field clock');
        assertDotCovered(fieldClock, stampRaw.actorId, seq, 'FieldStamp');
        if (!coversVectorClock(clock, fieldClock)) throw new Error('Document clock does not cover FieldStamp');

        const fieldStamp: FieldStamp = {
            clock: fieldClock,
            actorId: stampRaw.actorId,
            seq
        };

        if ('deleted' in stampRaw) {
            if (typeof stampRaw.deleted !== 'boolean') throw new Error('Invalid deleted flag in FieldStamp');
            fieldStamp.deleted = stampRaw.deleted;
        }

        if ('deleteClock' in stampRaw) {
            const deleteClock = parseVectorClock(stampRaw.deleteClock, 'delete clock');
            if (!coversVectorClock(clock, deleteClock)) throw new Error('Document clock does not cover delete barrier');
            fieldStamp.deleteClock = deleteClock;
        } else if (fieldStamp.deleted) {
            // Protocol-1 tombstones migrate losslessly: their event clock is also
            // the initial remove-wins barrier in protocol 2.
            fieldStamp.deleteClock = { ...fieldStamp.clock };
        }

        if (!fieldStamp.deleted && fieldStamp.deleteClock && !coversVectorClock(fieldStamp.clock, fieldStamp.deleteClock)) {
            throw new Error('Visible FieldStamp does not cover delete barrier');
        }

        if ('candidates' in stampRaw) {
            if (!Array.isArray(stampRaw.candidates)) throw new Error('Invalid FieldCandidate list');
            if (fieldStamp.deleted && stampRaw.candidates.length) throw new Error('Deleted FieldStamp cannot retain update candidates');
            const candidates = stampRaw.candidates.map(candidate => parseFieldCandidate(candidate, clock, fieldStamp.deleteClock));
            const dots = new Set<string>();
            for (const candidate of candidates) {
                const dot = `${candidate.actorId}:${candidate.seq}`;
                if (dots.has(dot) || (candidate.actorId === fieldStamp.actorId && candidate.seq === fieldStamp.seq)) {
                    throw new Error('Duplicate FieldCandidate dot');
                }
                dots.add(dot);
                if (dominates(fieldStamp.clock, candidate.clock) || dominates(candidate.clock, fieldStamp.clock)) {
                    throw new Error('FieldCandidate is not concurrent with visible FieldStamp');
                }
            }
            for (let i = 0; i < candidates.length; i++) {
                for (let j = i + 1; j < candidates.length; j++) {
                    if (dominates(candidates[i].clock, candidates[j].clock) || dominates(candidates[j].clock, candidates[i].clock)) {
                        throw new Error('FieldCandidates are not a causal antichain');
                    }
                }
            }
            if (candidates.length) fieldStamp.candidates = candidates;
        }

        fields[path] = fieldStamp;
    }

    return { protocolVersion: CURRENT_SYNC_PROTOCOL, clock, fields };
}

function parsePath(raw: unknown, context: string): string[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.some(segment => typeof segment !== 'string' || segment.length === 0)) {
        throw new Error(`Invalid ${context}`);
    }
    return [...raw];
}

export function parseSemanticOperation(raw: unknown): SemanticOperation {
    if (!isRecord(raw)) throw new Error('Invalid SemanticOperation');
    if (typeof raw.docPath !== 'string') throw new Error('Invalid SemanticOperation docPath');
    const path = parsePath(raw.path, 'SemanticOperation path');
    if (typeof raw.isDelete !== 'boolean') throw new Error('Invalid SemanticOperation delete flag');
    if (!raw.isDelete && !Object.hasOwn(raw, 'value')) throw new Error('Invalid SemanticOperation value');
    if (typeof raw.actorId !== 'string' || !raw.actorId.trim()) throw new Error('Invalid SemanticOperation actorId');
    const seq = parseSafeSeq(raw.seq, 'SemanticOperation');
    const clock = parseVectorClock(raw.clock, 'SemanticOperation clock');
    assertDotCovered(clock, raw.actorId, seq, 'SemanticOperation');

    const guard = parseGuard(raw.guard, 'SemanticOperation');

    return {
        docPath: raw.docPath,
        path,
        isDelete: raw.isDelete,
        ...(!raw.isDelete && Object.hasOwn(raw, 'value') ? { value: structuredClone(raw.value) } : {}),
        actorId: raw.actorId,
        seq,
        clock,
        ...(guard ? { guard } : {}),
    };
}

export function fieldKey(path: string[]): string {
    return path.map(p => encodeURIComponent(String(p))).join('/');
}

export function pathFromFieldKey(key: string): string[] {
    if (!key) return [];
    return key.split('/').map(segment => decodeURIComponent(segment));
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

function clockWeight(clock: VectorClock): bigint {
    let total = 0n;
    for (const seq of Object.values(clock)) total += BigInt(seq);
    return total;
}

function compareCanonicalClock(left: VectorClock, right: VectorClock): number {
    const actors = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const actor of actors) {
        const l = left[actor] ?? 0;
        const r = right[actor] ?? 0;
        if (l !== r) return l > r ? 1 : -1;
    }
    return 0;
}

/**
 * Protocol 2 winner order.
 *
 * Causal dominance remains authoritative. Concurrent events are then placed in a
 * single deterministic total order: observed-frontier cardinality, delete bias
 * for equal frontiers, actor, sequence and canonical vector order. Because causal
 * dominance strictly increases the vector-clock weight, this order extends
 * happens-before and is transitive, so delivery order and batch partitioning cannot
 * create pairwise winner cycles.
 */
export function compareStamps(left: StampLike, right: StampLike): number {
    if (dominates(left.clock, right.clock)) return 1;
    if (dominates(right.clock, left.clock)) return -1;

    const leftWeight = clockWeight(left.clock);
    const rightWeight = clockWeight(right.clock);
    if (leftWeight !== rightWeight) return leftWeight > rightWeight ? 1 : -1;

    const leftDelete = Boolean(left.isDelete);
    const rightDelete = Boolean(right.isDelete);
    if (leftDelete !== rightDelete) return leftDelete ? 1 : -1;

    if (left.actorId !== right.actorId) return left.actorId > right.actorId ? 1 : -1;
    if (left.seq !== right.seq) return left.seq > right.seq ? 1 : -1;

    const vectorOrder = compareCanonicalClock(left.clock, right.clock);
    if (vectorOrder !== 0) return vectorOrder;
    return 0;
}

export function stampWins(opA: StampLike, opB: StampLike): boolean {
    return compareStamps(opA, opB) > 0;
}
