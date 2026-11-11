import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { UserDataSchema } from '../../../src/lib/schema';
import type { CachedGlobalCatalog, LegalConsent, UserData } from '../../../src/types';
import {
    advanceLocalConsentRevisionIfClean, ownerConsentRevision, revertRejectedConsent,
} from '../../../src/lib/sync/localConsentReconciliation';
import {
    adoptReplicaCheckpoint, commitDomainOperations, initializeLocal, readLocal,
} from '../../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../../src/lib/sync/localEnvelopeValidation';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { rememberAuthenticatedOwner } from '../../../src/lib/sync/authOwnerHint';
import { captureSessionForOwner, invalidateSession, isCurrentSession } from '../../../src/lib/sync/session';

const owner = 'user:consent-reconciliation';
const key = 'logbook:v2:' + owner;
const generationKey = key + ':health-consent-generation';
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'consent-reconciliation-diagnostic', updatedAt: '2026-11-09T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const state = (input: Record<string, unknown> = {}) => UserDataSchema.parse(input) as unknown as UserData;
const legal = (acceptedAt: string): LegalConsent => ({
    hasAcceptedHealthData: true, hasAcceptedTerms: true, acceptedAt,
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
});
const previousConsent = legal('2026-11-01T10:00:00.000Z');
const rejectedConsent = legal('2026-11-09T10:00:00.000Z');

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function snapshot(): Promise<LocalEnvelope> {
    const value = await readLocal(owner);
    if (!value) throw new Error('Missing diagnostic consent archive');
    return value;
}

async function seed(revision?: number) {
    if (revision !== undefined) localStorage.setItem(generationKey, String(revision));
    await initializeLocal(owner, state({ profile: { height: '170' }, legalConsent: previousConsent }));
    return snapshot();
}

async function rejectedJournal() {
    const initial = await seed(1);
    await commitDomainOperations(owner, [
        { type: 'legal-consent.set', consent: rejectedConsent },
        { type: 'profile.patch', patch: { height: '180' } },
    ], initial.data);
    const before = await snapshot();
    expect(before.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);
    expect(before.pending.some(op => op.path.join('/') === 'profile/height')).toBe(true);
    return before;
}

