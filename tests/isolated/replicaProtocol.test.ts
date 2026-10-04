import { describe, expect, it } from 'vitest';
import {
    advanceReplicaControl,
    checkpointFromCloudDocuments,
    matchesReplica,
    needsReplicaCheckpoint,
    parseReplicaControl,
    stableFrontierFromControl,
    type ReplicaControl,
    type ReplicaIdentity,
} from '../../src/lib/sync/replicaProtocol';

const identity = (slot: string, generation = 1): ReplicaIdentity => ({
    slot,
    replicaId: `replica-${slot}-g${generation}`,
    generation,
    checkpointAtMs: 1_000,
    leaseUntilMs: 10_000,
});

const control = (): ReplicaControl => ({
    protocolVersion: 3,
    replicas: {
        s00: {
            replicaId: 'replica-s00-g1',
            generation: 1,
            status: 'active',
            lastSeq: 4,
            checkpointAtMs: 1_000,
            leaseUntilMs: 10_000,
            checkpointClock: { s00: 4, s01: 2, legacy: 7 },
        },
        s01: {
            replicaId: 'replica-s01-g2',
            generation: 2,
            status: 'active',
            lastSeq: 3,
            checkpointAtMs: 1_000,
            leaseUntilMs: 10_000,
            checkpointClock: { s00: 3, s01: 3, legacy: 7 },
        },
        s02: {
            replicaId: 'retired',
            generation: 1,
            status: 'retired',
            lastSeq: 9,
            checkpointAtMs: 1_000,
            leaseUntilMs: 2_000,
            checkpointClock: { s00: 1, s01: 1, legacy: 1 },
        },
    },
    mutation: { slot: 's00', action: 'checkpoint' },
});

describe('Sync Protocol 3 replica registry', () => {
    it('computes the stable frontier from active replicas only', () => {
        expect(stableFrontierFromControl(control())).toEqual({ s00: 3, s01: 2, legacy: 7 });
    });

    it('fences a stale generation and advances only the current replica sequence', () => {
        const current = control();
        expect(matchesReplica(current.replicas.s00, identity('s00'))).toBe(true);
        expect(matchesReplica(current.replicas.s00, identity('s00', 2))).toBe(false);
        expect(() => advanceReplicaControl(current, identity('s00', 2), 5)).toThrow(/non è più autorizzata/i);

        const advanced = advanceReplicaControl(current, identity('s00'), 6);
        expect(advanced.replicas.s00.lastSeq).toBe(6);
        expect(advanced.replicas.s01).toEqual(current.replicas.s01);
        expect(advanced.mutation).toEqual({ slot: 's00', action: 'advance' });
    });

    it('derives checkpoints only from normalized cloud sync metadata', () => {
        const docs = new Map<string, Record<string, unknown>>([
            ['', {
                _sync: {
                    protocolVersion: 3,
                    clock: { s00: 4 },
                    fields: {},
                },
            }],
            ['history_months/2026-09', {
                _sync: {
                    protocolVersion: 3,
                    clock: { s00: 3, s01: 2 },
                    fields: {},
                },
            }],
            ['nutrition_months/2026-09', { day: {} }],
        ]);

        const checkpoint = checkpointFromCloudDocuments(docs);
        expect(checkpoint.clock).toEqual({ s00: 4, s01: 2 });
        expect(Object.keys(checkpoint.syncMetaByDocument).sort()).toEqual(['', 'history_months/2026-09']);
    });

    it('requires a checkpoint when identity is missing, stale, or close to lease expiry', () => {
        const now = 100_000_000_000;
        expect(needsReplicaCheckpoint(null, now)).toBe(true);
        expect(needsReplicaCheckpoint({
            slot: 's00',
            replicaId: 'r',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 400 * 24 * 60 * 60 * 1000,
        }, now)).toBe(false);
        expect(needsReplicaCheckpoint({
            slot: 's00',
            replicaId: 'r',
            generation: 1,
            checkpointAtMs: now - 31 * 24 * 60 * 60 * 1000,
            leaseUntilMs: now + 300 * 24 * 60 * 60 * 1000,
        }, now)).toBe(true);
    });

    it('rejects malformed or over-capacity control state', () => {
        const valid = control();
        expect(parseReplicaControl(valid).replicas.s00.lastSeq).toBe(4);
        expect(() => parseReplicaControl({
            protocolVersion: 3,
            replicas: { bad: valid.replicas.s00 },
            mutation: { slot: 's00', action: 'checkpoint' },
        })).toThrow();

        const replicas = Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [
                `s${String(index).padStart(2, '0')}`,
                valid.replicas.s00,
            ]),
        );
        expect(() => parseReplicaControl({
            protocolVersion: 3,
            replicas,
            mutation: { slot: 's00', action: 'checkpoint' },
        })).toThrow(/limite/i);
    });
});
