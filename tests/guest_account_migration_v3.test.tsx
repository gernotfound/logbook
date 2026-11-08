import { LEGAL_VERSIONS } from '../src/lib/legalVersions';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { AuthProvider } from '../src/contexts/AuthContext';
import { UserDataSchema } from '../src/lib/schema';
import { mergeUserData } from '../src/lib/merge';
import { rootDocument } from '../src/lib/sync/documentProjection';
import { readLocal } from '../src/lib/sync/localRepository';
import * as localRepository from '../src/lib/sync/localRepository';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';
import { beginGuestMigrationIntent } from '../src/lib/auth/guestMigrationIntent';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY } from '../src/lib/sync/session';
import { CATALOG_CACHE_KEY, clearCatalogCache, getInMemoryCatalog, getSeedCatalog } from '../src/lib/catalog/catalogService';
import * as idbKeyval from 'idb-keyval';

vi.mock('../src/lib/sync/cloudAccountKeyAccess', () => ({
    requireCloudAccountDataKey: vi.fn(async () => new Uint8Array(32).fill(18)),
    requireRightsExportAccountDataKey: vi.fn(async () => new Uint8Array(32).fill(18)),
}));
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = {
    uid: 'a', email: 'a@example.com', displayName: 'A', emailVerified: true,
    providerData: [{ providerId: 'password' }], getIdToken: vi.fn(async () => 'synthetic-token'),
} as any;

function fixtures() {
    const cloud = parse({
        profile: { gender: 'M' },
        routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }],
        legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms }
    });
    const guest = parse({
        profile: { height: '175' },
        routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }]
    });
    return { cloud, guest, merged: mergeUserData(cloud, guest) };
}

