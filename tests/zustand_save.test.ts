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
        it('resolves saveUserData promise when DB.saveUserData succeeds', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce(undefined);

            const savePromise = useAppStore.getState().saveUserData(mockUserData1);
            expect(useAppStore.getState().syncing).toBe(true);
            expect(useAppStore.getState().saveError).toBeNull();

            await vi.advanceTimersByTimeAsync(1100);
            await expect(savePromise).resolves.toBeUndefined();

            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ name: 'User One' })
            }));
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
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('supports updater function syntax and resolves on success', async () => {
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce(undefined);
            useAppStore.setState({ userData: mockUserData1 });

            const savePromise = useAppStore.getState().saveUserData((prev) => ({
                ...(prev as UserData),
                profile: { ...(prev?.profile || {}), name: 'Updated Via Function' }
            }));

            await vi.advanceTimersByTimeAsync(1100);
            await expect(savePromise).resolves.toBeUndefined();

            expect(useAppStore.getState().userData?.profile?.name).toBe('Updated Via Function');
            expect(useAppStore.getState().syncing).toBe(false);
        });
    });

    describe('Concurrent & Debounced Calls Flow', () => {
        it('debounces multiple rapid calls into 1 DB write and resolves all caller promises on success', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValue(undefined);

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
            }));
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
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);
        });
    });

    describe('updateUserData Helper Flow', () => {
        it('updateUserData resolves when underlying saveUserData succeeds', async () => {
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce(undefined);
            useAppStore.setState({ userData: mockUserData1 });

            const updatePromise = useAppStore.getState().updateUserData((prev) => ({
                ...prev,
                profile: { ...prev.profile, name: 'Mutated Name' }
            }));

            await vi.advanceTimersByTimeAsync(1100);
            await expect(updatePromise).resolves.toBeUndefined();

            expect(useAppStore.getState().userData?.profile?.name).toBe('Mutated Name');
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('updateUserData propagates rejection when underlying saveUserData fails', async () => {
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

            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('updateUserData does nothing and resolves when userData is null in store', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData');
            useAppStore.setState({ userData: null });

            await expect(useAppStore.getState().updateUserData((prev) => prev)).resolves.toBeUndefined();
            expect(saveSpy).not.toHaveBeenCalled();
        });
    });

    describe('Null User Data & Error Recovery', () => {
        it('clears debounce timer and immediately resolves pending promises on saveUserData(null)', async () => {
            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            expect(useAppStore.getState().syncing).toBe(true);

            // Nullify while save is pending
            const p2 = useAppStore.getState().saveUserData(null);
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().userData).toBeNull();
            expect(useAppStore.getState().saveError).toBeNull();

            await Promise.all([p1, p2]);
        });

        it('subsequent successful save clears previous saveError', async () => {
            // First save fails
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(new Error('First fail'));
            const p1 = useAppStore.getState().saveUserData(mockUserData1);
            const a1 = expect(p1).rejects.toThrow('First fail');
            await vi.advanceTimersByTimeAsync(1100);
            await a1;
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');

            // Second save succeeds
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce(undefined);
            const p2 = useAppStore.getState().saveUserData(mockUserData2);
            // Starting second save resets saveError to null
            expect(useAppStore.getState().saveError).toBeNull();

            await vi.advanceTimersByTimeAsync(1100);
            await expect(p2).resolves.toBeUndefined();
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('online window event clears saveError', () => {
            useAppStore.setState({ saveError: 'Errore sincronizzazione. Verifica la connessione.' });
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');

            window.dispatchEvent(new Event('online'));
            expect(useAppStore.getState().saveError).toBeNull();
        });
    });
});
