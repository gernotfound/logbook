import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { UserDataSchema } from '../../src/lib/schema';
import type { CachedGlobalCatalog, UserData } from '../../src/types';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';
import { initializeLocal, readLocal } from '../../src/lib/sync/localArchiveBootstrap';
import { commitDomainOperations } from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { LocalVaultLockedError, lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';
import { beginLocalPurge, cancelUnstartedLocalPurge, LocalPurgePendingError } from '../../src/lib/sync/localPurgeFence';
import { rememberAuthenticatedOwner } from '../../src/lib/sync/authOwnerHint';
import { activateGuestSession, captureSessionForOwner, GUEST_SESSION_KEY, invalidateSession, isCurrentSession } from '../../src/lib/sync/session';

const owner = 'user:archive-bootstrap';
const key = 'logbook:v2:' + owner;
const state = (height: string): UserData => UserDataSchema.parse({
    profile: { height },
    history: [{ id: 'bootstrap-workout', date: '2026-11-09', routineName: 'seed', exercises: [] }],
}) as unknown as UserData;
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'archive-bootstrap-diagnostic', updatedAt: '2026-11-09T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    await clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
});
afterEach(() => {
    lockAllVaults();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function snapshot(): Promise<LocalEnvelope> {
    const saved = await readLocal(owner);
    if (!saved) throw new Error('Missing diagnostic bootstrap envelope');
    return saved;
}

describe('diagnostic encrypted archive bootstrap', () => {
    it('creates the first complete account envelope from a detached seed in the canonical owner namespace', async () => {
        expect(await readLocal('archive-bootstrap')).toBeUndefined();
        localStorage.setItem(key + ':health-consent-generation', '4');
        const input = state('170');
        const expected = structuredClone(input);
        const months = ['2026-11', '2026-10'];
        const saving = initializeLocal('archive-bootstrap', input, months, () => true);
        input.profile!.height = '199';
        input.history![0].routineName = 'late-memory-edit';
        await saving;

        const saved = await snapshot();
        expect(saved).toEqual({
            version: CURRENT_LOCAL_ENVELOPE,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            consentRevision: 4,
            owner,
            actorId: expect.any(String),
            actorSeq: 0,
            clock: {},
            data: expected,
            baseline: expected,
            completeMonths: months,
            pending: [],
            syncMetaByDocument: {},
            replica: null,
            revision: 0,
        });
        expect(saved.actorId.trim()).not.toBe('');
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
        expect(await get('logbook:v2:archive-bootstrap')).toBeUndefined();
        expect(await readLocal('archive-bootstrap')).toEqual(saved);
    });

    it('creates a separate guest envelope without inheriting an account generation or a cloud journal', async () => {
        const generation = 'bootstrap-guest-session';
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, generation);
        activateGuestSession(generation);
        localStorage.setItem(key + ':health-consent-generation', '4');
        await createAndMigrateVault('guest');
        const input = state('175');
        await initializeLocal('guest', input, undefined, () => true);
        const guest = await readLocal('guest');
        expect(guest?.owner).toBe('guest');
        expect(guest?.consentRevision).toBeUndefined();
        expect(guest?.completeMonths).toEqual([]);
        expect(guest?.pending).toEqual([]);
        expect(guest?.data).toEqual(input);
        expect(guest?.baseline).toEqual(input);
        expect(await get('logbook:v2:guest')).toMatch(/^tlb-sealed:v1:/);
        expect(await get(key)).toBeUndefined();
    });

    it('keeps account reads and first seeds isolated across two real owner vaults', async () => {
        await initializeLocal(owner, state('170'));
        const first = await snapshot();
        const ciphertext = await get(key);
        const other = 'user:bootstrap-other';
        await createAndMigrateVault(other);
        expect(await readLocal(other)).toBeUndefined();
        await initializeLocal('bootstrap-other', state('185'));
        const second = await readLocal(other);
        expect(second?.owner).toBe(other);
        expect(second?.data.profile?.height).toBe('185');
        expect(second?.actorId).not.toBe(first.actorId);
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(first);
    });

    it('retains the exact ciphertext, pending journal and metadata when a stale seed arrives', async () => {
        const initial = state('170');
        await initializeLocal(owner, initial, ['2026-11']);
        await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '180' } }, initial);
        const before = await snapshot();
        expect(before.pending.length).toBeGreaterThan(0);
        const ciphertext = await get(key);
        await initializeLocal(owner, state('199'), ['2026-10'], () => true);
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('lets the first actual IndexedDB transaction win when two initializers observe no envelope', async () => {
        const seeds = { first: state('170'), second: state('185') };
        const observed: Array<keyof typeof seeds> = [];
        await Promise.all([
            initializeLocal(owner, seeds.first, ['2026-11'], () => { observed.push('first'); return true; }),
            initializeLocal(owner, seeds.second, ['2026-10'], () => { observed.push('second'); return true; }),
        ]);
        expect(observed).toHaveLength(2);
        const winner = observed[0]!;
        const saved = await snapshot();
        expect(saved.data).toEqual(seeds[winner]);
        expect(saved.baseline).toEqual(seeds[winner]);
        expect(saved.completeMonths).toEqual(winner === 'first' ? ['2026-11'] : ['2026-10']);
        expect(saved.revision).toBe(0);
        expect(saved.actorSeq).toBe(0);
        expect(saved.pending).toEqual([]);
    });

    it.each([false, true])('rejects a replaced session epoch after the IndexedDB wait with existing=%s', async existing => {
        if (existing) await initializeLocal(owner, state('170'));
        const before = await readLocal(owner);
        const ciphertext = await get(key);
        rememberAuthenticatedOwner(owner.slice(5));
        const session = captureSessionForOwner(owner);
        expect(isCurrentSession(session)).toBe(true);
        const originalGet = IDBObjectStore.prototype.get;
        const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (
            this: IDBObjectStore, query: IDBValidKey | IDBKeyRange,
        ) {
            invalidateSession();
            return originalGet.call(this, query);
        });
        await expect(initializeLocal(owner, state('199'), undefined, () => isCurrentSession(session)))
            .rejects.toThrow('Inizializzazione locale invalidata dal cambio sessione');
        read.mockRestore();
        expect(await get(key)).toBe(ciphertext);
        expect(await readLocal(owner)).toEqual(before);

        const current = captureSessionForOwner(owner);
        await initializeLocal(owner, state('180'), undefined, () => isCurrentSession(current));
        expect((await snapshot()).data.profile?.height).toBe(existing ? '170' : '180');
    });

    it('leaves no partial envelope on quota failure and retries at the initial revision', async () => {
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        await expect(initializeLocal(owner, state('170'))).rejects.toThrow('quota');
        put.mockRestore();
        expect(await get(key)).toBeUndefined();
        expect(await readLocal(owner)).toBeUndefined();
        await initializeLocal(owner, state('170'));
        const saved = await snapshot();
        expect(saved.revision).toBe(0);
        expect(saved.actorSeq).toBe(0);
        expect(saved.pending).toEqual([]);
        expect(saved.data.profile?.height).toBe('170');
        expect(saved.baseline).toEqual(saved.data);
    });

    it('propagates an IndexedDB read failure instead of treating the owner archive as absent', async () => {
        await initializeLocal(owner, state('170'));
        const ciphertext = await get(key);
        const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
            throw new DOMException('read unavailable', 'UnknownError');
        });
        await expect(readLocal(owner)).rejects.toThrow('read unavailable');
        read.mockRestore();
        expect(await get(key)).toBe(ciphertext);
        expect((await snapshot()).data.profile?.height).toBe('170');
    });

    it('does not read or replace ciphertext while its vault is locked', async () => {
        await initializeLocal(owner, state('170'));
        const ciphertext = await get(key);
        lockAllVaults();
        await expect(readLocal(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        await expect(initializeLocal(owner, state('199'))).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get(key)).toBe(ciphertext);
    });

    it('propagates an owner purge fence without replacing the archive and resumes after cancellation', async () => {
        await initializeLocal(owner, state('170'));
        const before = await snapshot();
        const ciphertext = await get(key);
        beginLocalPurge(owner);
        await expect(readLocal(owner)).rejects.toBeInstanceOf(LocalPurgePendingError);
        await expect(initializeLocal(owner, state('199'))).rejects.toBeInstanceOf(LocalPurgePendingError);
        expect(await get(key)).toBe(ciphertext);
        cancelUnstartedLocalPurge(owner);
        expect(await snapshot()).toEqual(before);
    });

    it.each(['future-version', 'wrong-owner'] as const)('preserves an authenticated %s envelope on read and bootstrap failure', async kind => {
        await initializeLocal(owner, state('170'));
        const valid = await snapshot();
        await updateArchiveRecord<unknown>(owner, () => ({
            ...valid,
            ...(kind === 'future-version' ? { version: CURRENT_LOCAL_ENVELOPE + 1 } : { owner: 'user:someone-else' }),
        }));
        const ciphertext = await get(key);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        await expect(readLocal(owner)).rejects.toThrow();
        await expect(initializeLocal(owner, state('199'))).rejects.toThrow();
        expect(await get(key)).toBe(ciphertext);
    });
});
