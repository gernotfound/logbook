import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { UserData } from '../src/types';

const fixture = vi.hoisted(() => ({
    owner: 'user:backup-uid',
    readLocal: vi.fn(),
    collectSnapshot: vi.fn(),
    exportBackup: vi.fn(),
    flush: vi.fn(async () => {}),
    deviceWorkout: vi.fn(),
    current: true,
    consent: 'withdrawn' as 'active' | 'withdrawn',
    state: {
        userData: null as UserData | null,
        localPersistenceBlocked: false,
        dataOwner: null as string | null,
        saveUserData: vi.fn(),
    },
}));

vi.mock('../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: fixture.owner, epoch: 1 }),
    isCurrentSession: () => fixture.current,
}));
// In this screen a revoked/suspended consent permits a rights backup even
// when regular authenticated hydration has not populated the Zustand view.
vi.mock('../src/lib/healthConsent', () => ({ currentHealthConsentStatus: () => fixture.consent }));
vi.mock('../src/lib/sync/localRepository', () => ({ readLocal: fixture.readLocal }));
vi.mock('../src/lib/sync/deviceStorage', () => ({ readDeviceValueStrict: fixture.deviceWorkout }));
vi.mock('../src/lib/db/backupSnapshot', () => ({ collectBackupSnapshot: fixture.collectSnapshot }));
vi.mock('../src/store/useAppStore', () => {
    const useAppStore = Object.assign(
        (selector: (state: unknown) => unknown) => selector(fixture.state),
        { getState: () => ({ ...fixture.state, flushPendingSyncs: fixture.flush }) },
    );
    return { useAppStore };
});
vi.mock('../src/lib/export', () => ({
    Exporter: {
        exportBackupJson: fixture.exportBackup,
        prepareBackupJsonUrl: vi.fn(),
    },
}));

import { useSettingsTransfers } from '../src/hooks/useSettingsTransfers';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';

const empty = () => UserDataSchema.parse({}) as UserData;
const owner = { uid: 'backup-uid' } as User;

beforeEach(() => {
    vi.clearAllMocks();
    fixture.state.userData = null;
    fixture.state.dataOwner = null;
    fixture.state.localPersistenceBlocked = false;
    fixture.current = true;
    fixture.consent = 'withdrawn';
    fixture.deviceWorkout.mockReturnValue(null);
    useDialogStore.getState().showConfirm = vi.fn(async () => true);
    fixture.readLocal.mockResolvedValue(undefined);
    fixture.exportBackup.mockResolvedValue(true);
});

