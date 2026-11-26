import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import * as indexedDb from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Native ESM exports cannot be spied on. Wrap only the external update;
// ordinary calls still execute idb-keyval and the real encrypted gateway.
vi.mock('idb-keyval', async importOriginal => {
    const actual = await importOriginal<typeof import('idb-keyval')>();
    return { ...actual, update: vi.fn(actual.update) };
});

vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: vi.fn(),
}));

import { getCachedCatalog } from '../../../src/lib/catalog/catalogService';
import { projectDocuments, applyRemoteDocuments } from '../../../src/lib/sync/documentProjection';
import { applySemanticOperations } from '../../../src/lib/sync/semanticProjection';
import { checkpointFromCloudDocuments, type CloudCheckpoint } from '../../../src/lib/sync/replicaProtocol';
import type { UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import {
    adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal,
} from '../../../src/lib/sync/localRepository';
import type { ReplicaIdentity } from '../../../src/lib/sync/replicaProtocol';
import type { LocalEnvelope } from '../../../src/lib/sync/localEnvelopeValidation';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';

const catalog: Awaited<ReturnType<typeof getCachedCatalog>> = {
    manifest: {
        version: 'checkpoint-fixture', schemaVersion: 1, updatedAt: '2026-11-07T00:00:00.000Z',
        docRefs: { exercises: 'exercises_fixture', foods: 'foods_fixture' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 1_760_000_000_000,
};

const data = (height: number): UserData =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
const key = (owner: string): string => `logbook:v2:user:${owner}`;
const identity = (slot: string, replicaId = 'checkpoint-test', generation = 1): ReplicaIdentity => ({
    slot, replicaId, generation, checkpointAtMs: 1_760_000_000_000, leaseUntilMs: 1_790_000_000_000,
});

beforeEach(async () => {
    const actual = await vi.importActual<typeof import('idb-keyval')>('idb-keyval');
    vi.mocked(indexedDb.update).mockReset().mockImplementation(actual.update);
    vi.mocked(getCachedCatalog).mockReset();
    vi.mocked(getCachedCatalog).mockResolvedValue(structuredClone(catalog));
    lockAllVaults();
    localStorage.clear();
    await clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    await createAndMigrateVault('user:a');
});
afterEach(() => {
    vi.restoreAllMocks();
    lockAllVaults();
    vi.unstubAllGlobals();
});


function cloudCheckpoint(clock: CloudCheckpoint['clock']): CloudCheckpoint {
    return checkpointFromCloudDocuments(new Map([['', {
        _sync: { protocolVersion: 3, clock, fields: {} },
    }]]));
}

async function pendingReplica(): Promise<LocalEnvelope> {
    await initializeLocal('a', data(170));
    await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: {},
    });
    await commitLocal('a', data(171), data(170));
    const before = await readLocal('a');
    if (!before?.pending.length) throw new Error('Expected a durable pending edit');
    return before;
}

function pauseCatalog() {
    let release: (value: Awaited<ReturnType<typeof getCachedCatalog>>) => void = () => {};
    const wait = new Promise<Awaited<ReturnType<typeof getCachedCatalog>>>(resolve => { release = resolve; });
    vi.mocked(getCachedCatalog).mockReturnValueOnce(wait);
    return () => release(structuredClone(catalog));
}

async function stagedClaimWithExistingReplica() {
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '1');
    await initializeLocal('a', data(170));
    const existing = identity('s00', 'already-registered');
    await adoptReplicaCheckpoint('a', { identity: existing, baseSeq: 0 }, {
        clock: {}, syncMetaByDocument: {},
    });

    const accountKey = new Uint8Array(32).fill(27);
    const document = sealCloudDocument(accountKey, 'a', '', { profile: { height: '168' } }, {
        protocolVersion: 3, clock: { s00: 1 }, fields: {},
        writer: { slot: 's00', replicaId: 'already-registered', generation: 1,
            seq: 1, consentRevision: 1 },
    });
    const verified = await readAuthenticatedCloudflareCheckpoint(
        async () => ({ revision: 0, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 0, document }] }),
        'a', accountKey, 1, () => true,
    );
    const staged = await stageCloudflareReplicaClaim('a', verified,
        { revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
        'replacement-device', () => true,
    );
    expect(staged.currentReplica).toEqual({
        slot: existing.slot, replicaId: existing.replicaId, generation: existing.generation,
    });
    return { existing, staged };
}

