import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '../../../src/types';
import type { LegacyGuestRestartTestContext } from './guest_migration_restart_recovery.test';

export function registerLegacyGuestHandoffCases({
    GUEST_KEY, GUEST_ARCHIVE_KEY, OVERLAY_SESSION_KEY, SYNC_RECOVERY_KEY,
    user, fixtures, App, AuthProvider, DB, localRepository, useAppStore, get,
    beginGuestMigrationIntent, bootstrapAuthenticatedSession,
    markGuestMigrationSyncRecovery, activateGuestSession, GUEST_SESSION_KEY, draftRegistry,
}: LegacyGuestRestartTestContext): void {
    describe('legacy guest handoff: explicit intent, drafts and session retirement', () => {
    it('mounts only the blocking migration UI during automatic guest recovery without a session overlay marker', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        let resolveCloud!: (value: any) => void;
        const cloudRequest = new Promise(resolve => { resolveCloud = resolve; });
        vi.mocked(DB.loadCloudPayload).mockImplementationOnce(() => cloudRequest as any);
        render(<AuthProvider><App /></AuthProvider>);
        await waitFor(() => expect(screen.getByRole('status', { name: 'Preparazione account in corso' })).toBeTruthy());
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(screen.queryByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeNull();
        expect(screen.queryByText('Home view')).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        resolveCloud({ data: cloud, completeMonths: [], cloudDocuments: new Map() });
        await waitFor(() => expect(useAppStore.getState().saveError).toContain('Offline: account preparato sul dispositivo'));
        await waitFor(() => expect(screen.getByTestId('bottom-nav')).toBeTruthy());
        expect(document.getElementById('app-container')).toBeTruthy();
    });

    it('ends authenticated bootstrap in a recoverable failed state when another tab retires guest ownership while waiting', async () => {
        const { guest } = fixtures();
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.getState().setUserData(guest);
        const before = await localRepository.readLocal('guest');
        const ciphertextBefore = await get(GUEST_ARCHIVE_KEY);

        // The auth gate observes the original guest. Between the last
        // wasGuest observation and lock acquisition a different tab removes
        // its flag. This must not silently leave loading=true or load a
        // foreign in-memory snapshot into the authenticated owner.
        let observations = 0;
        const isGuestActiveStrict = () => {
            observations++;
            const active = localStorage.getItem(GUEST_KEY) === 'true';
            if (observations === 2) localStorage.removeItem(GUEST_KEY);
            return active;
        };
        const setIsGuest = vi.fn();
        const setLoading = vi.fn();
        const setGuestMigrationStatus = vi.fn();
        const setSaveError = vi.fn();
        const loadData = vi.fn(async () => {});
        const markRecovery = vi.fn();

        await bootstrapAuthenticatedSession(user, () => true, {
            guestKey: GUEST_KEY,
            isGuestActiveStrict,
            readGuestMigrationRecoveryStrict: () => false,
            isGuestRef: { current: true },
            migrationDataRef: { current: null },
            setIsGuest,
            setCurrentUser: vi.fn(),
            setEmailVerificationRequired: vi.fn(),
            setGuestMigrationStatus,
            setLoading,
            setUserData: vi.fn(),
            setSyncing: vi.fn(),
            setSaveError,
            markGuestMigrationSyncRecovery: markRecovery,
            clearGuestMigrationSyncRecovery: vi.fn(),
            loadData,
        });

        expect(observations).toBeGreaterThanOrEqual(2);
        expect(setGuestMigrationStatus).toHaveBeenCalledWith('failed');
        expect(setIsGuest).toHaveBeenCalledWith(false);
        expect(setLoading).toHaveBeenCalledWith(false);
        expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('sessione locale è cambiata'));
        expect(markRecovery).not.toHaveBeenCalled();
        expect(loadData).not.toHaveBeenCalled();
        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
        expect(before?.data.routines?.map(routine => routine.id)).toContain('guest-routine');
        expect(await get(GUEST_ARCHIVE_KEY)).toBe(ciphertextBefore);
        await expect(localRepository.readLocal('guest')).rejects.toMatchObject({ code: 'local-vault-locked' });
        expect(localStorage.getItem('guest_migration_intent_v1')).not.toBeNull();
    });

    it('does not consume guest data without an explicit migration intent', async () => {
        const { guest } = fixtures();
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        useAppStore.getState().setUserData(guest);
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');

        render(<AuthProvider><App /></AuthProvider>);

        await waitFor(() => expect(useAppStore.getState().saveError).toContain('scegli come gestire i dati locali'));
        expect(localStorage.getItem(GUEST_KEY)).toBe('true');
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull();
        expect((await localRepository.readLocal('guest'))?.data.routines?.map(routine => routine.id))
            .toContain('guest-routine');
        expect(purge).not.toHaveBeenCalled();
        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
    });


    it.each(['merge', 'skip'] as const)(
        'preserves the guest and its reservation when a draft fails before %s handoff',
        async policy => {
            const { guest } = fixtures();
            localStorage.setItem(GUEST_KEY, 'true');
            localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
            activateGuestSession('guest-restart-generation');
            await beginGuestMigrationIntent(policy, 'recovery', { uid: user.uid });
            useAppStore.setState({ userData: guest, dataOwner: 'guest', localWorkout: null });
            const reservation = localStorage.getItem('guest_migration_intent_v1');
            const ciphertext = await get(GUEST_ARCHIVE_KEY);
            const failDraft = () => { throw new Error('Draft capture failed'); };
            draftRegistry.register(failDraft);
            try {
                render(<AuthProvider><App /></AuthProvider>);
                await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());

                expect(DB.loadCloudPayload).not.toHaveBeenCalled();
                expect(localStorage.getItem(GUEST_KEY)).toBe('true');
                expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull();
                expect(JSON.parse(localStorage.getItem('guest_migration_intent_v1')!))
                    .toMatchObject(JSON.parse(reservation!));
                expect(await get(GUEST_ARCHIVE_KEY)).toBe(ciphertext);
                expect(await localRepository.readLocal(user.uid)).toBeUndefined();
                expect(useAppStore.getState().dataOwner).toBe('guest');
                expect(useAppStore.getState().userData).toEqual(guest);
            } finally {
                draftRegistry.unregister(failDraft);
            }
        },
    );

    it('transfers the current guest snapshot after flushing instead of the older login snapshot', async () => {
        const { cloud, guest } = fixtures();
        const latest = parse({
            ...guest,
            routines: [...(guest.routines || []), { id: 'flushed-routine', name: 'Latest draft', exercises: [] }],
        });
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
        activateGuestSession('guest-restart-generation');
        await beginGuestMigrationIntent('merge', 'recovery', { uid: user.uid });
        useAppStore.setState({ userData: guest, dataOwner: 'guest', localWorkout: null });
        const migrationDataRef = { current: guest as UserData | null };
        const flushDraft = () => useAppStore.getState().setUserData(latest);
        draftRegistry.register(flushDraft);
        vi.mocked(DB.loadCloudPayload).mockResolvedValueOnce({
            data: cloud, completeMonths: [], cloudDocuments: new Map(),
        });
        try {
            await bootstrapAuthenticatedSession(user, () => true, {
                guestKey: GUEST_KEY,
                isGuestActiveStrict: () => localStorage.getItem(GUEST_KEY) === 'true',
                readGuestMigrationRecoveryStrict: () => false,
                isGuestRef: { current: true }, migrationDataRef,
                setIsGuest: vi.fn(), setCurrentUser: vi.fn(),
                setEmailVerificationRequired: vi.fn(), setGuestMigrationStatus: vi.fn(),
                setLoading: vi.fn(),
                setUserData: useAppStore.getState().setUserData,
                setSyncing: useAppStore.getState().setSyncing,
                setSaveError: useAppStore.getState().setSaveError,
                markGuestMigrationSyncRecovery,
                clearGuestMigrationSyncRecovery: vi.fn(),
                loadData: vi.fn(),
            });
            const durable = await localRepository.readLocal(user.uid);
            expect(durable?.data.routines?.map(routine => routine.id))
                .toEqual(expect.arrayContaining(['cloud-routine', 'guest-routine', 'flushed-routine']));
            expect(durable?.pending.length).toBeGreaterThan(0);
            expect(localStorage.getItem(GUEST_KEY)).toBeNull();
            expect(localStorage.getItem('guest_migration_intent_v1')).toBeNull();
            expect(migrationDataRef.current).toBeNull();
        } finally {
            draftRegistry.unregister(flushDraft);
        }
    });

    });
}
