import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../src/lib/sync/documentProjection';
import {
    applySemanticOperations,
    diffDocuments,
    mergeVectors,
    type SemanticOperation,
    type SyncMeta,
    type VectorClock,
} from '../../src/lib/sync/semanticProjection';
import { runProperty, SeededRandom } from './propertyHarness';

type MergeState = {
    documents: Map<string, DocumentData>;
    syncMetas: Record<string, SyncMeta>;
};

const ACTORS = ['A', 'B', 'C', 'D', 'E'] as const;
const PROFILE_PATHS = [
    ['profile', 'name'],
    ['profile', 'height'],
    ['profile', 'weight'],
] as const;

function baseDocuments(): Map<string, DocumentData> {
    return new Map([
        ['', {
            profile: {
                name: 'Base',
                height: '170',
                weight: '70',
            },
        }],
    ]);
}

function initialState(): MergeState {
    return { documents: baseDocuments(), syncMetas: {} };
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map(key => [key, stable(record[key])]));
    }
    return value;
}

function snapshot(state: MergeState): unknown {
    const documents = Object.fromEntries(
        [...state.documents.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([path, doc]) => [path, stable(doc)]),
    );
    return stable({ documents, syncMetas: state.syncMetas });
}

function deliverPartitioned(
    state: MergeState,
    operations: readonly SemanticOperation[],
    rng: SeededRandom,
    includeDuplicates = true,
): MergeState {
    const delivery: SemanticOperation[] = operations.map(op => structuredClone(op));
    if (includeDuplicates) {
        for (const operation of operations) {
            if (rng.bool(1, 3)) delivery.push(structuredClone(operation));
        }
    }

    const shuffled = rng.shuffle(delivery);
    let current = state;
    let cursor = 0;
    while (cursor < shuffled.length) {
        const batchSize = 1 + rng.int(Math.min(4, shuffled.length - cursor));
        const batch = shuffled.slice(cursor, cursor + batchSize);
        current = applySemanticOperations(current.documents, batch, current.syncMetas);
        cursor += batchSize;
    }
    return current;
}

function concurrentSameField(rng: SeededRandom, seed: number): SemanticOperation[] {
    const actors = rng.shuffle(ACTORS).slice(0, 2 + rng.int(ACTORS.length - 1));
    return actors.map((actor, index) => {
        const isDelete = rng.bool(1, 4);
        return {
            docPath: '',
            path: ['profile', 'name'],
            ...(isDelete ? {} : { value: `${seed}:${actor}:${index}` }),
            isDelete,
            actorId: actor,
            seq: 1,
            clock: { [actor]: 1 },
        };
    });
}

function causalChain(rng: SeededRandom, seed: number): SemanticOperation[] {
    const counters: VectorClock = {};
    let observed: VectorClock = {};
    const length = 2 + rng.int(10);
    const operations: SemanticOperation[] = [];

    for (let index = 0; index < length; index++) {
        const actor = rng.pick(ACTORS);
        counters[actor] = (counters[actor] ?? 0) + 1;
        observed = mergeVectors(observed, { [actor]: counters[actor] });
        const isDelete = rng.bool(1, 5);
        operations.push({
            docPath: '',
            path: ['profile', 'height'],
            ...(isDelete ? {} : { value: `${seed}:${index}:${actor}` }),
            isDelete,
            actorId: actor,
            seq: counters[actor],
            clock: { ...observed },
        });
    }
    return operations;
}

function randomClock(rng: SeededRandom): VectorClock {
    const clock: VectorClock = {};
    for (const actor of ACTORS) {
        if (rng.bool(2, 3)) clock[actor] = rng.int(6);
    }
    return clock;
}

function covers(left: VectorClock, right: VectorClock): boolean {
    return Object.entries(right).every(([actor, seq]) => (left[actor] ?? 0) >= seq);
}

