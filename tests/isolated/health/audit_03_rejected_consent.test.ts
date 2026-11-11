import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get } from 'idb-keyval';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { UserDataSchema } from '../../../src/lib/schema';
import type { CachedGlobalCatalog, LegalConsent, UserData } from '../../../src/types';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'audit-consent',
        updatedAt: '2026-10-03T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: vi.fn(async () => catalog),
}));

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;
const consent = (acceptedAt: string): LegalConsent => ({
    hasAcceptedTerms: true,
    hasAcceptedHealthData: true,
    acceptedAt,
    privacyVersion: LEGAL_VERSIONS.privacy,
    termsVersion: LEGAL_VERSIONS.terms,
});

async function confirmConsentJournal(): Promise<void> {
    const { adoptReplicaCheckpoint, acknowledgeThrough, readLocal } =
        await import('../../../src/lib/sync/localRepository');
    const now = Date.now();
    await adoptReplicaCheckpoint('user:a', {
        identity: { slot: 's00', replicaId: 'consent-ack-fixture', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 31_104_000_000 },
        baseSeq: 0,
    }, { clock: {}, syncMetaByDocument: {} });
    const sent = await readLocal('user:a');
    if (!sent?.replica || sent.pending.length === 0) throw new Error('Consenso fixture senza prova causale');
    await acknowledgeThrough('user:a', sent.pending.at(-1)!.seq, sent.data, [], undefined, {
        operations: structuredClone(sent.pending), replica: sent.replica,
    });
}

describe('rejected legal-consent durable compensation', () => {
    beforeEach(async () => {
        lockAllVaults();
        localStorage.clear();
        await clear();
        vi.stubGlobal('navigator', {
            locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() },
        });
        await createAndMigrateVault('user:a');
    });
    afterEach(() => {
        lockAllVaults();
        vi.unstubAllGlobals();
    });

    it('retires the rejected legal-consent journal intent in the same durable envelope', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);

        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        const before = await readLocal('user:a');
        expect(before?.data.legalConsent).toEqual(rejected);
        expect(before?.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);

        await revertRejectedConsent('user:a', rejected, undefined, () => true);
        const after = await readLocal('user:a');

        expect(after?.data.legalConsent).toBeUndefined();
        expect(after?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);
        expect(after?.actorSeq).toBe(before?.actorSeq);
        // The rollback changes durable business state and journal; a preview
        // captured before compensation must no longer pass its revision fence.
        expect(after?.revision).toBe((before?.revision ?? 0) + 1);
    });

    it('retires only the rejected consent intent and preserves newer unrelated work', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);

        const first = await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '180' } }, first.data);

        await revertRejectedConsent('user:a', rejected, undefined, () => true);
        const after = await readLocal('user:a');

        expect(after?.data.legalConsent).toBeUndefined();
        expect(after?.data.profile?.height).toBe('180');
        expect(after?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);
        expect(after?.pending.some(op => op.path.join('/') === 'profile/height')).toBe(true);
    });

    it('keeps already-acknowledged consent after a late rejection', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const accepted = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: accepted }, initial);

        const sent = await readLocal('user:a');
        expect(sent?.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);
        await confirmConsentJournal();
        const confirmed = await readLocal('user:a');
        expect(confirmed?.data.legalConsent).toEqual(accepted);
        expect(confirmed?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);

        await revertRejectedConsent('user:a', accepted, undefined, () => true);
        expect(await readLocal('user:a')).toEqual(confirmed);
    });

    it('preserves unrelated pending edits when a late consent rejection finds no consent intent', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const accepted = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: accepted }, initial);
        await confirmConsentJournal();
        const confirmed = await readLocal('user:a');

        await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '180' } }, confirmed!.data);
        const before = await readLocal('user:a');
        expect(before?.pending.some(op => op.path.join('/') === 'profile/height')).toBe(true);
        expect(before?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);

        await revertRejectedConsent('user:a', accepted, undefined, () => true);
        expect(await readLocal('user:a')).toEqual(before);
    });


    it('rechecks the session in the real IndexedDB transaction and preserves the exact ciphertext on cancellation', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);
        const first = await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '180' } }, first.data);
        const before = await readLocal('user:a');
        const key = 'logbook:v2:user:a';
        const encrypted = await get(key);
        expect(encrypted).toMatch(/^tlb-sealed:v1:/);

        let checks = 0;
        await expect(revertRejectedConsent('user:a', rejected, undefined, () => ++checks === 1))
            .rejects.toThrow('Ripristino consenso invalidato dal cambio sessione');
        expect(checks).toBe(2);
        expect(await get(key)).toBe(encrypted);
        expect(await readLocal('user:a')).toEqual(before);

        await revertRejectedConsent('user:a', rejected, undefined, () => true);
        const recovered = await readLocal('user:a');
        expect(recovered?.data.legalConsent).toBeUndefined();
        expect(recovered?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);
        expect(recovered?.data.profile?.height).toBe('180');
        expect(recovered?.pending.filter(op => op.path[0] !== 'legalConsent'))
            .toEqual(before?.pending.filter(op => op.path[0] !== 'legalConsent'));
    });

    it('rejects a stale rollback even when an acknowledged journal would be a no-op', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const accepted = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: accepted }, initial);
        await confirmConsentJournal();
        const confirmed = await readLocal('user:a');
        const key = 'logbook:v2:user:a';
        const encrypted = await get(key);

        let checks = 0;
        await expect(revertRejectedConsent('user:a', accepted, undefined, () => ++checks === 1))
            .rejects.toThrow('Ripristino consenso invalidato dal cambio sessione');
        expect(checks).toBe(2);
        expect(await get(key)).toBe(encrypted);
        expect(await readLocal('user:a')).toEqual(confirmed);
    });

    it('does not roll back a newer consent that replaced the rejected value', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        const newer = consent('2026-10-03T12:05:00.000Z');
        await initializeLocal('user:a', initial);

        const first = await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: newer }, first.data);

        await revertRejectedConsent('user:a', rejected, undefined, () => true);
        const after = await readLocal('user:a');

        expect(after?.data.legalConsent).toEqual(newer);
        expect(after?.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);
    });
});
