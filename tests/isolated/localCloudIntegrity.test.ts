import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import * as indexedDb from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Native ESM exports cannot be spied on. Ordinary calls still use real
// IndexedDB; the wrapper only queues a transaction or injects an I/O failure.
vi.mock('idb-keyval', async importOriginal => {
    const actual = await importOriginal<typeof import('idb-keyval')>();
    return { ...actual, update: vi.fn(actual.update) };
});

import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import {
    adoptReplicaCheckpoint, commitLocal, initializeLocal, readLocal,
    markCloudIntegrityBlocked, completeCloudIntegrityRecovery, markReplicaCheckpointRequired,
} from '../../src/lib/sync/localRepository';
import { fenceCloudIntegrity } from '../../src/lib/sync/localCloudIntegrity';
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import type { ReplicaIdentity } from '../../src/lib/sync/replicaProtocol';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';
import { LocalCiphertextError } from '../../src/lib/sync/secureArchiveCipher';

const now = Date.UTC(2026, 10, 7);
const key = 'logbook:v2:user:a';
const data = (height: number): UserData =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
const identity = (): ReplicaIdentity => ({
    slot: 's00', replicaId: 'integrity-test', generation: 1,
    checkpointAtMs: now - 10_000, leaseUntilMs: now + 10_000,
});

