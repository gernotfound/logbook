export type MergePolicy = 'keyed' | 'ordered-keyed' | 'atomic' | 'property' | 'ignore';

export interface VectorClock {
    [actorId: string]: number;
}

export interface OperationGuard {
    path: string[];
    equals: unknown;
}

export interface FieldCandidate {
    clock: VectorClock;
    actorId: string;
    seq: number;
    value: unknown;
    legacyClock?: VectorClock;
    guard?: OperationGuard;
}

export interface FieldStamp {
    clock: VectorClock;
    actorId: string;
    seq: number;
    deleted?: boolean;
    deleteClock?: VectorClock;
    legacyClock?: VectorClock;
    guard?: OperationGuard;
    candidates?: FieldCandidate[];
}

export interface SyncMeta {
    protocolVersion: 2;
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
    guard?: OperationGuard;
}

export interface StampLike {
    clock: VectorClock;
    isDelete?: boolean;
    actorId: string;
    seq: number;
}
