import type { FieldStamp, StampLike, SyncMeta, VectorClock } from './contracts';

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

export function fieldKey(path: string[]): string {
    return path.map(p => encodeURIComponent(String(p))).join('/');
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

export function stampWins(opA: StampLike, opB: StampLike): boolean {
    if (dominates(opA.clock, opB.clock)) return true;
    if (dominates(opB.clock, opA.clock)) return false;

    if (opA.isDelete && !opB.isDelete) return true;
    if (opB.isDelete && !opA.isDelete) return false;

    if (opA.actorId === opB.actorId) return opA.seq > opB.seq;
    return opA.actorId > opB.actorId;
}