beforeEach(async () => {
    const actual = await vi.importActual<typeof import('idb-keyval')>('idb-keyval');
    vi.mocked(indexedDb.update).mockReset().mockImplementation(actual.update);
    lockAllVaults();
    localStorage.clear();
    await clear();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    await createAndMigrateVault('user:a');
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function pendingArchive(withReplica = true): Promise<LocalEnvelope> {
    await initializeLocal('a', data(170), ['2026-11']);
    if (withReplica) {
        await adoptReplicaCheckpoint('a', { identity: identity(), baseSeq: 0 }, {
            clock: {}, syncMetaByDocument: {},
        });
    }
    await commitLocal('a', data(171), data(170));
    const durable = (await readLocal('a'))!;
    expect(durable.pending.length).toBeGreaterThan(0);
    return durable;
}

async function renewReplica(): Promise<void> {
    const current = (await readLocal('a'))!;
    await adoptReplicaCheckpoint('a', { identity: identity(), baseSeq: current.actorSeq }, {
        clock: current.clock, syncMetaByDocument: current.syncMetaByDocument,
    });
}

async function pauseNextUpdate(): Promise<() => void> {
    const actual = await vi.importActual<typeof import('idb-keyval')>('idb-keyval');
    let release: () => void = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(indexedDb.update).mockImplementationOnce(async (storageKey, updater, store) => {
        await wait;
        return actual.update(storageKey, updater, store);
    });
    return release;
}

const mutations = ['block', 'checkpoint', 'recover'] as const;
function mutate(kind: typeof mutations[number], guard?: () => boolean): Promise<unknown> {
    if (kind === 'block') return markCloudIntegrityBlocked('a', guard);
    if (kind === 'checkpoint') return markReplicaCheckpointRequired('a', identity(), guard);
    return completeCloudIntegrityRecovery('a', null, false, guard);
}

describe('durable cloud integrity fencing and recovery', () => {
    it.each([false, true])('builds a pure fence and expires only replica membership (replica=%s)', async withReplica => {
        const original = await pendingArchive(withReplica);
        const snapshot = structuredClone(original);
        const fenced = fenceCloudIntegrity(original);
        const repeated = fenceCloudIntegrity(fenced);

        expect(fenced).toEqual({
            ...snapshot, cloudIntegrityFence: expect.any(String), revision: snapshot.revision + 1,
            replica: snapshot.replica ? { ...snapshot.replica, checkpointAtMs: 1, leaseUntilMs: 1 } : null,
        });
        expect(fenced.cloudIntegrityFence).toMatch(/^cloud-fence/);
        expect(repeated.cloudIntegrityFence).not.toBe(fenced.cloudIntegrityFence);
        expect(repeated.revision).toBe(snapshot.revision + 2);
        expect(original).toEqual(snapshot);
        expect(await readLocal('a')).toEqual(snapshot);
    });

    it('persists a fresh fence without changing either owner\'s business data or journal', async () => {
        const before = await pendingArchive();
        await createAndMigrateVault('user:b');
        await initializeLocal('b', data(180));
        const other = await get('logbook:v2:user:b');

        await markCloudIntegrityBlocked('user:a', () => true);
        const fenced = (await readLocal('a'))!;
        expect(fenced).toEqual({
            ...before, cloudIntegrityFence: expect.any(String), revision: before.revision + 1,
            replica: { ...before.replica, checkpointAtMs: 1, leaseUntilMs: 1 },
        });
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
        await markCloudIntegrityBlocked('a');
        const repeated = (await readLocal('a'))!;
        expect(repeated.cloudIntegrityFence).not.toBe(fenced.cloudIntegrityFence);
        expect(repeated.revision).toBe(fenced.revision + 1);
        expect(repeated.pending).toEqual(before.pending);
        expect(await get('logbook:v2:user:b')).toBe(other);
    });

    it.each([...mutations, 'recover-fenced'] as const)(
        'rejects a session invalidated while the %s transaction is queued', async kind => {
            await pendingArchive();
            if (kind === 'recover-fenced') {
                await markCloudIntegrityBlocked('a');
                await renewReplica();
            }
            const durable = (await readLocal('a'))!;
            const ciphertext = await get(key);
            const release = await pauseNextUpdate();
            let current = true;
            const work = kind === 'recover-fenced'
                ? completeCloudIntegrityRecovery('a', durable.cloudIntegrityFence!, true, () => current)
                : mutate(kind, () => current);
            current = false;
            release();

            await expect(work).rejects.toThrow('cambio sessione');
            expect(await get(key)).toBe(ciphertext);
            expect(await readLocal('a')).toEqual(durable);
        },
    );

    it.each([
        { label: 'incomplete checkpoint with a live replica', full: false, replica: true, lease: now + 1 },
        { label: 'missing replica after a full scan', full: true, replica: false, lease: now + 1 },
        { label: 'expired replica', full: true, replica: true, lease: now - 1 },
        { label: 'replica expiring exactly now', full: true, replica: true, lease: now },
    ])('keeps the fence for $label', async ({ full, replica, lease }) => {
        await pendingArchive(replica);
        await markCloudIntegrityBlocked('a');
        if (replica) {
            await renewReplica();
            await updateArchiveRecord<LocalEnvelope>('user:a', current => ({
                ...current!, replica: { ...current!.replica!, leaseUntilMs: lease },
            }));
        }
        const before = (await readLocal('a'))!;
        const ciphertext = await get(key);

        await expect(completeCloudIntegrityRecovery('a', before.cloudIntegrityFence!, full))
            .rejects.toMatchObject({ code: 'replica-fenced', message: expect.stringMatching(/\S/) });
        expect(await get(key)).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);
    });

    it('clears only the verified fence with a live checkpoint and retains the entire pending journal', async () => {
        await pendingArchive();
        await markCloudIntegrityBlocked('a');
        await renewReplica();
        await updateArchiveRecord<LocalEnvelope>('user:a', current => ({
            ...current!, replica: { ...current!.replica!, leaseUntilMs: now + 1 },
        }));
        const before = (await readLocal('a'))!;
        const recovered = await completeCloudIntegrityRecovery('user:a', before.cloudIntegrityFence!, true, () => true);

        expect(recovered).toEqual({ ...before, cloudIntegrityFence: undefined, revision: before.revision + 1 });
        expect(await readLocal('a')).toEqual(recovered);
    });

    it.each([false, true])('does not invent a fence or checkpoint when no recovery is needed (full=%s)', async full => {
        const before = await pendingArchive(false);
        const recovered = await completeCloudIntegrityRecovery('a', null, full);
        expect(recovered).toEqual(before);
        expect(await readLocal('a')).toEqual(before);
    });

    it.each(['missing-observation', 'wrong-token', 'already-cleared'] as const)(
        'rejects a mismatched fence (%s) without rewriting ciphertext', async kind => {
            await pendingArchive();
            if (kind !== 'already-cleared') await markCloudIntegrityBlocked('a');
            const before = (await readLocal('a'))!;
            const ciphertext = await get(key);
            const expected = kind === 'missing-observation' ? null : 'earlier-cloud-fence';

            await expect(completeCloudIntegrityRecovery('a', expected, true))
                .rejects.toMatchObject({ code: 'replica-fenced', message: expect.stringMatching(/\S/) });
            expect(await get(key)).toBe(ciphertext);
            expect(await readLocal('a')).toEqual(before);
        },
    );

    it('rejects an old observation when another tab installs a new fence before the queued recovery', async () => {
        await pendingArchive();
        await markCloudIntegrityBlocked('a');
        await renewReplica();
        const observed = (await readLocal('a'))!;
        const release = await pauseNextUpdate();
        const work = completeCloudIntegrityRecovery('a', observed.cloudIntegrityFence!, true);
        await commitLocal('a', data(172), observed.data);
        await markCloudIntegrityBlocked('a');
        await renewReplica();
        const latest = (await readLocal('a'))!;
        const ciphertext = await get(key);
        release();

        await expect(work).rejects.toMatchObject({ code: 'replica-fenced', message: expect.stringMatching(/\S/) });
        expect(latest.cloudIntegrityFence).not.toBe(observed.cloudIntegrityFence);
        expect(await get(key)).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(latest);
    });

    it('recovers the current journal, including an edit committed while recovery was queued', async () => {
        await pendingArchive();
        await markCloudIntegrityBlocked('a');
        await renewReplica();
        const observed = (await readLocal('a'))!;
        const release = await pauseNextUpdate();
        const work = completeCloudIntegrityRecovery('a', observed.cloudIntegrityFence!, true);
        await commitLocal('a', data(172), observed.data);
        const latest = (await readLocal('a'))!;
        release();

        const recovered = await work;
        expect(recovered).toEqual({ ...latest, cloudIntegrityFence: undefined, revision: latest.revision + 1 });
        expect(recovered.data.profile?.height).toBe('172');
        expect(recovered.actorSeq).toBeGreaterThan(observed.actorSeq);
        expect(await readLocal('a')).toEqual(recovered);
    });

    it.each([
        { slot: 's01' }, { replicaId: 'replacement' }, { generation: 2 },
    ])('ignores a checkpoint request for an independently mismatched identity %j', async mismatch => {
        const before = await pendingArchive();
        await markReplicaCheckpointRequired('a', { ...identity(), ...mismatch });
        expect(await readLocal('a')).toEqual(before);
    });

    it.each([false, true])('expires the matching replica without changing causality (explicit identity=%s)', async explicit => {
        const before = await pendingArchive();
        await markReplicaCheckpointRequired('user:a', explicit ? identity() : undefined, () => true);
        expect(await readLocal('a')).toEqual({
            ...before, revision: before.revision + 1,
            replica: { ...before.replica, checkpointAtMs: 1, leaseUntilMs: 1 },
        });
    });

    it('leaves an archive without a replica intact when a checkpoint is requested', async () => {
        const before = await pendingArchive(false);
        await markReplicaCheckpointRequired('a', identity());
        expect(await readLocal('a')).toEqual(before);
    });

    it.each(mutations)('preserves an absent archive during %s', async kind => {
        if (kind === 'checkpoint') await mutate(kind);
        else await expect(mutate(kind)).rejects.toThrow('Archivio locale non disponibile');
        expect(await get(key)).toBeUndefined();
        expect(await readLocal('a')).toBeUndefined();
    });

    it.each(mutations)('preserves unauthenticated ciphertext during %s', async kind => {
        const corrupt = 'tlb-sealed:v1:invalid-fixture';
        await set(key, corrupt);
        await expect(mutate(kind)).rejects.toThrow(LocalCiphertextError);
        expect(await get(key)).toBe(corrupt);
    });

    it.each(mutations)('rejects an authenticated malformed envelope during %s', async kind => {
        const before = await pendingArchive();
        await updateArchiveRecord<unknown>('user:a', () => ({ ...before, revision: -1 }));
        const ciphertext = await get(key);
        await expect(mutate(kind)).rejects.toThrow('Revisione locale non valida');
        expect(await get(key)).toBe(ciphertext);
    });

    it('propagates an IndexedDB failure, preserves the journal, and permits a later retry', async () => {
        const before = await pendingArchive();
        const ciphertext = await get(key);
        const failure = new Error('IndexedDB transaction unavailable');
        vi.mocked(indexedDb.update).mockRejectedValueOnce(failure);

        await expect(markCloudIntegrityBlocked('a')).rejects.toBe(failure);
        expect(await get(key)).toBe(ciphertext);
        expect(await readLocal('a')).toEqual(before);

        await markCloudIntegrityBlocked('a');
        const recovered = (await readLocal('a'))!;
        expect(recovered.pending).toEqual(before.pending);
        expect(recovered.cloudIntegrityFence).toEqual(expect.any(String));
        expect(recovered.revision).toBe(before.revision + 1);
    });
});
