import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');

import { DB } from '../src/lib/db';
import { auth } from '../src/lib/firebase';

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'user_123' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: {},
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
}));

describe('DB Persistence for Training Cycles and Planning', () => {
    let mockBatch: any;

    beforeEach(() => {
        vi.clearAllMocks();
        DB.resetCache();

        mockBatch = {
            set: vi.fn(),
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(writeBatch).mockReturnValue(mockBatch);
    });

    it('DB.saveUserData includes trainingCycles and activeCycleId in user document write', async () => {
        const stateToSave = {
            profile: { name: 'Mario' },
            library: [],
            routines: [],
            history: [],
            nutrition: {},
            customFoods: [],
            activeWorkout: null,
            trainingCycles: [
                {
                    id: 'cycle_test',
                    name: 'Mesociclo Massa',
                    durationWeeks: 8,
                    routines: [{ routineId: 'r1', frequencyPerWeek: 2 }]
                }
            ],
            activeCycleId: 'cycle_test',
            nutritionPlanning: null
        };

        await DB.saveUserData(stateToSave);

        expect(mockBatch.set).toHaveBeenCalled();
        const setCalls = mockBatch.set.mock.calls;
        const userDocCall = setCalls.find((call: any) => call[1]?.trainingCycles !== undefined);
        expect(userDocCall).toBeDefined();
        expect(userDocCall[1].trainingCycles).toHaveLength(1);
        expect(userDocCall[1].trainingCycles[0].name).toBe('Mesociclo Massa');
        expect(userDocCall[1].activeCycleId).toBe('cycle_test');
        expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('DB.loadUserData retrieves trainingCycles and activeCycleId from Firestore', async () => {
        const mockFirestoreDoc = {
            profile: { name: 'Mario' },
            library: [],
            routines: [],
            customFoods: [],
            trainingCycles: [
                {
                    id: 'cycle_loaded',
                    name: 'Ciclo Forza',
                    durationWeeks: 6,
                    routines: []
                }
            ],
            activeCycleId: 'cycle_loaded'
        };

        vi.mocked(getDoc).mockResolvedValueOnce({
            exists: () => true,
            data: () => mockFirestoreDoc
        } as any);

        vi.mocked(getDocs).mockResolvedValue({
            forEach: () => {}
        } as any);

        const loadedData = await DB.loadUserData();

        expect(loadedData).not.toBeNull();
        expect(loadedData?.trainingCycles).toHaveLength(1);
        expect(loadedData?.trainingCycles[0].id).toBe('cycle_loaded');
        expect(loadedData?.activeCycleId).toBe('cycle_loaded');
    });

    it('DB.loadUserData defaults trainingCycles to [] and activeCycleId to null if absent', async () => {
        vi.mocked(getDoc).mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ profile: { name: 'Mario' } })
        } as any);

        vi.mocked(getDocs).mockResolvedValue({
            forEach: () => {}
        } as any);

        const loadedData = await DB.loadUserData();

        expect(loadedData).not.toBeNull();
        expect(loadedData?.trainingCycles).toEqual([]);
        expect(loadedData?.activeCycleId).toBeNull();
    });
});
