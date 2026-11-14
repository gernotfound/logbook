import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { deliverCloudflareJournalCandidate } from '../../../src/lib/sync/cloudflareJournalCandidate';
import { stageCloudflareDelivery } from '../../../src/lib/sync/cloudReplicaDurableDelivery';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { readAccountCloudDocument } from '../../../src/lib/sync/cloudDocumentRead';
import { parseSyncMeta } from '../../../src/lib/sync/semanticProjection';
import { CloudReplicaTransportError } from '../../../src/lib/sync/cloudReplicaTransport';
import type {
    CloudReplicaBatch, CloudReplicaCommitOutcome, CloudReplicaCompleteScan, CloudReplicaControlSnapshot, CloudReplicaSnapshot,
} from '../../../src/lib/sync/cloudReplicaTransport';
import { adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

const owner = 'user:cf04-candidate';
const storeKey = 'logbook:v2:' + owner;
const adk = new Uint8Array(32).fill(21);
const catalog: CachedGlobalCatalog = {
    manifest: { version: 'cf04-candidate', updatedAt: '2026-11-14T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/exercises', foods: 'fixture/foods' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};
const profile = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task(),
    } });
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function seed() {
    const initial = profile(170);
    await initializeLocal(owner, initial);
    const now = Date.now();
    const replica = {
        slot: 's00', replicaId: 'cf04-candidate-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86400000,
    };
    await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 },
        { clock: {}, syncMetaByDocument: {} });
    await commitLocal(owner, profile(171), initial);
    const local = await readLocal(owner);
    if (!local || local.pending.length === 0) throw new Error('Test journal missing');
    const control: CloudReplicaControlSnapshot = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        replicas: { s00: { ...replica, lastSeq: 0, status: 'active', checkpointClock: {} } },
    };
    const snapshot: CloudReplicaSnapshot = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: null, document: null }],
    };
    return { replica, local, control, snapshot };
}

function transport(control: CloudReplicaControlSnapshot, snapshot: CloudReplicaSnapshot) {
    let committed: CloudReplicaBatch | null = null;
    return {
        control: vi.fn(async () => control),
        read: vi.fn(async (_paths: string[]) => snapshot),
        scanAll: vi.fn(async (): Promise<CloudReplicaCompleteScan> => ({
            revision: control.revision, fenceEpoch: control.fenceEpoch,
            consentRevision: control.consentRevision, documents: [],
        })),
        commitOutcome: vi.fn(async (_batch: CloudReplicaBatch, _csrf: string): Promise<CloudReplicaCommitOutcome> => ({
            outcome: 'inconclusive', currentRevision: control.revision,
        })),
        commit: vi.fn(async (batch: CloudReplicaBatch, csrf: string) => {
            expect(csrf).toBe('csrf-session');
            committed = structuredClone(batch);
            return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq, replayed: false };
        }),
        receipt: vi.fn(async (batch: CloudReplicaBatch) => {
            if (!committed) return null;
            expect(batch).toEqual(committed);
            return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq };
        }),
    };
}

async function savedDelivery() {
    const setup = await seed();
    await stageCloudflareDelivery(owner, setup.local.pending, setup.snapshot, setup.control,
        setup.replica, 'batch000000009911', adk, () => true);
    return setup;
}

function changedRemote(setup: Awaited<ReturnType<typeof seed>>) {
    const now = Date.now();
    const control: CloudReplicaControlSnapshot = {
        ...setup.control, revision: 2,
        replicas: {
            ...setup.control.replicas,
            s01: {
                replicaId: 'other-cloud-writer', generation: 1, status: 'active',
                lastSeq: 1, checkpointClock: { s01: 1 }, checkpointAtMs: now,
                leaseUntilMs: now + 86400000,
            },
        },
    };
    const remoteDocument = sealCloudDocument(adk, owner.slice(5), '', {
        profile: { height: '168' },
    }, {
        protocolVersion: 3, clock: { s01: 1 }, fields: {},
        writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
            seq: 1, consentRevision: 1 },
    });
    const scan: CloudReplicaCompleteScan = {
        revision: 2, fenceEpoch: 5, consentRevision: 1,
        documents: [{ path: '', revision: 2, document: remoteDocument }],
    };
    return { control, scan };
}

