import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Exporter } from '../src/lib/export';
import { createBackup } from '../src/lib/backup';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import type { UserData } from '../src/types';

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: vi.fn(),
    }
}));

vi.mock('../src/lib/sync/session', async () => {
    const actual = await vi.importActual('../src/lib/sync/session');
    return {
        ...actual,
        captureSession: () => ({ owner: 'user:my_user_id', epoch: 0 }),
        isCurrentSession: () => true,
    };
});

const sharePayload = (userData: Record<string, unknown>) => ({
    ...createBackup({} as UserData, null),
    type: 'share' as const,
    owner: null,
    userData,
});

describe('Adversarial Import/Export Logic', () => {
    let saveUserDataMock: any;
    let mockUserData: UserData;

    beforeEach(() => {
        saveUserDataMock = vi.fn();
        mockUserData = {
            profile: { dob: '1990-01-01' } as any,
            library: [{ id: 'ex1', name: 'Original', setsCount: 3, sets: [] }],
            routines: [],
            history: [],
            nutrition: {},
            trainingCycles: []
        };
        (useAppStore.getState as any).mockReturnValue({ userData: mockUserData });
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockClear();
    });

    it('blocks cross-user current backup import', async () => {
        const fakeFileContent = JSON.stringify(createBackup({ history: [{ id: 'h2' }] } as any, 'user:different_user_id'));
        const file = new File([fakeFileContent], "test.json", { type: "application/json" });
        await expect(Exporter.importFromJson(file, { uid: 'my_user_id' }, saveUserDataMock)).rejects.toThrow();
        expect(saveUserDataMock).not.toHaveBeenCalled();
    });

    it('gives priority to local data on ID collision during current share import', async () => {
        const fakeFileContent = JSON.stringify(sharePayload({
            library: [{ id: 'ex1', name: 'Imported Edited', setsCount: 5, sets: [] }, { id: 'ex2', name: 'New Ex', setsCount: 3, sets: [] }]
        }));
        const file = new File([fakeFileContent], "test.json", { type: "application/json" });

        await Exporter.importFromJson(file, { uid: 'my_user_id' }, saveUserDataMock);
        expect(saveUserDataMock).toHaveBeenCalled();
        const updater = saveUserDataMock.mock.calls[0][0];
        const finalData = typeof updater === 'function' ? updater(mockUserData) : updater;
        const ex1 = finalData.library.find((ex: any) => ex.id === 'ex1');
        const ex2 = finalData.library.find((ex: any) => ex.id === 'ex2');
        expect(ex1.name).toBe('Original');
        expect(ex1.setsCount).toBe(3);
        expect(ex2.name).toBe('New Ex');
    });

    it('keeps schema sanitization behavior inside a current-version backup', async () => {
        const malformed = createBackup({} as UserData, 'user:my_user_id') as any;
        malformed.userData = {
            profile: { dob: 123 },
            library: [{ id: 123 }]
        };
        const file = new File([JSON.stringify(malformed)], "test.json", { type: "application/json" });

        await Exporter.importFromJson(file, { uid: 'my_user_id' }, saveUserDataMock);
        expect(saveUserDataMock).toHaveBeenCalled();
        const updater = saveUserDataMock.mock.calls[0][0];
        const finalData = typeof updater === 'function' ? updater(mockUserData) : updater;
        expect(finalData.library.length).toBe(2);
    });

    it('stress test: handles large current share arrays without freezing', async () => {
        const largeLibrary = Array.from({ length: 450 }).map((_, i) => ({
            id: `large_ex_${i}`,
            name: `Ex ${i}`,
            setsCount: 3,
            sets: []
        }));
        const file = new File([JSON.stringify(sharePayload({ library: largeLibrary }))], "test.json", { type: "application/json" });

        const start = performance.now();
        await Exporter.importFromJson(file, { uid: 'my_user_id' }, saveUserDataMock);
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(1000);

        const updater = saveUserDataMock.mock.calls[0][0];
        const finalData = typeof updater === 'function' ? updater(mockUserData) : updater;
        expect(finalData.library.length).toBe(451);
    });
});