function randomProfile(rng: SeededRandom, seed: number): Record<string, string> {
    const profile: Record<string, string> = {};
    for (const key of ['name', 'height', 'weight'] as const) {
        if (rng.bool(2, 3)) profile[key] = `${key}:${seed}:${rng.int(10000)}`;
    }
    return profile;
}

describe('M2 distributed property fuzz', () => {
    it('converges for n-way concurrent same-field delivery regardless of batching, order, and retries', () => {
        runProperty('concurrent same-field convergence', 320, (rng, seed) => {
            const operations = concurrentSameField(rng, seed);
            const canonical = applySemanticOperations(baseDocuments(), operations);
            const distributed = deliverPartitioned(initialState(), operations, rng);

            expect(snapshot(distributed)).toEqual(snapshot(canonical));
        });
    });

    it('converges for a causally ordered chain even when the network delivers it out of order with duplicates', () => {
        runProperty('causal-chain convergence', 320, (rng, seed) => {
            const operations = causalChain(rng, seed);
            const canonical = applySemanticOperations(baseDocuments(), operations);
            const distributed = deliverPartitioned(initialState(), operations, rng);

            expect(snapshot(distributed)).toEqual(snapshot(canonical));
        });
    });

    it('converges across repeated synchronization rounds with concurrent edits on independent or identical fields', () => {
        runProperty('multi-round distributed convergence', 240, (rng, seed) => {
            let canonical = initialState();
            let distributed = initialState();
            const actorCounters: VectorClock = {};
            const rounds = 2 + rng.int(8);

            for (let round = 0; round < rounds; round++) {
                const baseClock = canonical.syncMetas['']?.clock ?? {};
                const actors = rng.shuffle(ACTORS).slice(0, 2 + rng.int(3));
                const roundOperations: SemanticOperation[] = actors.map(actor => {
                    actorCounters[actor] = Math.max(actorCounters[actor] ?? 0, baseClock[actor] ?? 0) + 1;
                    const path = [...rng.pick(PROFILE_PATHS)];
                    const isDelete = rng.bool(1, 5);
                    return {
                        docPath: '',
                        path,
                        ...(isDelete ? {} : { value: `${seed}:${round}:${actor}:${path[1]}` }),
                        isDelete,
                        actorId: actor,
                        seq: actorCounters[actor],
                        clock: mergeVectors(baseClock, { [actor]: actorCounters[actor] }),
                    };
                });

                canonical = applySemanticOperations(canonical.documents, roundOperations, canonical.syncMetas);
                distributed = deliverPartitioned(distributed, roundOperations, rng);
                expect(snapshot(distributed)).toEqual(snapshot(canonical));
            }
        });
    });

    it('keeps vector-clock join commutative, associative, idempotent, and covering every input', () => {
        runProperty('vector-clock algebra', 500, rng => {
            const a = randomClock(rng);
            const b = randomClock(rng);
            const c = randomClock(rng);

            const ab = mergeVectors(a, b);
            const ba = mergeVectors(b, a);
            expect(ab).toEqual(ba);
            expect(mergeVectors(mergeVectors(a, b), c)).toEqual(mergeVectors(a, mergeVectors(b, c)));
            expect(mergeVectors(a, a)).toEqual(a);
            expect(covers(ab, a)).toBe(true);
            expect(covers(ab, b)).toBe(true);
        });
    });

    it('round-trips generated profile diffs through the semantic operation pipeline', () => {
        runProperty('diff/apply profile round-trip', 320, (rng, seed) => {
            const baseProfile = randomProfile(rng, seed);
            const desiredProfile = randomProfile(rng, seed ^ 0x5bd1e995);
            const base = new Map<string, DocumentData>([['', { profile: baseProfile }]]);
            const desired = new Map<string, DocumentData>([['', { profile: desiredProfile }]]);
            const operations = diffDocuments(base, desired, 'A', 1, { A: 1 });
            const result = applySemanticOperations(base, operations);

            expect(result.documents.get('')?.profile).toEqual(desiredProfile);
        });
    });
});