describe('isolated CF-04 journal orchestrator', () => {
    it('stages an encrypted causal prefix then requires a matching receipt for the local ACK', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        const result = await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true);
        expect(result).toBe('acknowledged');
        expect(remote.control).toHaveBeenCalledOnce();
        expect(remote.read).toHaveBeenCalledWith(['']);
        expect(remote.receipt).toHaveBeenCalledTimes(2);
        expect(remote.commit).toHaveBeenCalledOnce();
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toEqual([]);
        expect(saved.cloudflareDelivery).toBeUndefined();
        expect(saved.data.profile?.height).toBe('171');
        expect(saved.syncMetaByDocument[''].clock).toEqual({ s00: 1 });
    });

    it('recovers an existing immutable intent before fetching a new snapshot', async () => {
        const { control, snapshot, local, replica } = await seed();
        await stageCloudflareDelivery(owner, local.pending, snapshot, control, replica,
            'batch000000000251', adk, () => true);
        const before = (await readLocal(owner))!.cloudflareDelivery!.batch;
        const remote = transport(control, snapshot);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.read).not.toHaveBeenCalled();
        expect(remote.commit.mock.calls[0][0]).toEqual(before);
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('keeps staged ciphertext and operations when remote delivery is ambiguous', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        remote.commit.mockImplementation(async () => { throw new Error('ambiguous remote timeout'); });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('ambiguous remote timeout');
        const pending = (await readLocal(owner))!;
        const savedBatch = structuredClone(pending.cloudflareDelivery!.batch);
        expect(pending.pending).toHaveLength(1);
        expect(await get(storeKey)).toBeDefined();

        const recover = {
            control: vi.fn(async () => { throw new Error('unexpected control fetch'); }),
            read: vi.fn(async () => { throw new Error('unexpected snapshot fetch'); }),
            scanAll: vi.fn(async () => { throw new Error('unexpected full scan'); }),
            commitOutcome: vi.fn(async () => { throw new Error('unexpected status check'); }),
            commit: vi.fn(async () => { throw new Error('unexpected reseal or resend'); }),
            receipt: vi.fn(async (batch: CloudReplicaBatch) => {
                expect(batch).toEqual(savedBatch);
                return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq };
            }),
        };
        expect(await deliverCloudflareJournalCandidate(owner, adk, recover, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(recover.control).not.toHaveBeenCalled();
        expect(recover.read).not.toHaveBeenCalled();
        expect(recover.commit).not.toHaveBeenCalled();
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('never stages a stale or conflicting D1 control/document revision', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, { ...snapshot, revision: 1 });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow();
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
        expect((await readLocal(owner))!.pending).toHaveLength(1);
    });

    it('aborts after a changed session during a remote read, before any IndexedDB staging', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, snapshot);
        let current = true;
        remote.read.mockImplementation(async () => {
            current = false;
            return snapshot;
        });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => current))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('fails closed without CSRF or with a guest, without contacting D1', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        const before = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, '', () => true))
            .rejects.toThrow('non validi');
        await expect(deliverCloudflareJournalCandidate('guest', adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('non validi');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.read).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('does not turn an already empty account journal into a cloud commit', async () => {
        await initializeLocal(owner, profile(170));
        const remote = transport({ revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            { revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('idle');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
    });
    it('rebases a provably uncommitted 409 only after full AEAD scan and two stable controls', async () => {
        const setup = await savedDelivery();
        const before = (await readLocal(owner))!.cloudflareDelivery!.batch;
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);

        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('retry-staged');
        expect(remote.commitOutcome).toHaveBeenCalledWith(before, 'csrf-session');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.commit).toHaveBeenCalledOnce();
        const after = (await readLocal(owner))!;
        const replacement = after.cloudflareDelivery!.batch;
        expect(after.pending).toEqual(setup.local.pending);
        expect(replacement.batchId).not.toBe(before.batchId);
        expect(replacement.expectedRevision).toBe(2);
        expect(replacement.expectedFenceEpoch).toBe(5);
        expect(replacement.documents[0].document._sealed)
            .not.toEqual(before.documents[0].document._sealed);
        const opened = readAccountCloudDocument(replacement.documents[0].document,
            'CF04 candidate rebase regression', owner.slice(5), '', adk);
        expect(parseSyncMeta(opened.sync).clock.s01).toBe(1);

        // A second invocation replays the persisted replacement and does not
        // scan, reseal, or infer a prior successful acknowledgement.
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(remote.commit.mock.calls[1][0]).toEqual(replacement);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('preserves new edits made by another tab during recovery', async () => {
        const setup = await savedDelivery();
        const oldIntent = (await readLocal(owner))!.cloudflareDelivery;
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockImplementationOnce(async () => {
            await commitLocal(owner, profile(172), profile(171));
            return scan;
        });
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toHaveLength(2);
        expect(saved.pending[0]).toEqual(oldIntent!.operations[0]);
        expect(saved.data.profile?.height).toBe('172');
        expect(saved.cloudflareDelivery?.operations).toEqual(oldIntent?.operations);
        expect(saved.cloudflareDelivery?.batch.batchId).not.toBe(oldIntent?.batch.batchId);
        expect(remote.commit).toHaveBeenCalledOnce();
    });

    it('does not rotate after inconclusive or committed historical status', async () => {
        const setup = await savedDelivery();
        const before = await get(storeKey);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'inconclusive', currentRevision: 0 })
            .mockResolvedValueOnce({ outcome: 'committed', currentRevision: 1 });
        for (let index = 0; index < 2; index += 1) {
            expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
                .toBe('reconciliation-required');
            expect(await get(storeKey)).toBe(before);
        }
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
    });

    it('rejects mismatched revision or advanced same-actor sequence before scanning', async () => {
        const setup = await savedDelivery();
        const { control } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 3 });
        remote.control.mockResolvedValue(control);
        const bytes = await get(storeKey);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(await get(storeKey)).toBe(bytes);
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue({
            ...control, replicas: {
                ...control.replicas, s00: { ...control.replicas.s00, lastSeq: 1 },
            },
        });
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(bytes);
    });

    it('rejects tampered AEAD on an unrelated cloud document, preserving original intent', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        const wrongKey = new Uint8Array(32).fill(99);
        const forged = sealCloudDocument(wrongKey, owner.slice(5), 'nutrition_months/2026-11',
            { '2026-11-14': { date: '2026-11-14', weight: 77 } },
            { protocolVersion: 3, clock: { s01: 1 }, fields: {},
                writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                    seq: 1, consentRevision: 1 } });
        remote.scanAll.mockResolvedValue({ ...scan, documents: [...scan.documents, {
            path: 'nutrition_months/2026-11', revision: 2, document: forged,
        }] });
        const before = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow();
        expect(await get(storeKey)).toBe(before);
        expect(remote.control).toHaveBeenCalledTimes(1);
    });

    it('rejects an unstable replica register after the authenticated scan', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({
            ...control, revision: 3,
        });
        remote.scanAll.mockResolvedValue(scan);
        const original = await get(storeKey);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storeKey)).toBe(original);
    });

    it('invalidates recovery when the Auth epoch changes while the remote scan is in flight', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        let active = true;
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockImplementationOnce(async () => {
            active = false;
            return scan;
        });
        const original = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => active))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(await get(storeKey)).toBe(original);
    });

});
