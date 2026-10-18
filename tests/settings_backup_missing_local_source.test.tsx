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
    state: {
        userData: null as UserData | null,
        dataOwner: null as string | null,
        saveUserData: vi.fn(),
    },
}));

vi.mock('../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: fixture.owner, epoch: 1 }),
    isCurrentSession: () => true,
}));
// In this screen a revoked/suspended consent permits a rights backup even
// when regular authenticated hydration has not populated the Zustand view.
vi.mock('../src/lib/healthConsent', () => ({ currentHealthConsentStatus: () => 'withdrawn' }));
vi.mock('../src/lib/sync/localRepository', () => ({ readLocal: fixture.readLocal }));
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
    fixture.readLocal.mockResolvedValue(undefined);
    fixture.exportBackup.mockResolvedValue(true);
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
