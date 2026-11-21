import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LegacyGuestRestartTestContext } from './guest_migration_restart_recovery.test';

export function registerLegacyGuestRestartCases({
    GUEST_KEY, GUEST_ARCHIVE_KEY, OVERLAY_SESSION_KEY, SYNC_RECOVERY_KEY,
    user, fixtures, App, AuthProvider, DB, localRepository, useAppStore, get,
    markPersistedGuestHandoff, runTransaction, saveWorkoutDeviceIntent,
    markGuestMigrationSyncRecovery, activateGuestSession, GUEST_SESSION_KEY,
    resumePersistedGuestMigration, getOnlineSpy,
}: LegacyGuestRestartTestContext): void {
    describe('legacy restart: encrypted vault, pending journal and recovery UI', () => {
    it('restores an already-durable authenticated archive without rewriting a stale guest view', async () => {
        const { cloud, guest } = fixtures();
        await localRepository.initializeLocal(user.uid, cloud, []);
        const guestCiphertextBefore = await get(GUEST_ARCHIVE_KEY);
        expect(guestCiphertextBefore).toMatch(/^tlb-sealed:v1:/);
        const accountBefore = await localRepository.readLocal(user.uid);
        // After a crash the guest snapshot can remain in memory, while the
        // recovery marker already makes storageOwner() resolve to the account.
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        useAppStore.setState({ userData: guest, dataOwner: 'guest', localWorkout: null });
        markGuestMigrationSyncRecovery(user.uid);

        render(<AuthProvider><App /></AuthProvider>);

        await waitFor(() => expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull());
        expect(localStorage.getItem(GUEST_KEY)).toBeNull();
        expect(useAppStore.getState().dataOwner).toBe('user:' + user.uid);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(useAppStore.getState().userData?.routines?.map(item => item.id)).toEqual(['cloud-routine']);
        expect((await localRepository.readLocal(user.uid))?.pending).toEqual(accountBefore?.pending);
        expect((await localRepository.readLocal(user.uid))?.data).toEqual(accountBefore?.data);
        expect(await get(GUEST_ARCHIVE_KEY)).toBe(guestCiphertextBefore);
        await expect(localRepository.readLocal('guest')).rejects.toMatchObject({ code: 'local-vault-locked' });
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
    });

    it('reconciles a newer authenticated workout device intent before publishing recovered account data', async () => {
        const { cloud, guest } = fixtures();
        const guestCiphertextBefore = await get(GUEST_ARCHIVE_KEY);
        expect(guestCiphertextBefore).toMatch(/^tlb-sealed:v1:/);
        const originalWorkout = {
            id: 'recovery-workout', date: '2026-10-14', routineName: 'Recupero',
            exercises: [{ id: 'exercise-1', exId: 'bench', sets: [{ id: 'set-1', kg: '50', reps: '8' }] }],
        };
        const initial = parse({ ...cloud, activeWorkout: originalWorkout });
        localStorage.setItem(`logbook:v2:user:${user.uid}:health-consent-generation`, '1');
        await localRepository.initializeLocal(user.uid, initial, []);
        const updatedWorkout = {
            ...initial.activeWorkout!,
            exercises: [{ ...initial.activeWorkout!.exercises[0], sets: [
                { ...initial.activeWorkout!.exercises[0].sets[0], kg: '55' },
            ] }],
        };
        saveWorkoutDeviceIntent('user:' + user.uid, initial.activeWorkout!, updatedWorkout, initial.activeWorkout!);
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        useAppStore.setState({ userData: guest, dataOwner: 'guest', localWorkout: null });
        markGuestMigrationSyncRecovery(user.uid);

        render(<AuthProvider><App /></AuthProvider>);

        await waitFor(async () => {
            const envelope = await localRepository.readLocal(user.uid);
            expect(envelope?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
            expect(envelope?.pending.length).toBeGreaterThan(0);
            expect(useAppStore.getState().localWorkout?.exercises[0].sets[0].kg).toBe('55');
        });
        await waitFor(() => expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull());
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(await get(GUEST_ARCHIVE_KEY)).toBe(guestCiphertextBefore);
        await expect(localRepository.readLocal('guest')).rejects.toMatchObject({ code: 'local-vault-locked' });
    });

    it('retains the recovery marker and blocks account data if the authenticated envelope is missing', async () => {
        markPersistedGuestHandoff();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
        expect(await localRepository.readLocal(user.uid)).toBeUndefined();
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');

        render(<AuthProvider><App /></AuthProvider>);

        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(JSON.parse(localStorage.getItem(SYNC_RECOVERY_KEY)!))
            .toMatchObject({ uid: user.uid, guestSessionId: 'guest-restart-generation' });
        expect(useAppStore.getState().saveError).toContain('copia locale autenticata non disponibile');
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(purge).not.toHaveBeenCalled();
    });

    it('does not retire a newer guest generation while resuming an older account handoff', async () => {
        const { cloud } = fixtures();
        await localRepository.initializeLocal(user.uid, cloud, []);
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-original');
        markGuestMigrationSyncRecovery(user.uid);
        const witness = localStorage.getItem(SYNC_RECOVERY_KEY);
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-new-generation');
        activateGuestSession('guest-new-generation');
        const before = await localRepository.readLocal(user.uid);
        const setGuestMigrationStatus = vi.fn();
        const setSaveError = vi.fn();
        const setIsGuest = vi.fn();
        await resumePersistedGuestMigration(user, () => true, {
            guestKey: GUEST_KEY,
            isGuestRef: { current: true },
            migrationDataRef: { current: null },
            setIsGuest, setGuestMigrationStatus, setSyncing: vi.fn(),
            setSaveError, clearGuestMigrationSyncRecovery: vi.fn(),
        });
        expect(setGuestMigrationStatus).toHaveBeenCalledWith('failed');
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('nuova sessione locale'));
        expect(setIsGuest).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUEST_KEY)).toBe('true');
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('guest-new-generation');
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBe(witness);
        expect(await localRepository.readLocal(user.uid)).toEqual(before);
    });

    it('retains the recovery marker when the authenticated envelope cannot be read', async () => {
        markPersistedGuestHandoff();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
        const readLocal = localRepository.readLocal;
        vi.spyOn(localRepository, 'readLocal').mockImplementation(async owner => {
            if (owner === user.uid) throw new Error('Simulated encrypted envelope read failure');
            return readLocal(owner);
        });
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');

        render(<AuthProvider><App /></AuthProvider>);

        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(JSON.parse(localStorage.getItem(SYNC_RECOVERY_KEY)!)).toMatchObject({ uid: user.uid });
        expect(useAppStore.getState().saveError).toContain('I dati locali sono stati lasciati intatti');
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(purge).not.toHaveBeenCalled();
    });

    it('keeps a rejected post-commit migration durable across restarts without sessionStorage, then clears it on local-pending retry', async () => {
        const { cloud, guest } = fixtures();
        const merged = parse({ ...cloud, profile: { ...cloud.profile, ...guest.profile }, routines: [...(cloud.routines || []), ...(guest.routines || [])] });
        await localRepository.initializeLocal(user.uid, cloud, []);
        await localRepository.commitLocal(user.uid, merged, cloud);
        useAppStore.getState().setUserData(merged);
        expect((await localRepository.readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        markPersistedGuestHandoff();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        getOnlineSpy()?.mockReturnValue(true);
        const permissionDenied = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
        vi.mocked(runTransaction).mockRejectedValueOnce(permissionDenied);
        const firstRender = render(<AuthProvider><App /></AuthProvider>);
        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(JSON.parse(localStorage.getItem(SYNC_RECOVERY_KEY)!)).toMatchObject({ uid: user.uid });
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        expect((await localRepository.readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        firstRender.unmount();
        vi.mocked(runTransaction).mockRejectedValueOnce(permissionDenied);
        render(<AuthProvider><App /></AuthProvider>);
        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(JSON.parse(localStorage.getItem(SYNC_RECOVERY_KEY)!)).toMatchObject({ uid: user.uid });
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        expect((await localRepository.readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        getOnlineSpy()?.mockReturnValue(false);
        fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
        await waitFor(() => expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull());
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        expect(document.getElementById('app-container')).toBeTruthy();
        expect(useAppStore.getState().saveError).toContain('Offline: i dati sono salvati sul dispositivo');
    });

    });
}
