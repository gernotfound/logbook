import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { AuthProvider } from '../src/contexts/AuthContext';
import { UserDataSchema } from '../src/lib/schema';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';
import { beginGuestMigrationIntent } from '../src/lib/auth/guestMigrationIntent';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = { uid: 'skip-user', email: 'skip@example.com', displayName: 'Skip User' } as any;

describe('guest -> account skip policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
        (auth as any).currentUser = user;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            callback(user);
            return () => {};
        });
    });

    it('fails closed when the authoritative migration intent is absent', async () => {
        const guest = parse({
            profile: { height: '175' },
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
        });

        await initializeLocal('guest', guest);
        localStorage.setItem('logbook_is_guest', 'true');
        useAppStore.getState().setUserData(guest);

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(() => {
            expect(useAppStore.getState().saveError).toContain('tentativo di trasferimento');
        });

        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
        expect(await readLocal('user:skip-user')).toBeUndefined();
        expect((await readLocal('guest'))?.data.routines.map(routine => routine.id)).toContain('guest-routine');
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    });

    it('loads account data without merging guest progress and preserves the guest archive', async () => {
        const cloud = parse({
            profile: { gender: 'M' },
            routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }],
        });
        const guest = parse({
            profile: { height: '175' },
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
        });

        await initializeLocal('guest', guest);
        localStorage.setItem('logbook_is_guest', 'true');
        beginGuestMigrationIntent('skip', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);

        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud,
            completeMonths: [],
            cloudDocuments: new Map(),
        });

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(async () => {
            const accountEnvelope = await readLocal('user:skip-user');
            expect(accountEnvelope).toBeDefined();
            expect(accountEnvelope?.data.routines.map(routine => routine.id)).toEqual(['cloud-routine']);
            expect(useAppStore.getState().userData?.routines.map(routine => routine.id)).toEqual(['cloud-routine']);
        });

        const guestEnvelope = await readLocal('guest');
        expect(guestEnvelope?.data.routines.map(routine => routine.id)).toEqual(['guest-routine']);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem('guest_migration_intent_v1')).toBeNull();
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
    });
});