describe('quarantined workout device backup', () => {
    beforeEach(() => { fixture.consent = 'active'; });
    const historicalCopy = '{"id":"old-workout","date":"2026-10-14","exercises":[]}';

    it('exports a device-only recovery copy while active consent blocks UI hydration', async () => {
        fixture.state.localPersistenceBlocked = true;
        fixture.deviceWorkout.mockReturnValue(historicalCopy);
        const recovered = { workout: historicalCopy };
        fixture.collectSnapshot.mockResolvedValueOnce({
            owner: fixture.owner, data: empty(), coverage: { scope: 'device', months: [] },
            recovery: { device: recovered },
        });
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });

        expect(useDialogStore.getState().showConfirm)
            .toHaveBeenCalledWith(expect.stringContaining('SOLO il backup di questo dispositivo'));
        expect(fixture.collectSnapshot).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
        expect(fixture.flush).not.toHaveBeenCalled();
        expect(fixture.exportBackup).toHaveBeenCalledWith(
            expect.anything(), { uid: 'backup-uid' },
            expect.objectContaining({ scope: 'device' }),
            expect.objectContaining({ device: recovered }),
        );
        expect(fixture.deviceWorkout).toHaveBeenCalledWith('workout', fixture.owner);
    });

    it('refuses an empty backup when no durable archive or device workout exists', async () => {
        fixture.state.localPersistenceBlocked = true;
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });
        expect(useDialogStore.getState().showAlert)
            .toHaveBeenCalledWith(expect.stringContaining('nessun archivio o allenamento leggibile'));
        expect(useDialogStore.getState().showConfirm).not.toHaveBeenCalled();
        expect(fixture.collectSnapshot).not.toHaveBeenCalled();
        expect(fixture.exportBackup).not.toHaveBeenCalled();
    });

    it('preserves the existing local envelope and refuses export when the owner declines', async () => {
        fixture.state.localPersistenceBlocked = true;
        const data = empty();
        fixture.readLocal.mockResolvedValue({ owner: fixture.owner, data, pending: [] });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(false);
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });
        expect(fixture.collectSnapshot).not.toHaveBeenCalled();
        expect(fixture.exportBackup).not.toHaveBeenCalled();
        expect(fixture.flush).not.toHaveBeenCalled();
    });

    it('does not export a quarantined snapshot after the authenticated session changes', async () => {
        fixture.state.localPersistenceBlocked = true;
        fixture.deviceWorkout.mockReturnValue(historicalCopy);
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(async () => {
            fixture.current = false;
            return true;
        });
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });
        expect(fixture.collectSnapshot).not.toHaveBeenCalled();
        expect(fixture.exportBackup).not.toHaveBeenCalled();
    });

    it('does not silently skip an unreadable encrypted workout', async () => {
        fixture.state.localPersistenceBlocked = true;
        fixture.deviceWorkout.mockImplementationOnce(() => { throw new Error('Ciphertext non leggibile'); });
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });
        expect(fixture.collectSnapshot).not.toHaveBeenCalled();
        expect(fixture.exportBackup).not.toHaveBeenCalled();
        expect(useDialogStore.getState().showAlert)
            .toHaveBeenCalledWith('Ciphertext non leggibile');
    });
});

describe('backup rights export with no local archive', () => {
    it('never offers or creates a synthetic empty device backup after a cloud error', async () => {
        fixture.collectSnapshot.mockRejectedValueOnce(new Error('Cloud non disponibile'));
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });

        expect(fixture.collectSnapshot).toHaveBeenCalledTimes(1);
        expect(fixture.collectSnapshot).toHaveBeenCalledWith(expect.anything(), true);
        expect(useDialogStore.getState().showConfirm).not.toHaveBeenCalled();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
            expect.stringContaining('nessun archivio leggibile'),
        );
        expect(fixture.exportBackup).not.toHaveBeenCalled();
    });

    it('still permits an authenticated cloud-only export when no device envelope exists', async () => {
        fixture.collectSnapshot.mockResolvedValueOnce({
            owner: fixture.owner, data: empty(), coverage: { scope: 'cloud-and-device', months: [] },
            recovery: { cloudDocuments: {} },
        });
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });

        expect(fixture.collectSnapshot).toHaveBeenCalledTimes(1);
        expect(fixture.exportBackup).toHaveBeenCalledWith(
            expect.anything(), { uid: 'backup-uid' },
            expect.objectContaining({ scope: 'cloud-and-device' }), expect.anything(),
        );
        expect(useDialogStore.getState().showConfirm).not.toHaveBeenCalled();
    });

    it('offers an explicit partial device export when a genuine local envelope exists', async () => {
        const data = empty();
        fixture.readLocal.mockResolvedValue({ owner: fixture.owner, data, pending: [] });
        fixture.collectSnapshot
            .mockRejectedValueOnce(new Error('Cloud non disponibile'))
            .mockResolvedValueOnce({ owner: fixture.owner, data, coverage: { scope: 'device', months: [] }, recovery: {} });
        const { result } = renderHook(() => useSettingsTransfers({ currentUser: owner, isGuest: false }));
        await act(async () => { await result.current.handleExportBackup(); });

        expect(useDialogStore.getState().showConfirm).toHaveBeenCalledWith(expect.stringContaining('solo i dati presenti'));
        expect(fixture.collectSnapshot).toHaveBeenNthCalledWith(2, data, false);
        expect(fixture.exportBackup).toHaveBeenCalledWith(
            data, { uid: 'backup-uid' }, expect.objectContaining({ scope: 'device' }), expect.anything(),
        );
    });
});