describe('diagnostic consent generation and durable compensation', () => {
    it.each([1, Number.MAX_SAFE_INTEGER])('stamps canonical positive generation %s during real archive bootstrap', async revision => {
        const saved = await seed(revision);
        expect(saved.consentRevision).toBe(revision);
        expect(ownerConsentRevision(owner)).toEqual({ consentRevision: revision });
        expect(await get(key)).toMatch(/^tlb-sealed:v1:/);
    });

    it('keeps an absent generation distinct and adopts the first trusted revision', async () => {
        const before = await seed();
        expect(before.consentRevision).toBeUndefined();
        expect(ownerConsentRevision(owner)).toEqual({});
        expect(await advanceLocalConsentRevisionIfClean(owner, 1)).toBe(true);
        expect(await snapshot()).toEqual({ ...before, consentRevision: 1, revision: before.revision + 1 });
    });

    it('does not consult account browser storage for a guest revision', () => {
        const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); });
        expect(ownerConsentRevision('guest')).toEqual({});
        expect(read).not.toHaveBeenCalled();
    });

    it.each(['', '0', '-1', '01', '+1', ' 1', '1 ', '1.0', '1e2', 'x1', '1x', '1\n'])(
        'rejects noncanonical generation %j without creating an archive', async raw => {
            localStorage.setItem(generationKey, raw);
            await expect(initializeLocal(owner, state())).rejects.toThrow('Generazione consenso locale non valida');
            expect(await get(key)).toBeUndefined();
            expect(localStorage.getItem(generationKey)).toBe(raw);
        },
    );

    it('rejects an out-of-range numeric marker without stamping it on an archive', async () => {
        const raw = String(Number.MAX_SAFE_INTEGER + 1);
        localStorage.setItem(generationKey, raw);
        await expect(initializeLocal(owner, state())).rejects.toThrow('Generazione consenso fuori limite');
        expect(await get(key)).toBeUndefined();
        expect(localStorage.getItem(generationKey)).toBe(raw);
    });

    it('propagates a browser storage failure instead of assuming an absent consent generation', async () => {
        const realRead = localStorage.getItem.bind(localStorage);
        const read = vi.spyOn(localStorage, 'getItem').mockImplementation(name => {
            if (name === generationKey) throw new DOMException('denied', 'SecurityError');
            return realRead(name);
        });
        await expect(initializeLocal(owner, state())).rejects.toThrow();
        expect(await get(key)).toBeUndefined();
        read.mockRestore();
        expect(ownerConsentRevision(owner)).toEqual({});
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid trusted revision %s and preserves the authenticated original', async revision => {
            const before = await seed(1);
            const ciphertext = await get(key);
            await expect(advanceLocalConsentRevisionIfClean(owner, revision, () => true))
                .rejects.toThrow('Generazione consenso non valida');
            expect(await get(key)).toBe(ciphertext);
            expect(await snapshot()).toEqual(before);
        },
    );

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 3, 4])(
        'rejects invalid erasure bound %s before changing data or journal', async erasedBeforeRevision => {
            const before = await seed(1);
            const ciphertext = await get(key);
            await expect(advanceLocalConsentRevisionIfClean(owner, 3, () => true, erasedBeforeRevision))
                .rejects.toThrow('Generazione consenso non valida');
            expect(await get(key)).toBe(ciphertext);
            expect(await snapshot()).toEqual(before);
        },
    );

    it('rejects generation adoption for a guest without accessing an account archive', async () => {
        await expect(advanceLocalConsentRevisionIfClean('guest', 2)).rejects.toThrow('Generazione consenso non valida');
        expect(await get(key)).toBeUndefined();
        expect(await get('logbook:v2:guest')).toBeUndefined();
    });

    it('recognizes a missing archive without fabricating business data or bypassing the transaction guard', async () => {
        await expect(advanceLocalConsentRevisionIfClean(owner, 3, () => false, 1))
            .rejects.toThrow('Sessione cambiata');
        expect(await advanceLocalConsentRevisionIfClean(owner, 3, () => true, 1)).toBe(true);
        expect(await readLocal(owner)).toBeUndefined();
        expect(await get(key)).toBeUndefined();
    });

    it('retires an old replica only on a durable transition and retries a failed put exactly once', async () => {
        await seed(1);
        const now = Date.now();
        await adoptReplicaCheckpoint(owner, {
            identity: { slot: 's00', replicaId: 'consent-old-replica', generation: 1,
                checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 },
            baseSeq: 0,
        }, { clock: {}, syncMetaByDocument: {} });
        const before = await snapshot();
        expect(before.replica?.replicaId).toBe('consent-old-replica');
        const ciphertext = await get(key);
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        await expect(advanceLocalConsentRevisionIfClean(owner, 2, () => true)).rejects.toThrow('quota');
        put.mockRestore();
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);

        expect(await advanceLocalConsentRevisionIfClean(owner, 2, () => true)).toBe(true);
        const after = await snapshot();
        expect(after).toEqual({ ...before, consentRevision: 2, replica: null, revision: before.revision + 1 });
        const committed = await get(key);
        expect(committed).not.toBe(ciphertext);
        expect(await advanceLocalConsentRevisionIfClean(owner, 2, () => true)).toBe(true);
        expect(await get(key)).toBe(committed);
        expect(await snapshot()).toEqual(after);
    });

    it('keeps a pending journal in the same trusted generation byte-identical', async () => {
        const before = await rejectedJournal();
        const ciphertext = await get(key);
        expect(await advanceLocalConsentRevisionIfClean(owner, 1, () => true)).toBe(true);
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('refuses a server generation older than the local archive', async () => {
        const before = await seed(3);
        const ciphertext = await get(key);
        await expect(advanceLocalConsentRevisionIfClean(owner, 2, () => true))
            .rejects.toThrow('Generazione locale più recente del server');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it.each([false, true])('does not relabel erased data even with pending=%s', async pending => {
        const before = pending ? await rejectedJournal() : await seed(1);
        const ciphertext = await get(key);
        expect(await advanceLocalConsentRevisionIfClean(owner, 3, () => true, 1)).toBe('erased');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('treats unmarked existing data as preceding a confirmed erasure', async () => {
        const before = await seed();
        const ciphertext = await get(key);
        expect(await advanceLocalConsentRevisionIfClean(owner, 3, () => true, 1)).toBe('erased');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('adopts a clean generation newer than the erasure bound', async () => {
        const before = await seed(2);
        expect(await advanceLocalConsentRevisionIfClean(owner, 3, () => true, 1)).toBe(true);
        expect(await snapshot()).toEqual({ ...before, consentRevision: 3, replica: null, revision: before.revision + 1 });
    });

    it('checks the session inside a real IndexedDB read before a generation transition', async () => {
        const before = await seed(1);
        const ciphertext = await get(key);
        let current = true;
        const guard = vi.fn(() => current);
        const originalGet = IDBObjectStore.prototype.get;
        const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (
            this: IDBObjectStore, query: IDBValidKey | IDBKeyRange,
        ) {
            current = false;
            return originalGet.call(this, query);
        });
        await expect(advanceLocalConsentRevisionIfClean(owner, 2, guard)).rejects.toThrow('Sessione cambiata');
        read.mockRestore();
        expect(guard).toHaveBeenCalledTimes(1);
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });


    it.each(['adoption', 'rollback'] as const)('invalidates delayed %s after same-owner session epoch replacement', async mode => {
        const before = mode === 'rollback' ? await rejectedJournal() : await seed(1);
        rememberAuthenticatedOwner(owner.slice(5));
        const session = captureSessionForOwner(owner);
        expect(isCurrentSession(session)).toBe(true);
        const ciphertext = await get(key);
        const originalGet = IDBObjectStore.prototype.get;
        const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (
            this: IDBObjectStore, query: IDBValidKey | IDBKeyRange,
        ) {
            invalidateSession();
            return originalGet.call(this, query);
        });
        const transition = mode === 'rollback'
            ? revertRejectedConsent(owner, rejectedConsent, previousConsent, () => isCurrentSession(session))
            : advanceLocalConsentRevisionIfClean(owner, 2, () => isCurrentSession(session));
        await expect(transition).rejects.toThrow(mode === 'rollback'
            ? 'Ripristino consenso invalidato dal cambio sessione' : 'Sessione cambiata');
        read.mockRestore();
        expect(isCurrentSession(session)).toBe(false);
        expect(isCurrentSession(captureSessionForOwner(owner))).toBe(true);
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('sees a concurrent journal commit queued before generation adoption', async () => {
        const initial = await seed(1);
        let entered!: () => void;
        const reading = new Promise<void>(resolve => { entered = resolve; });
        const originalGet = IDBObjectStore.prototype.get;
        const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (
            this: IDBObjectStore, query: IDBValidKey | IDBKeyRange,
        ) {
            const request = originalGet.call(this, query);
            entered();
            return request;
        });
        const commit = commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '180' } }, initial.data);
        await reading;
        read.mockRestore();
        const adoption = advanceLocalConsentRevisionIfClean(owner, 2, () => true);
        await commit;
        const committed = await snapshot();
        const ciphertext = await get(key);
        expect(await adoption).toBe(false);
        expect(committed.pending.length).toBeGreaterThan(0);
        expect(committed.data.profile?.height).toBe('180');
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(committed);
    });

    it('rejects a stale rollback before any IndexedDB access', async () => {
        const before = await rejectedJournal();
        const ciphertext = await get(key);
        const read = vi.spyOn(IDBObjectStore.prototype, 'get');
        await expect(revertRejectedConsent(owner, rejectedConsent, previousConsent, () => false))
            .rejects.toThrow('Ripristino consenso invalidato dal cambio sessione');
        expect(read).not.toHaveBeenCalled();
        read.mockRestore();
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
    });

    it('keeps rollback of an absent archive a no-op', async () => {
        await revertRejectedConsent(owner, rejectedConsent, previousConsent, () => true);
        expect(await readLocal(owner)).toBeUndefined();
        expect(await get(key)).toBeUndefined();
    });

    it('rolls back only the latest consent sequence and retains older consent plus unrelated operations in that same sequence', async () => {
        const first = await rejectedJournal();
        const latest = legal('2026-11-09T10:05:00.000Z');
        await commitDomainOperations(owner, [
            { type: 'legal-consent.set', consent: latest },
            { type: 'profile.patch', patch: { height: '185' } },
        ], first.data);
        const before = await snapshot();
        const latestSeq = before.actorSeq;
        expect(latestSeq).toBeGreaterThan(first.actorSeq);
        expect(before.pending.some(op => op.seq === latestSeq && op.path.join('/') === 'profile/height')).toBe(true);
        await revertRejectedConsent(owner, latest, rejectedConsent, () => true);
        expect(await snapshot()).toEqual({
            ...before,
            data: state({ ...before.data, legalConsent: rejectedConsent }),
            pending: before.pending.filter(op => !(op.path[0] === 'legalConsent' && op.seq === latestSeq)),
            revision: before.revision + 1,
        });
    });

    it('preserves the full ciphertext and journal on rollback quota failure and then recovers', async () => {
        const before = await rejectedJournal();
        const ciphertext = await get(key);
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        await expect(revertRejectedConsent(owner, rejectedConsent, previousConsent, () => true)).rejects.toThrow('quota');
        put.mockRestore();
        expect(await get(key)).toBe(ciphertext);
        expect(await snapshot()).toEqual(before);
        await revertRejectedConsent(owner, rejectedConsent, previousConsent, () => true);
        expect(await snapshot()).toEqual({
            ...before,
            data: state({ ...before.data, legalConsent: previousConsent }),
            pending: before.pending.filter(op => op.path[0] !== 'legalConsent'),
            revision: before.revision + 1,
        });
    });

    it('rejects a corrupt authenticated envelope on both transitions without overwriting its evidence', async () => {
        const valid = await rejectedJournal();
        await updateArchiveRecord<unknown>(owner, () => ({ ...valid, revision: -1 }));
        const ciphertext = await get(key);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        await expect(advanceLocalConsentRevisionIfClean(owner, 2, () => true)).rejects.toThrow('Revisione locale non valida');
        await expect(revertRejectedConsent(owner, rejectedConsent, previousConsent, () => true))
            .rejects.toThrow('Revisione locale non valida');
        expect(await get(key)).toBe(ciphertext);
    });
});
