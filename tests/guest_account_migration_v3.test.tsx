import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { AuthProvider } from '../src/contexts/AuthContext';
import { UserDataSchema } from '../src/lib/schema';
import { mergeUserData } from '../src/lib/merge';
import { readLocal } from '../src/lib/sync/localRepository';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';
import { beginGuestMigrationIntent } from '../src/lib/auth/guestMigrationIntent';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = { uid: 'a', email: 'a@example.com', displayName: 'A' } as any;
let onlineSpy: ReturnType<typeof vi.spyOn> | undefined;

function fixtures() {
    const cloud = parse({
        profile: { gender: 'M' },
        routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }],
        legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: '1.3.4', termsVersion: '1.2.1' }
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
    onlineSpy?.mockRestore();
    onlineSpy = undefined;
});

describe('guest -> account V3 migration', () => {
    it('stages SemanticOperations, drains the authenticated journal, and keeps cloud + guest data', async () => {
        const { cloud, guest, merged } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);

        vi.mocked(DB.loadCloudPayload)
            .mockResolvedValueOnce({ data: cloud, completeMonths: [], cloudDocuments: new Map() })
            .mockResolvedValueOnce({ data: merged, completeMonths: [], cloudDocuments: new Map() });

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
        expect(DB.loadCloudPayload).toHaveBeenNthCalledWith(1, { allMonths: true });
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
    });

    it('keeps guest progress local and does not replicate it before account-specific consent', async () => {
        const guest = parse({
            profile: { height: '175' },
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
            legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: '1.3.4', termsVersion: '1.2.1' },
        });
        const freshAccount = parse({ profile: { gender: 'M' } });
        localStorage.setItem('logbook_is_guest', 'true');
        beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
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
        beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        onlineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

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
        });

        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
    });
});