beforeEach(async () => {
    lockAllVaults();
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.getState().resetStore();
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
        callback(user);
        return () => {};
    });
    // The authenticated destination vault is genuinely provisioned/unlocked;
    // guest→account causality and consent are still exercised by the real code.
    await createAndMigrateVault('user:a');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('guest -> account V3 migration', () => {
    it('stages SemanticOperations, drains the authenticated journal, and keeps cloud + guest data', async () => {
        const { cloud, guest, merged } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-migration-v3-generation');
        activateGuestSession('guest-migration-v3-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);

        vi.mocked(DB.loadCloudPayload)
            .mockResolvedValueOnce({ data: cloud, completeMonths: [], cloudDocuments: new Map() })
            .mockImplementationOnce(async () => {
                // A real post-flush cloud response includes the root document's
                // causal metadata, not merely the merged business snapshot.
                const durable = await readLocal('user:a');
                const sync = durable?.syncMetaByDocument[''];
                if (!sync) throw new Error('Post-flush fixture missing durable root _sync');
                return {
                    data: merged,
                    completeMonths: [],
                    cloudDocuments: new Map([['', { ...rootDocument(merged), _sync: sync }]]),
                };
            });

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(async () => {
            const envelope = await readLocal('user:a');
            expect(envelope).toBeDefined();
            if (envelope?.pending.length) {
                const latest = useAppStore.getState();
                throw new Error('Journal pending after migration: ' + JSON.stringify({
                    pending: envelope.pending.length,
                    replica: envelope.replica !== undefined,
                    consentRevision: envelope.consentRevision,
                    saveError: latest.saveError,
                    syncHealth: latest.syncHealth,
                    cloudCalls: vi.mocked(DB.loadCloudPayload).mock.calls.length,
                }));
            }
            expect(useAppStore.getState().userData?.profile).toMatchObject({ height: '175', gender: 'M' });
        }, { timeout: 8000 });

        const routines = useAppStore.getState().userData?.routines ?? [];
        expect(routines.map(routine => routine.id)).toEqual(expect.arrayContaining(['cloud-routine', 'guest-routine']));
        expect(DB.loadCloudPayload).toHaveBeenNthCalledWith(1, expect.objectContaining({ allMonths: true, cloudKey: expect.any(Uint8Array) }));
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
    });

    it('classifies persisted global items through the real guest-to-account migration, not an empty memory seed', async () => {
        const { cloud } = fixtures();
        await clearCatalogCache();
        const seed = getSeedCatalog();
        const globalExercise = { id: 'catalog-migration-ex', name: 'Global exercise', trackingType: 'weight_reps' as const };
        const globalFood = { id: 'catalog-migration-food', name: 'Global food', kcal: 150, pro: 5, carbs: 20, fat: 5 };
        // Simulate the stale in-memory seed that an earlier failed IDB read can leave.
        expect(getInMemoryCatalog().exercises).toEqual([]);
        await idbKeyval.set(CATALOG_CACHE_KEY, {
            ...seed,
            manifest: { ...seed.manifest, version: 'durable-migration-v1', itemCounts: { exercises: 1, foods: 1 } },
            exercises: [globalExercise],
            foods: [globalFood],
        });

        const guest = parse({
            profile: { height: '176' },
            library: [globalExercise],
            customFoods: [globalFood],
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
        });
        expect(guest.library?.[0]?.isDefault).toBeUndefined();
        expect(guest.customFoods?.[0]?.isCustom).toBeUndefined();
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-migration-v3-generation');
        activateGuestSession('guest-migration-v3-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        // This is a pre-existing guest snapshot, not a new edit to persist
        // concurrently with the authenticated owner handoff.
        useAppStore.setState({ userData: guest, dataOwner: 'guest' });

        // Interpose on the existing transaction-serialized test double, rather
        // than replacing it with another IndexedDB implementation.
        const mockedGet = vi.mocked(idbKeyval.get);
        const originalGet = mockedGet.getMockImplementation();
        if (!originalGet) throw new Error('Expected the canonical idb-keyval test mock');
        let failedCatalogReads = 2;
        mockedGet.mockImplementation((...args) => {
            if (args[0] === CATALOG_CACHE_KEY && failedCatalogReads > 0) {
                failedCatalogReads--;
                return Promise.reject(new Error('temporary catalog IndexedDB read failure'));
            }
            return originalGet(...args);
        });

        let preSecondCloudProfile: unknown = null;
        const commitProfiles: unknown[] = [];
        const originalCommit = localRepository.commitLocal;
        const commitSpy = vi.spyOn(localRepository, 'commitLocal').mockImplementation(async (...args) => {
            const before = { desired: args[1].profile, callerBase: args[2].profile };
            const result = await originalCommit(...args);
            const durable = await readLocal('user:a');
            commitProfiles.push({ ...before, durableAfter: durable?.data.profile, pending: durable?.pending.length });
            return result;
        });
        const hydrateProfiles: unknown[] = [];
        const originalHydrate = localRepository.hydrateLocal;
        const hydrateSpy = vi.spyOn(localRepository, 'hydrateLocal').mockImplementation(async (...args) => {
            const hydrated = await originalHydrate(...args);
            hydrateProfiles.push({ input: args[1]?.profile, result: hydrated.data.profile });
            return hydrated;
        });
        vi.mocked(DB.loadCloudPayload)
            .mockResolvedValueOnce({ data: cloud, completeMonths: [], cloudDocuments: new Map() })
            .mockImplementationOnce(async () => {
                const durable = await readLocal('user:a');
                preSecondCloudProfile = durable?.data.profile;
                const metadata = durable?.syncMetaByDocument[''];
                if (!durable || !metadata) throw new Error('Missing authenticated root checkpoint in migration fixture');
                return {
                    data: durable.data,
                    completeMonths: [],
                    cloudDocuments: new Map([['', { ...rootDocument(durable.data), _sync: metadata }]]),
                };
            });
        try {
            render(<AuthProvider><div>Catalog migration integrity check</div></AuthProvider>);
            await waitFor(async () => {
                const envelope = await readLocal('user:a');
                if (envelope?.data.profile?.gender !== 'M') {
                    const state = useAppStore.getState();
                    throw new Error('Migration did not publish cloud profile: ' + JSON.stringify({
                        profile: envelope?.data.profile,
                        hasEnvelope: Boolean(envelope),
                        guestMarker: localStorage.getItem('logbook_is_guest'),
                        owner: state.dataOwner,
                        syncHealth: state.syncHealth,
                        saveError: state.saveError,
                        cloudReads: vi.mocked(DB.loadCloudPayload).mock.calls.length,
                        preSecondCloudProfile,
                        hydrateProfiles,
                        commitProfiles,
                        cloudFixtureProfile: cloud.profile,
                        userProfile: state.userData?.profile,
                        pending: envelope?.pending.length,
                        remainingCatalogFaults: failedCatalogReads,
                    }));
                }
                expect(envelope?.data.profile).toMatchObject({ height: '176', gender: 'M' });
                expect(envelope?.data.routines?.some(item => item.id === 'guest-routine')).toBe(true);
                expect(envelope?.data.library?.filter(item =>
                    item.id === globalExercise.id && item.isDefault !== true)).toEqual([]);
                expect(envelope?.data.customFoods?.filter(item =>
                    String(item.id) === globalFood.id && item.isCustom !== false)).toEqual([]);
            }, { timeout: 8000 });
            expect(failedCatalogReads).toBe(0);
            expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        } finally {
            hydrateSpy.mockRestore();
            commitSpy.mockRestore();
            mockedGet.mockImplementation(originalGet);
            await clearCatalogCache();
        }
    });

    it('fences an existing account archive if guest migration encounters undecryptable cloud data', async () => {
        const { cloud, guest } = fixtures();
        const { initializeLocal } = await import('../src/lib/sync/localRepository');
        const { CloudCiphertextError } = await import('../src/lib/sync/cloudDocumentCipher');
        await initializeLocal('user:a', cloud);
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-migration-v3-generation');
        activateGuestSession('guest-migration-v3-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        vi.mocked(DB.loadCloudPayload).mockRejectedValueOnce(new CloudCiphertextError());

        render(<AuthProvider><div>Guest migration integrity check</div></AuthProvider>);
        await waitFor(async () => {
            const preserved = await readLocal('user:a');
            expect(preserved?.data.profile?.gender).toBe('M');
            expect(preserved?.cloudIntegrityFence).toEqual(expect.any(String));
            expect(useAppStore.getState().cloudIntegrityBlocked).toBe(true);
        });
        expect(DB.loadCloudPayload).toHaveBeenCalled();
    });

    it('keeps guest progress local and does not replicate it before account-specific consent', async () => {
        const guest = parse({
            profile: { height: '175' },
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
            legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms },
        });
        const freshAccount = parse({ profile: { gender: 'M' } });
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-migration-v3-generation');
        activateGuestSession('guest-migration-v3-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: freshAccount,
            completeMonths: [],
            cloudDocuments: new Map(),
        });

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(async () => {
            const envelope = await readLocal('user:a');
            expect(envelope?.pending.length).toBeGreaterThan(0);
            expect(envelope?.data.legalConsent).toBeUndefined();
            expect(envelope?.data.profile).toMatchObject({ height: '175', gender: 'M' });
        });
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(useAppStore.getState().userData?.legalConsent).toBeUndefined();
    });

    it('keeps the merged authenticated envelope and pending journal if connectivity drops after hydration', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-migration-v3-generation');
        activateGuestSession('guest-migration-v3-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud,
            completeMonths: [],
            cloudDocuments: new Map()
        });

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(async () => {
            const envelope = await readLocal('user:a');
            expect(envelope?.pending.length).toBeGreaterThan(0);
            expect(envelope?.data.profile).toMatchObject({ height: '175', gender: 'M' });
            expect(useAppStore.getState().userData?.profile).toMatchObject({ height: '175', gender: 'M' });
            expect(useAppStore.getState().syncHealth).toBe('local-pending');
        });

        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
    });
    it('blocks editing instead of relabeling guest memory when the account archive becomes unreadable after handoff', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-migration-v3-generation');
        activateGuestSession('guest-migration-v3-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        const originalRead = localRepository.readLocal;
        const read = vi.spyOn(localRepository, 'readLocal').mockImplementation(async owner => {
            if ((owner === 'user:a' || owner === 'a') && localStorage.getItem('logbook_is_guest') !== 'true') {
                throw new Error('Account archive unavailable after handoff');
            }
            return originalRead(owner);
        });
        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud, completeMonths: [], cloudDocuments: new Map(),
        });

        render(<AuthProvider><div>Migration recovery</div></AuthProvider>);

        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(useAppStore.getState().dataOwner).toBe('guest');
        expect(useAppStore.getState().userData?.profile?.gender).toBeUndefined();
        expect(useAppStore.getState().syncHealth).toBe('failed');
        const preserved = await originalRead('user:a');
        expect(preserved?.data.profile).toMatchObject({ height: '175', gender: 'M' });
        expect(preserved?.pending.length).toBeGreaterThan(0);
        expect(read).toHaveBeenCalled();
    });

});
