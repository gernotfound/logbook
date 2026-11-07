import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { render, waitFor } from '@testing-library/react';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { AuthProvider } from '../src/contexts/AuthContext';
import { UserDataSchema } from '../src/lib/schema';
import { initializeLocal, commitLocal, readLocal } from '../src/lib/sync/localRepository';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';
import { beginGuestMigrationIntent } from '../src/lib/auth/guestMigrationIntent';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, LocalVaultLockedError } from '../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY } from '../src/lib/sync/session';
import { migrateGuestAccount } from '../src/contexts/auth/migrateGuestAccount';
import { isHealthConsentCloudWritable } from '../src/lib/healthConsent';
import * as replicaProtocol from '../src/lib/sync/replicaProtocol';
import * as replicateModule from '../src/lib/sync/replicateJournal';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = {
    uid: 'skip-user', email: 'skip@example.com', displayName: 'Skip User', emailVerified: true,
    providerData: [{ providerId: 'password' }], getIdToken: vi.fn(async () => 'synthetic-token'),
} as any;
const guestArchiveKey = 'logbook:v2:guest';

async function seedGuestArchive(guest: UserData): Promise<string> {
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-skip-generation');
    activateGuestSession('guest-skip-generation');
    await createAndMigrateVault('guest');
    await initializeLocal('guest', guest);
    const ciphertext = await get<string>(guestArchiveKey);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    return ciphertext!;
}

