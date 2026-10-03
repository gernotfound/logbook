import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { CachedGlobalCatalog, LegalConsent, UserData } from '../../src/types';

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

vi.mock('../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: vi.fn(async () => catalog),
}));

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;
const consent = (acceptedAt: string): LegalConsent => ({
    hasAcceptedTerms: true,
    hasAcceptedHealthData: true,
    acceptedAt,
    privacyVersion: '1.3.1',
    termsVersion: '1.2.0',
});

describe('rejected legal-consent durable compensation', () => {
    beforeEach(async () => {
        await clear();
    });

    it('retires the rejected legal-consent journal intent in the same durable envelope', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);

        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        const before = await readLocal('user:a');
        expect(before?.data.legalConsent).toEqual(rejected);
        expect(before?.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);

        await revertRejectedConsent('user:a', rejected, undefined);
        const after = await readLocal('user:a');

        expect(after?.data.legalConsent).toBeUndefined();
        expect(after?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);
        expect(after?.actorSeq).toBe(before?.actorSeq);
        expect(after?.revision).toBe(before?.revision);
    });

    it('retires only the rejected consent intent and preserves newer unrelated work', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        await initializeLocal('user:a', initial);

        const first = await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '180' } }, first.data);

        await revertRejectedConsent('user:a', rejected, undefined);
        const after = await readLocal('user:a');

        expect(after?.data.legalConsent).toBeUndefined();
        expect(after?.data.profile?.height).toBe('180');
        expect(after?.pending.some(op => op.path[0] === 'legalConsent')).toBe(false);
        expect(after?.pending.some(op => op.path.join('/') === 'profile/height')).toBe(true);
    });

    it('does not roll back a newer consent that replaced the rejected value', async () => {
        const { initializeLocal, commitDomainOperations, revertRejectedConsent, readLocal } =
            await import('../../src/lib/sync/localRepository');
        const initial = parse({});
        const rejected = consent('2026-10-03T12:00:00.000Z');
        const newer = consent('2026-10-03T12:05:00.000Z');
        await initializeLocal('user:a', initial);

        const first = await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: rejected }, initial);
        await commitDomainOperations('user:a', { type: 'legal-consent.set', consent: newer }, first.data);

        await revertRejectedConsent('user:a', rejected, undefined);
        const after = await readLocal('user:a');

        expect(after?.data.legalConsent).toEqual(newer);
        expect(after?.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);
    });
});
