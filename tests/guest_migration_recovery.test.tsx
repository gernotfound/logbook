import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replication = vi.hoisted(() => ({
    run: vi.fn(),
}));

vi.mock('../src/lib/sync/replicateJournal', () => ({
    replicateJournal: replication.run,
}));

import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { UserDataSchema } from '../src/lib/schema';
import * as localRepository from '../src/lib/sync/localRepository';
import { storageOwner } from '../src/lib/sync/session';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = { uid: 'guest-recovery-user', email: 'guest@example.com', displayName: 'Guest Recovery' } as any;
let commitSpy: ReturnType<typeof vi.spyOn> | undefined;

const MigrationProbe = () => {
    const { guestMigrationStatus, isGuest } = useAuth();
    return (
        <div>
            <div data-testid="migration-status">{guestMigrationStatus}</div>
            <div data-testid="guest-state">{isGuest ? 'guest' : 'account'}</div>
        </div>
    );
};

function fixtures() {
    const cloud = parse({
        profile: { gender: 'M' },
        routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }]
    });
    const guest = parse({
        profile: { height: '175' },
        routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }]
    });
    return { cloud, guest };
}

beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().resetStore({ force: true });
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
        callback(user);
        return () => {};
    });
    replication.run.mockResolvedValue({ ok: true, status: 'synced' });

    const { guest } = fixtures();
    await localRepository.initializeLocal('guest', guest, []);
});

afterEach(() => {
    commitSpy?.mockRestore();
    commitSpy = undefined;
});

describe('guest migration crash recovery boundary', () => {
    it('keeps the guest marker and policy when the authenticated local commit fails', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem('guest_migration_policy', 'merge');
        useAppStore.getState().setUserData(guest);

        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud,
            completeMonths: [],
            cloudDocuments: new Map()
        });

        commitSpy = vi.spyOn(localRepository, 'commitLocal').mockRejectedValueOnce(new Error('IndexedDB commit failed'));

        render(
            <AuthProvider>
                <MigrationProbe />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByTestId('migration-status').textContent).toBe('failed'));

        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem('guest_migration_policy')).toBe('merge');
        expect(storageOwner()).toBe('guest');
        expect(replication.run).not.toHaveBeenCalled();

        const guestEnvelope = await localRepository.readLocal('guest');
        expect(guestEnvelope?.data.profile).toMatchObject({ height: '175' });
        expect(guestEnvelope?.data.routines?.map(routine => routine.id)).toContain('guest-routine');
        expect(useAppStore.getState().userData?.profile).toMatchObject({ height: '175' });
    });

    it('retires the guest marker only after the authenticated envelope is durable and before replication', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem('guest_migration_policy', 'merge');
        useAppStore.getState().setUserData(guest);

        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud,
            completeMonths: [],
            cloudDocuments: new Map()
        });

        let markerDuringReplication: string | null | undefined;
        replication.run.mockImplementationOnce(async () => {
            markerDuringReplication = localStorage.getItem('logbook_is_guest');
            const authenticatedEnvelope = await localRepository.readLocal(user.uid);
            expect(authenticatedEnvelope?.data.profile).toMatchObject({ height: '175', gender: 'M' });
            expect(authenticatedEnvelope?.data.routines?.map(routine => routine.id))
                .toEqual(expect.arrayContaining(['cloud-routine', 'guest-routine']));
            return { ok: false, status: 'local-pending', error: new Error('offline') };
        });

        render(
            <AuthProvider>
                <MigrationProbe />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByTestId('migration-status').textContent).toBe('idle'));

        expect(markerDuringReplication).toBeNull();
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem('guest_migration_policy')).toBeNull();
        expect(storageOwner()).toBe(`user:${user.uid}`);

        const guestEnvelope = await localRepository.readLocal('guest');
        const authenticatedEnvelope = await localRepository.readLocal(user.uid);
        expect(guestEnvelope?.data.routines?.map(routine => routine.id)).toContain('guest-routine');
        expect(authenticatedEnvelope?.data.routines?.map(routine => routine.id))
            .toEqual(expect.arrayContaining(['cloud-routine', 'guest-routine']));
        expect(screen.getByTestId('guest-state').textContent).toBe('account');
    });
});
