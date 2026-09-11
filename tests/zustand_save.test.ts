import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';
import type { UserData } from '../src/types';

describe('R3: Zustand saveUserData Error Rejection & Debouncing Suite', () => {
    const mockUserData1: UserData = {
        profile: { name: 'User One', height: '175' },
        library: [{ id: 'ex1', name: 'Bench Press', setsCount: 3, sets: [] }],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        trainingCycles: [],
        supplements: [],
        activeWorkout: null,
        nutritionPlanning: {} as any
    };

    const mockUserData2: UserData = {
        ...mockUserData1,
        profile: { name: 'User Two', height: '180' }
    };

    const mockUserData3: UserData = {
        ...mockUserData1,
        profile: { name: 'User Three', height: '185' }
    };

    beforeEach(() => {
        vi.useFakeTimers();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        useAppStore.getState().resetStore();
        vi.useRealTimers();
    });

    describe('Single Save Flow', () => {
        it('resolves saveUserData promise with SyncResult when DB.saveUserData succeeds', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });

            const savePromise = useAppStore.getState().saveUserData(mockUserData1);
            expect(useAppStore.getState().syncing).toBe(true);
            expect(useAppStore.getState().saveError).toBeNull();

            await vi.advanceTimersByTimeAsync(1100);
            const result = await savePromise;

            expect(result.ok).toBe(true);
            expect(result.status).toBe('synced');
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ name: 'User One' })
            }), expect.any(Number));
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().saveError).toBeNull();
        });

        it('rejects saveUserData promise and sets saveError when DB.saveUserData throws', async () => {
            const networkError = new Error('Firestore write failed: Network offline');
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(networkError);

            const savePromise = useAppStore.getState().saveUserData(mockUserData1);
            const assertion = expect(savePromise).rejects.toThrow('Firestore write failed: Network offline');
            expect(useAppStore.getState().syncing).toBe(true);

            await vi.advanceTimersByTimeAsync(1100);
            await assertion;

            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(useAppStore.getState().saveError).toBe(networkError.message);
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('supports updater function syntax and resolves with SyncResult on success', async () => {
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });
            useAppStore.setState({ userData: mockUserData1 });

            const savePromise = useAppStore.getState().saveUserData((prev) => ({
                ...(prev as UserData),
                profile: { ...(prev?.profile || {}), name: 'Updated Via Function' }
            }));

            await vi.advanceTimersByTimeAsync(1100);
            const result = await savePromise;

            expect(result.ok).toBe(true);
            expect(useAppStore.getState().userData?.profile?.name).toBe('Updated Via Function');
            expect(useAppStore.getState().syncing).toBe(false);
        });
    });

    describe('Concurrent & Debounced Calls Flow', () => {
        it('debounces multiple rapid calls into 1 DB write and resolves all caller promises on success', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: true, status: 'synced' });

            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            await vi.advanceTimersByTimeAsync(200);

            const p2 = useAppStore.getState().saveUserData(mockUserData2);
            await vi.advanceTimersByTimeAsync(200);

            const p3 = useAppStore.getState().saveUserData(mockUserData3);
            expect(useAppStore.getState().syncing).toBe(true);

            // Advance past 1000ms debounce
            await vi.advanceTimersByTimeAsync(1100);

            const results = await Promise.allSettled([p1, p2, p3]);

            expect(results[0].status).toBe('fulfilled');
            expect(results[1].status).toBe('fulfilled');
            expect(results[2].status).toBe('fulfilled');

            // Only ONE DB save call was executed with the freshest data (mockUserData3)
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ name: 'User Three' })
            }), expect.any(Number));
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().saveError).toBeNull();
        });

        it('rejects ALL queued caller promises when debounced DB write fails', async () => {
            const error = new Error('Quota exceeded on Firestore batch write');
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(error);

            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            const p2 = useAppStore.getState().saveUserData(mockUserData2);
            const p3 = useAppStore.getState().saveUserData(mockUserData3);

            const a1 = expect(p1).rejects.toThrow('Quota exceeded on Firestore batch write');
            const a2 = expect(p2).rejects.toThrow('Quota exceeded on Firestore batch write');
            const a3 = expect(p3).rejects.toThrow('Quota exceeded on Firestore batch write');

            expect(useAppStore.getState().syncing).toBe(true);

            await vi.advanceTimersByTimeAsync(1100);
            await Promise.all([a1, a2, a3]);

            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(useAppStore.getState().saveError).toBe(error.message);
            expect(useAppStore.getState().syncing).toBe(false);
        });
    });

    describe('updateUserData Helper Flow', () => {
        it('updateUserData resolves with SyncResult when underlying saveUserData succeeds', async () => {
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });
            useAppStore.setState({ userData: mockUserData1 });

            const updatePromise = useAppStore.getState().updateUserData((prev) => ({
                ...prev,
                profile: { ...prev.profile, name: 'Mutated Name' }
            }));

            await vi.advanceTimersByTimeAsync(1100);
            const result = await updatePromise;

            expect(result.ok).toBe(true);
            expect(result.status).toBe('synced');
            expect(useAppStore.getState().userData?.profile?.name).toBe('Mutated Name');
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('updateUserData propagates rejection when underlying saveUserData throws', async () => {
            const dbError = new Error('Database permission denied');
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(dbError);
            useAppStore.setState({ userData: mockUserData1 });

            const updatePromise = useAppStore.getState().updateUserData((prev) => ({
                ...prev,
                profile: { ...prev.profile, name: 'Denied Mutation' }
            }));

            const assertion = expect(updatePromise).rejects.toThrow('Database permission denied');

            await vi.advanceTimersByTimeAsync(1100);
            await assertion;

            expect(useAppStore.getState().saveError).toBe(dbError.message);
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('updateUserData rejects without a loaded user instead of confirming a no-op', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData');
            useAppStore.setState({ userData: null });

            await expect(useAppStore.getState().updateUserData((prev) => prev)).rejects.toThrow('Dati utente non caricati');
            expect(saveSpy).not.toHaveBeenCalled();
        });
    });

    describe('Null User Data & Error Recovery', () => {
        it('cancels pending callers on saveUserData(null) without claiming a save', async () => {
            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            expect(useAppStore.getState().syncing).toBe(true);

            // Nullify while save is pending
            const canceled = expect(p1).rejects.toThrow('cambio sessione');
            const p2 = useAppStore.getState().saveUserData(null);
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().userData).toBeNull();
            expect(useAppStore.getState().saveError).toBeNull();

            await Promise.all([canceled, p2]);
        });

        it('subsequent successful save clears previous saveError', async () => {
            // First save fails with a throw (unrecoverable)
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(new Error('First fail'));
            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            const a1 = expect(p1).rejects.toThrow('First fail');
            await vi.advanceTimersByTimeAsync(1100);
            await a1;
            expect(useAppStore.getState().saveError).toBe('First fail');

            // Second save succeeds
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce({ ok: true, status: 'synced' });
            const p2 = useAppStore.getState().saveUserData(mockUserData2);
            // Starting second save resets saveError to null
            expect(useAppStore.getState().saveError).toBeNull();

            await vi.advanceTimersByTimeAsync(1100);
            const result = await p2;
            expect(result.ok).toBe(true);
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('online alone does not clear an error without a confirmed replay', () => {
            useAppStore.setState({ saveError: 'Si è verificato un errore imprevisto durante la sincronizzazione cloud. I tuoi dati locali sono preservati.' });
            expect(useAppStore.getState().saveError).toBe('Si è verificato un errore imprevisto durante la sincronizzazione cloud. I tuoi dati locali sono preservati.');

            window.dispatchEvent(new Event('online'));
            expect(useAppStore.getState().saveError).not.toBeNull();
        });
    });
});