describe('durable local replica checkpoint adoption', () => {
    it('adopts a D1 claim staged against the existing replica and clears only the matching intent', async () => {
        const { staged } = await stagedClaimWithExistingReplica();
        const before = (await readLocal('a'))!;
        const replacement = identity('s01', staged.candidateReplicaId, 2);

        const after = await adoptReplicaCheckpoint('a', { identity: replacement, baseSeq: 7 },
            cloudCheckpoint({ s00: 1, s01: 7 }), () => true, staged.mutationId);

        expect(after.replica).toEqual(replacement);
        expect(after.actorSeq).toBe(7);
        expect(after.cloudflareReplicaClaim).toBeUndefined();
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.pending).toEqual(before.pending);
        expect(await readLocal('a')).toEqual(after);
    });

    it('accepts the same staged claim only for its exact existing replica as a historical receipt', async () => {
        const { existing, staged } = await stagedClaimWithExistingReplica();
        const before = (await readLocal('a'))!;
        const after = await adoptReplicaCheckpoint('a', { identity: existing, baseSeq: 0 },
            cloudCheckpoint({}), () => true, staged.mutationId);

        expect(after.replica).toEqual(existing);
        expect(after.cloudflareReplicaClaim).toBeUndefined();
        expect(after.pending).toEqual(before.pending);
        expect(after.actorSeq).toBe(before.actorSeq);
        expect(await readLocal('a')).toEqual(after);
    });

    it.each([
        ['slot', 's02'],
        ['replicaId', 'other-registered'],
        ['generation', 2],
    ] as const)('refuses a staged claim whose existing replica %s was changed', async (field, value) => {
        const { staged } = await stagedClaimWithExistingReplica();
        await updateArchiveRecord<LocalEnvelope>('user:a', raw => ({
            ...raw!,
            cloudflareReplicaClaim: {
                ...staged, currentReplica: { ...staged.currentReplica!, [field]: value },
            },
        }));
        const before = await readLocal('a');
        const ciphertext = await get(key('a'));

        await expect(adoptReplicaCheckpoint('a', {
            identity: identity('s01', staged.candidateReplicaId, 2), baseSeq: 7,
        }, cloudCheckpoint({ s00: 1, s01: 7 }), () => true, staged.mutationId))
            .rejects.toThrow('Checkpoint replica incompatibile con un claim D1 pendente');

        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it.each([
        ['slot', 's02'],
        ['replicaId', 'other-registered'],
        ['generation', 2],
    ] as const)('refuses a historical D1 receipt for a different existing replica %s', async (field, value) => {
        const { existing, staged } = await stagedClaimWithExistingReplica();
        const ciphertext = await get(key('a'));
        const before = await readLocal('a');

        await expect(adoptReplicaCheckpoint('a', {
            identity: { ...existing, [field]: value }, baseSeq: 0,
        }, cloudCheckpoint({}), () => true, staged.mutationId))
            .rejects.toThrow('Checkpoint replica incompatibile con un claim D1 pendente');

        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it.each(['wrong-id', 'consent-advanced', 'integrity-fenced', 'claim-resolved'] as const)(
        'preserves the journal when a pending D1 claim loses its %s proof', async scenario => {
            const { staged } = await stagedClaimWithExistingReplica();
            if (scenario !== 'wrong-id') {
                await updateArchiveRecord<LocalEnvelope>('user:a', raw => ({
                    ...raw!,
                    ...(scenario === 'consent-advanced' ? { consentRevision: 2 } : {}),
                    ...(scenario === 'integrity-fenced' ? { cloudIntegrityFence: 'unverified-cloud' } : {}),
                    ...(scenario === 'claim-resolved' ? { cloudflareReplicaClaim: undefined } : {}),
                }));
            }
            const before = await readLocal('a');
            const ciphertext = await get(key('a'));
            const expectedId = scenario === 'wrong-id' ? 'wrong-staged-mutation-0001' : staged.mutationId;

            await expect(adoptReplicaCheckpoint('a', {
                identity: identity('s01', staged.candidateReplicaId, 2), baseSeq: 7,
            }, cloudCheckpoint({ s00: 1, s01: 7 }), () => true, expectedId))
                .rejects.toThrow('Checkpoint replica incompatibile con un claim D1 pendente');

            expect(await get(key('a'))).toBe(ciphertext);
            expect(await readLocal('a')).toEqual(before);
        },
    );

    it.each(['local-replica-removed', 'claim-replica-removed'] as const)(
        'refuses a D1 claim with an inconsistent %s snapshot', async scenario => {
            const { staged } = await stagedClaimWithExistingReplica();
            await updateArchiveRecord<LocalEnvelope>('user:a', raw => ({
                ...raw!,
                ...(scenario === 'local-replica-removed' ? { replica: null } : {
                    cloudflareReplicaClaim: { ...staged, currentReplica: null },
                }),
            }));
            const before = await readLocal('a');
            const ciphertext = await get(key('a'));

            await expect(adoptReplicaCheckpoint('a', {
                identity: identity('s01', staged.candidateReplicaId, 2), baseSeq: 7,
            }, cloudCheckpoint({ s00: 1, s01: 7 }), () => true, staged.mutationId))
                .rejects.toThrow('Checkpoint replica incompatibile con un claim D1 pendente');

            expect(await get(key('a'))).toBe(ciphertext);
            expect(await readLocal('a')).toEqual(before);
        },
    );

    it('rejects an invalid renewed replica lease before persisting a malformed encrypted envelope', async () => {
        const before = await pendingReplica();
        const ciphertext = await get(key('a'));
        const invalidLease = { ...before.replica!, leaseUntilMs: 0 };

        await expect(adoptReplicaCheckpoint('a', {
            identity: invalidLease, baseSeq: before.actorSeq,
        }, cloudCheckpoint({}), () => true)).rejects.toThrow('Scadenza lease replica');

        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it('rejects a fractional replacement sequence without poisoning the encrypted journal', async () => {
        await initializeLocal('a', data(170));
        const before = await readLocal('a');
        const ciphertext = await get(key('a'));

        await expect(adoptReplicaCheckpoint('a', {
            identity: identity('s01', 'replacement-device', 2), baseSeq: 1.5,
        }, cloudCheckpoint({}), () => true)).rejects.toThrow('Archivio locale causale non valido');

        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it('rebases pending business changes on a replacement slot without losing journal content', async () => {
        await initializeLocal('a', data(170));
        await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        await commitLocal('a', data(171), data(170));
        const before = (await readLocal('a'))!;
        expect(before.pending.length).toBeGreaterThan(0);

        const replacement = identity('s01', 'replacement', 2);
        const after = await adoptReplicaCheckpoint(
            'a', { identity: replacement, baseSeq: 7 },
            cloudCheckpoint({ s00: 1 }),
        );

        expect(after.replica).toEqual(replacement);
        expect(after.actorId).toBe('s01');
        expect(after.actorSeq).toBe(8);
        expect(after.clock).toEqual({ s00: 1, s01: 8 });
        expect(after.pending.length).toBeGreaterThan(0);
        expect(after.pending.every(op => op.actorId === 's01' && op.seq === 8)).toBe(true);
        expect(after.pending.map(op => [op.docPath, op.path, op.isDelete, op.value]))
            .toEqual(before.pending.map(op => [op.docPath, op.path, op.isDelete, op.value]));
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.revision).toBe(before.revision + 1);
        expect(await readLocal('a')).toEqual(after);
    });

    it('renews an identical replica without rewriting pending sequences', async () => {
        await initializeLocal('a', data(170));
        const oldReplica = identity('s00');
        await adoptReplicaCheckpoint('a', { identity: oldReplica, baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        await commitLocal('a', data(171), data(170));
        const before = (await readLocal('a'))!;
        const renewed = { ...oldReplica, checkpointAtMs: oldReplica.checkpointAtMs + 100 };
        const after = await adoptReplicaCheckpoint('a', { identity: renewed, baseSeq: 1 }, cloudCheckpoint({ s02: 4 }));

        expect(after.replica).toEqual(renewed);
        expect(after.actorSeq).toBe(before.actorSeq);
        expect(after.pending).toEqual(before.pending);
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.syncMetaByDocument).toEqual(before.syncMetaByDocument);
        expect(after.clock).toEqual({ ...before.clock, s02: 4 });
        expect(after.revision).toBe(before.revision + 1);
    });

    it.each([
        { reason: 'remote vector clock', baseSeq: 1, clock: { s00: 2 } as CloudCheckpoint['clock'] },
        { reason: 'remote control sequence', baseSeq: 2, clock: {} as CloudCheckpoint['clock'] },
    ])('rejects an incompatible same-replica $reason without sealing a bad journal', async ({ baseSeq, clock }) => {
        const before = await pendingReplica();
        const ciphertext = await get(key('a'));
        await expect(adoptReplicaCheckpoint(
            'a', { identity: before.replica!, baseSeq }, cloudCheckpoint(clock),
        )).rejects.toThrow('Checkpoint replica incoerente');
        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it('preserves the local actor frontier when an empty replacement checkpoint reserves a higher sequence', async () => {
        await initializeLocal('a', data(170));
        await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        const after = await adoptReplicaCheckpoint('a', {
            identity: identity('s01', 'reused-slot', 2), baseSeq: 7,
        }, cloudCheckpoint({ s00: 4 }));
        expect(after.actorId).toBe('s01');
        expect(after.actorSeq).toBe(7);
        expect(after.clock).toEqual({ s00: 4, s01: 7 });
        expect(after.pending).toEqual([]);
        expect(await readLocal('a')).toEqual(after);
    });

    it('rejects a replacement whose cloud clock exceeds the claimed sequence', async () => {
        await initializeLocal('a', data(170));
        const before = await readLocal('a');
        const ciphertext = await get(key('a'));
        await expect(adoptReplicaCheckpoint('a', {
            identity: identity('s01', 'replacement', 2), baseSeq: 7,
        }, cloudCheckpoint({ s01: 8 }))).rejects.toThrow('Checkpoint replica incoerente');
        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it('rejects a stale session guard without altering either owner', async () => {
        await initializeLocal('a', data(170));
        await createAndMigrateVault('user:b');
        await initializeLocal('b', data(174));
        const aBefore = await get(key('a'));
        const bBefore = await get(key('b'));
        expect(aBefore).toMatch(/^tlb-sealed:v1:/);
        expect(bBefore).toMatch(/^tlb-sealed:v1:/);
        await expect(adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        }, () => false)).rejects.toThrow('Checkpoint replica invalidato');
        expect(await get(key('a'))).toEqual(aBefore);
        expect(await get(key('b'))).toEqual(bBefore);
    });

    it('fails closed and preserves invalid journal bytes when changing slot', async () => {
        await initializeLocal('a', data(170));
        await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        await commitLocal('a', data(171), data(170));
        const raw = (await readLocal('a')) as LocalEnvelope;
        expect(raw.pending.length).toBeGreaterThan(0);
        const corrupt = { ...raw, pending: raw.pending.map(op => ({ ...op, actorId: 'other' })) };
        await updateArchiveRecord<LocalEnvelope>('user:a', () => corrupt);
        const encrypted = await get(key('a'));
        expect(encrypted).toMatch(/^tlb-sealed:v1:/);

        await expect(adoptReplicaCheckpoint('a', { identity: identity('s01'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        })).rejects.toThrow();
        expect(await get(key('a'))).toEqual(encrypted);
    });

    it('does not create a missing owner archive', async () => {
        await createAndMigrateVault('user:absent');
        expect(await readLocal('absent')).toBeUndefined();
        await expect(adoptReplicaCheckpoint('absent', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        })).rejects.toThrow('Archivio locale non trovato durante il checkpoint replica');
        expect(await get(key('absent'))).toBeUndefined();
    });

    it.each([
        identity('s01'),
        identity('s00', 'different-replica'),
        identity('s00', 'checkpoint-test', 2),
    ])('rebases when one identity component changes: %j', async replacement => {
        const before = await pendingReplica();
        const checkpoint = checkpointFromCloudDocuments(new Map([['', {
            _sync: {
                protocolVersion: 3, clock: { s00: 1, s02: 4, [replacement.slot]: 7 },
                fields: { 'profile/height': { actorId: 's02', seq: 4, clock: { s02: 4 } } },
                writer: { slot: 's02', replicaId: 'remote-proof', generation: 1, seq: 4 },
            },
        }]]));
        const expectedMetadata = structuredClone(checkpoint.syncMetaByDocument);
        const expectedClock = { ...checkpoint.clock, [replacement.slot]: 8 };
        const after = await adoptReplicaCheckpoint('a', { identity: replacement, baseSeq: 7 }, checkpoint);
        expect(after.replica).toEqual(replacement);
        expect(after.actorId).toBe(replacement.slot);
        expect(after.actorSeq).toBe(8);
        expect(after.clock).toEqual(expectedClock);
        expect(after.pending).toHaveLength(before.pending.length);
        for (const op of after.pending) {
            expect(op).toMatchObject({ actorId: replacement.slot, seq: 8, clock: expectedClock });
        }
        const replay = applySemanticOperations(projectDocuments(after.baseline, catalog), after.pending, after.syncMetaByDocument);
        expect(applyRemoteDocuments(after.baseline, replay.documents, catalog).profile?.height).toBe('171');
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.revision).toBe(before.revision + 1);
        expect(after.syncMetaByDocument).toEqual(checkpoint.syncMetaByDocument);
        checkpoint.syncMetaByDocument[''].clock.s02 = 99;
        checkpoint.syncMetaByDocument[''].fields['profile/height'].clock.s02 = 99;
        expect(after.syncMetaByDocument).toEqual(expectedMetadata);
        expect(await readLocal('a')).toEqual(after);
    });

    it('adopts a replacement with no pending edits without inventing an operation or incrementing its base sequence', async () => {
        await initializeLocal('a', data(170));
        await adoptReplicaCheckpoint('a', { identity: identity('s00'), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
        const before = (await readLocal('a'))!;
        const replacement = identity('s01', 'replacement', 2);
        const after = await adoptReplicaCheckpoint('a', { identity: replacement, baseSeq: 7 }, cloudCheckpoint({ s00: 4, s01: 7 }));
        expect(after.actorId).toBe('s01');
        expect(after.actorSeq).toBe(7);
        expect(after.clock).toEqual({ s00: 4, s01: 7 });
        expect(after.pending).toEqual([]);
        expect(after.data).toEqual(before.data);
        expect(after.baseline).toEqual(before.baseline);
        expect(after.replica).toEqual(replacement);
        expect(after.revision).toBe(before.revision + 1);
        expect(await readLocal('a')).toEqual(after);
    });

    it.each(['renew', 'replace'] as const)('rejects a session lost during catalog loading before %s', async mode => {
        const before = await pendingReplica();
        const ciphertext = await get(key('a'));
        const release = pauseCatalog();
        let current = true;
        const replacement = mode === 'renew' ? before.replica! : identity('s01', 'replacement', 2);
        const adoption = adoptReplicaCheckpoint('a', { identity: replacement, baseSeq: 1 }, cloudCheckpoint({ s00: 1 }), () => current);
        const rejection = expect(adoption).rejects.toThrow('Checkpoint replica invalidato dal cambio sessione');
        current = false;
        release();
        await rejection;
        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it('rebases the latest durable edit committed while the catalog was still loading', async () => {
        await pendingReplica();
        const release = pauseCatalog();
        const replacement = identity('s01', 'replacement', 2);
        const adoption = adoptReplicaCheckpoint('a', { identity: replacement, baseSeq: 7 }, cloudCheckpoint({ s00: 1, s01: 7 }), () => true);
        try {
            await commitLocal('a', data(172), data(171));
        } finally {
            release();
        }
        const after = await adoption;
        expect(after.data.profile?.height).toBe('172');
        expect(after.baseline.profile?.height).toBe('170');
        expect(after.actorSeq).toBe(8);
        expect(after.clock).toEqual({ s00: 1, s01: 8 });
        expect(after.pending).toContainEqual(expect.objectContaining({
            path: ['profile', 'height'], value: '172', actorId: 's01', seq: 8,
        }));
        const replay = applySemanticOperations(projectDocuments(after.baseline, catalog), after.pending, after.syncMetaByDocument);
        expect(applyRemoteDocuments(after.baseline, replay.documents, catalog).profile?.height).toBe('172');
        expect(await readLocal('a')).toEqual(after);
    });

    it('preserves the encrypted journal after a failed IndexedDB update and can retry adoption', async () => {
        const before = await pendingReplica();
        const ciphertext = await get(key('a'));
        const failure = new Error('checkpoint disk write failed');
        vi.mocked(indexedDb.update).mockRejectedValueOnce(failure);
        const claim = { identity: identity('s01', 'replacement', 2), baseSeq: 7 };
        const checkpoint = cloudCheckpoint({ s00: 1, s01: 7 });
        await expect(adoptReplicaCheckpoint('a', claim, checkpoint)).rejects.toBe(failure);
        expect(await get(key('a'))).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
        const recovered = await adoptReplicaCheckpoint('a', claim, checkpoint);
        expect(recovered.actorId).toBe('s01');
        expect(recovered.actorSeq).toBe(8);
        expect(recovered.data).toEqual(before.data);
        expect(recovered.baseline).toEqual(before.baseline);
        expect(recovered.pending).toHaveLength(before.pending.length);
        expect(await readLocal('a')).toEqual(recovered);
    });

});
