import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LegacyGuestRestartTestContext } from './guest_migration_restart_recovery.test';

export function registerLegacyGuestOwnerSwitchCases({
    GUEST_KEY, SYNC_RECOVERY_KEY, parse, App, AuthProvider, DB,
    auth, onAuthStateChanged, localRepository, useAppStore,
    beginGuestMigrationIntent, activateGuestSession, GUEST_SESSION_KEY,
}: LegacyGuestRestartTestContext): void {
    describe('legacy guest migration: account replacement and UID fencing', () => {
    it('invalidates an A migration suspended at local commit before account B can take ownership', async () => {
        const guest = parse({ profile: { height: '175' }, routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }] });
        const cloudA = parse({ profile: { gender: 'M' }, routines: [{ id: 'cloud-a', name: 'Cloud A', exercises: [] }] });
        const cloudB = parse({ profile: { gender: 'F' }, routines: [{ id: 'cloud-b', name: 'Cloud B', exercises: [] }] });
        const userA = { uid: 'account-a', email: 'a@example.com', displayName: 'A' } as any;
        const userB = { uid: 'account-b', email: 'b@example.com', displayName: 'B' } as any;
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: userA.uid });
        useAppStore.getState().setUserData(guest);
        let authCallback!: (nextUser: any) => Promise<void>;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { authCallback = callback; return () => {}; });
        let releaseBCloud!: (value: any) => void;
        const bCloudRequest = new Promise(resolve => { releaseBCloud = resolve; });
        vi.mocked(DB.loadCloudPayload).mockImplementation(() => {
            if ((auth as any).currentUser?.uid === userA.uid) return Promise.resolve({ data: cloudA, completeMonths: [], cloudDocuments: new Map() }) as any;
            if ((auth as any).currentUser?.uid === userB.uid) return bCloudRequest as any;
            return Promise.resolve(null) as any;
        });
        const realCommitLocal = localRepository.commitLocal;
        let releaseACommit!: () => void;
        let markACommitEntered!: () => void;
        const aCommitEntered = new Promise<void>(resolve => { markACommitEntered = resolve; });
        const aCommitGate = new Promise<void>(resolve => { releaseACommit = resolve; });
        vi.spyOn(localRepository, 'commitLocal').mockImplementation(async (owner, data, baseline, guard) => {
            if (owner === userA.uid) { markACommitEntered(); await aCommitGate; }
            return realCommitLocal(owner, data, baseline, guard);
        });
        (auth as any).currentUser = null;
        render(<AuthProvider><App /></AuthProvider>);
        let aRun!: Promise<void>;
        act(() => { (auth as any).currentUser = userA; aRun = authCallback(userA); });
        await aCommitEntered;
        expect(screen.getByRole('status', { name: 'Preparazione account in corso' })).toBeTruthy();
        let bRun!: Promise<void>;
        act(() => { (auth as any).currentUser = userB; bRun = authCallback(userB); });
        // B must wait behind A's held guest lifecycle lock. Releasing A's
        // suspended local commit comes BEFORE observing B's rejection.
        releaseACommit();
        await act(async () => { await aRun; await bRun; });

        // B cannot inherit the merge/skip decision that was bound to A.
        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(DB.loadCloudPayload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GUEST_KEY)).toBe('true');
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();

        // An account B session must not be able to decrypt A's archive, even
        // in a regression test. The suspended A commit is fenced, not granted
        // access through an artificial test-only unlock.
        await expect(localRepository.readLocal(userA.uid)).rejects.toMatchObject({
            code: 'local-vault-locked',
        });
        expect(await localRepository.readLocal(userB.uid)).toBeUndefined();

        // A fresh explicit decision for B is required before B may own the guest data.
        await beginGuestMigrationIntent('merge', 'recovery', { uid: userB.uid });
        let retryB!: Promise<void>;
        act(() => { retryB = authCallback(userB); });
        await waitFor(() => expect(DB.loadCloudPayload).toHaveBeenCalledTimes(2));
        releaseBCloud({ data: cloudB, completeMonths: [], cloudDocuments: new Map() });
        await act(async () => { await retryB; });

        await waitFor(() => expect(document.getElementById('app-container')).toBeTruthy());
        expect(localStorage.getItem(GUEST_KEY)).toBeNull();
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull();
        const envelopeB = await localRepository.readLocal(userB.uid);
        expect(envelopeB?.data.routines?.map(routine => routine.id)).toContain('cloud-b');
        expect(envelopeB?.data.routines?.map(routine => routine.id)).toContain('guest-routine');
        expect(envelopeB?.data.routines?.map(routine => routine.id)).not.toContain('cloud-a');
    });
    });
}