describe('guest -> account skip policy', () => {
    beforeEach(async () => {
        lockAllVaults();
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
        (auth as any).currentUser = user;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            callback(user);
            return () => {};
        });
        await createAndMigrateVault('user:skip-user');
    });
    afterEach(() => lockAllVaults());


    it('preserves account pending while the user explicitly skips guest transfer', async () => {
        const cloud = parse({
            profile: { gender: 'M' },
            routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }],
        });
        const accountEdit = parse({ ...cloud, profile: { ...cloud.profile, height: '183' } });
        const guest = parse({
            profile: { height: '151' },
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
        });

        await initializeLocal(user.uid, cloud);
        await commitLocal(user.uid, accountEdit, cloud);
        expect((await readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        const guestCiphertext = await seedGuestArchive(guest);
        await beginGuestMigrationIntent('skip', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        const offline = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        try {
            vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
                data: cloud, completeMonths: [], cloudDocuments: new Map(),
            });
            render(<AuthProvider><div>app</div></AuthProvider>);

            await waitFor(() => {
                expect(localStorage.getItem('logbook_is_guest')).toBeNull();
                expect(useAppStore.getState().saveError).toMatch(/dispositivo|Offline/);
                expect(useAppStore.getState().syncHealth).toBe('local-pending');
            });
            const account = await readLocal(user.uid);
            expect(account?.pending.length).toBeGreaterThan(0);
            expect(account?.data.profile?.height).toBe('183');
            expect(account?.data.routines?.map(item => item.id)).toEqual(['cloud-routine']);
            expect(await get<string>(guestArchiveKey)).toBe(guestCiphertext);
            await expect(readLocal('guest')).rejects.toBeInstanceOf(LocalVaultLockedError);
            expect(useAppStore.getState().dataOwner).toBe('user:' + user.uid);
            expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
        } finally {
            offline.mockRestore();
        }
    });

    it('retains account pending when merge has no actual guest data to transfer', async () => {
        const cloud = parse({
            profile: { gender: 'M' },
            routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }],
        });
        const accountEdit = parse({ ...cloud, profile: { ...cloud.profile, height: '183' } });
        await initializeLocal(user.uid, cloud);
        await commitLocal(user.uid, accountEdit, cloud);
        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud, completeMonths: [], cloudDocuments: new Map(),
        });
        const offline = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        const onLocalReady = vi.fn();
        try {
            // Exercise an empty guest without UI bootstrap seeding default fields.
            const result = await migrateGuestAccount({
                user, guestData: null, policy: 'merge',
                setUserData: vi.fn(), setSyncing: vi.fn(), onLocalReady,
                isCurrent: () => true,
            });
            expect(onLocalReady).toHaveBeenCalledOnce();
            expect(result.status).toBe('local-pending');
            const account = await readLocal(user.uid);
            expect(account?.pending.length).toBeGreaterThan(0);
            expect(account?.data.profile?.height).toBe('183');
            expect(account?.data.routines?.map(item => item.id)).toEqual(['cloud-routine']);
            expect(useAppStore.getState().dataOwner).toBe('user:' + user.uid);
            expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
        } finally {
            offline.mockRestore();
        }
    });

    it('fails closed when the authoritative migration intent is absent', async () => {
        const guest = parse({
            profile: { height: '175' },
            routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }],
        });

        const guestCiphertext = await seedGuestArchive(guest);
        useAppStore.getState().setUserData(guest);

        render(<AuthProvider><div>app</div></AuthProvider>);

        await waitFor(() => {
            expect(useAppStore.getState().saveError).toContain('tentativo di trasferimento');
        });

        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
        expect(await readLocal('user:skip-user')).toBeUndefined();
        expect((await readLocal('guest'))?.data.routines?.map(routine => routine.id)).toContain('guest-routine');
        expect(await get<string>(guestArchiveKey)).toBe(guestCiphertext);
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

        const guestCiphertext = await seedGuestArchive(guest);
        await beginGuestMigrationIntent('skip', 'recovery', { uid: user.uid });
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
            expect(accountEnvelope?.data.routines?.map(routine => routine.id)).toEqual(['cloud-routine']);
            expect(useAppStore.getState().userData?.routines?.map(routine => routine.id)).toEqual(['cloud-routine']);
        });

        expect(await get<string>(guestArchiveKey)).toBe(guestCiphertext);
        await expect(readLocal('guest')).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem('guest_migration_intent_v1')).toBeNull();
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
    });
    it('does not expose an existing account archive through the guest writer before handoff', async () => {
        const account = parse({ profile: { height: '183' } });
        await initializeLocal(user.uid, account);
        const ciphertext = await get('logbook:v2:user:skip-user');
        const setUserData = vi.fn();
        const onLocalReady = vi.fn();
        const failure = new Error('Cloud load unavailable');
        vi.mocked(DB.loadCloudPayload).mockRejectedValueOnce(failure);

        await expect(migrateGuestAccount({
            user, guestData: null, policy: 'skip',
            setUserData, setSyncing: vi.fn(), onLocalReady, isCurrent: () => true,
        })).rejects.toBe(failure);

        expect(setUserData).not.toHaveBeenCalled();
        expect(onLocalReady).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:skip-user')).toBe(ciphertext);
        expect((await readLocal(user.uid))?.data.profile?.height).toBe('183');
    });


    it.each(['retire', 'checkpoint'] as const)(
        'invalidates guest migration %s when consent authorization changes inside replica maintenance',
        async phase => {
            const account = parse({ profile: { height: '183' } });
            await initializeLocal(user.uid, account);
            vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
                data: account, completeMonths: [], cloudDocuments: new Map(),
            });

            let cloudWritable = true;
            vi.mocked(isHealthConsentCloudWritable).mockImplementation(() => cloudWritable);
            const retire = vi.spyOn(replicaProtocol, 'retireExpiredReplicas').mockImplementation(async (_db, _uid, _now, guard) => {
                expect(guard).toBeTypeOf('function');
                if (!guard) throw new Error('Missing consent guard');
                expect(guard()).toBe(true);
                if (phase === 'retire') {
                    cloudWritable = false;
                    expect(guard()).toBe(false);
                    throw new Error('Consent authorization changed');
                }
            });
            const claim = vi.spyOn(replicaProtocol, 'claimReplicaCheckpoint').mockImplementation(async (
                _db, _uid, _replica, _clock, _seq, _candidateId, guard,
            ) => {
                expect(guard).toBeTypeOf('function');
                if (!guard) throw new Error('Missing consent guard');
                expect(guard()).toBe(true);
                cloudWritable = false;
                expect(guard()).toBe(false);
                throw new Error('Consent authorization changed');
            });
            const onLocalReady = vi.fn();

            try {
                await expect(migrateGuestAccount({
                    user, guestData: null, policy: 'skip',
                    setUserData: vi.fn(), setSyncing: vi.fn(), onLocalReady,
                    isCurrent: () => true,
                })).rejects.toThrow('Consent authorization changed');
                expect(retire).toHaveBeenCalledOnce();
                expect(claim).toHaveBeenCalledTimes(phase === 'checkpoint' ? 1 : 0);
                expect(onLocalReady).not.toHaveBeenCalled();
                expect((await readLocal(user.uid))?.data.profile?.height).toBe('183');
            } finally {
                cloudWritable = true;
                vi.mocked(isHealthConsentCloudWritable).mockImplementation(() => true);
                retire.mockRestore();
                claim.mockRestore();
            }
        },
    );


    it('does not start the post-replication cloud read after consent is suspended', async () => {
        const account = parse({ profile: { gender: 'M' } });
        const guest = parse({ profile: { height: '175' } });
        await initializeLocal(user.uid, account);
        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: account, completeMonths: [], cloudDocuments: new Map(),
        });
        let cloudWritable = true;
        vi.mocked(isHealthConsentCloudWritable).mockImplementation(() => cloudWritable);
        const replay = vi.spyOn(replicateModule, 'replicateJournal').mockImplementation(async () => {
            cloudWritable = false;
            return { ok: true, status: 'synced' };
        });
        const onLocalReady = vi.fn();
        try {
            await expect(migrateGuestAccount({
                user, guestData: guest, policy: 'merge', setUserData: vi.fn(),
                setSyncing: vi.fn(), onLocalReady, isCurrent: () => true,
            })).rejects.toThrow('Migrazione guest invalidata');
            expect(onLocalReady).toHaveBeenCalledOnce();
            expect(replay).toHaveBeenCalledOnce();
            expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
            expect(await readLocal(user.uid)).toBeDefined();
        } finally {
            cloudWritable = true;
            vi.mocked(isHealthConsentCloudWritable).mockImplementation(() => true);
            replay.mockRestore();
        }
    });

});
