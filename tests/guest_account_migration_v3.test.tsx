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

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = { uid: 'a', email: 'a@example.com', displayName: 'A' } as any;
let onlineSpy: ReturnType<typeof vi.spyOn> | undefined;

function fixtures() {
    const cloud = parse({
        profile: { gender: 'M' },
        routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }]
    });
    const guest = parse({
        profile: { height: '175' },
        routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }]
    });
    return { cloud, guest, merged: mergeUserData(cloud, guest) };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.getState().resetStore();
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
        callback(user);
        return () => {};
    });
});

afterEach(() => {
    onlineSpy?.mockRestore();
    onlineSpy = undefined;
});

describe('guest -> account V3 migration', () => {
    it('stages SemanticOperations, drains the authenticated journal, and keeps cloud + guest data', async () => {
        const { cloud, guest, merged } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
        useAppStore.getState().setUserData(guest);

        vi.mocked(DB.loadCloudPayload)
            .mockResolvedValueOnce({ data: cloud, completeMonths: [], cloudDocuments: new Map() })
            .mockResolvedValueOnce({ data: merged, completeMonths: [], cloudDocuments: new Map() });

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(async () => {
            const envelope = await readLocal('user:a');
            expect(envelope).toBeDefined();
            expect(envelope?.pending).toEqual([]);
            expect(useAppStore.getState().userData?.profile).toMatchObject({ height: '175', gender: 'M' });
        });

        const routines = useAppStore.getState().userData?.routines ?? [];
        expect(routines.map(routine => routine.id)).toEqual(expect.arrayContaining(['cloud-routine', 'guest-routine']));
        expect(DB.loadCloudPayload).toHaveBeenNthCalledWith(1, { allMonths: true });
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
    });

    it('keeps the merged authenticated envelope and pending journal if connectivity drops after hydration', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem('logbook_is_guest', 'true');
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
