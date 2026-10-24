import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDocFromServer, getDocs, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');

import { ConsentedTestDB as DB, openTestCloudBusiness } from './testUtils';


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
                    strategy: {
                        intent: 'development',
                        progressionFocus: 'volume',
                        primaryMuscles: ['quads'],
                        secondaryMuscles: ['triceps']
                    },
                    routines: [{ routineId: 'r1', frequencyPerWeek: 2 }]
                }
            ],
            activeCycleId: 'cycle_test',
            nutritionPlanning: null
        };

        expect(await DB.saveUserData(stateToSave)).toEqual({ ok: true, status: 'synced' });

        expect(mockBatch.set).toHaveBeenCalled();
        const setCalls = mockBatch.set.mock.calls;
        const userDocCall = setCalls.find((call: any) => call[0]?.path === 'users/test-user-id' && call[1]?._sealed);
        expect(userDocCall).toBeDefined();
        const business = openTestCloudBusiness(userDocCall[1]);
        expect(business.trainingCycles).toHaveLength(1);
        expect(business.trainingCycles[0].name).toBe('Mesociclo Massa');
        expect(business.trainingCycles[0].strategy).toEqual({
            intent: 'development',
            progressionFocus: 'volume',
            primaryMuscles: ['quads'],
            secondaryMuscles: ['triceps']
        });
        expect(business.activeCycleId).toBe('cycle_test');
        expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('DB.loadUserData retrieves trainingCycles and activeCycleId from Firestore', async () => {
        const mockFirestoreDoc = {
            _schemaVersion: 1,
            _sync: { protocolVersion: 3, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0 } },
            profile: { name: 'Mario' },
            library: [],
            routines: [],
            customFoods: [],
            trainingCycles: [
                {
                    id: 'cycle_loaded',
                    name: 'Ciclo Forza',
                    durationWeeks: 6,
                    strategy: {
                        intent: 'maintenance',
                        primaryMuscles: ['chest']
                    },
                    routines: []
                }
            ],
            activeCycleId: 'cycle_loaded'
        };

        vi.mocked(getDocFromServer).mockImplementation(async (ref: any) => {
                if (typeof ref?.path !== 'string' || ref.path.endsWith('/sync_control/state')
                    || ref.path.includes('/history_months/') || ref.path.includes('/nutrition_months/')) {
                    return { exists: () => false, data: () => undefined } as any;
                }
                return {
            exists: () => true,
            data: () => mockFirestoreDoc
        } as any;
            });

        vi.mocked(getDocs).mockResolvedValue({
            forEach: () => {}
        } as any);

        const loadedData = await DB.loadUserData();

        expect(loadedData).not.toBeNull();
        const loadedCycles = loadedData?.trainingCycles ?? [];
        expect(loadedCycles).toHaveLength(1);
        expect(loadedCycles[0].id).toBe('cycle_loaded');
        expect(loadedCycles[0].strategy).toEqual({
            intent: 'maintenance',
            primaryMuscles: ['chest']
        });
        expect(loadedData?.activeCycleId).toBe('cycle_loaded');
    });

    it('DB.loadUserData defaults trainingCycles to [] and activeCycleId to null if absent', async () => {
        vi.mocked(getDocFromServer).mockImplementation(async (ref: any) => {
                if (typeof ref?.path !== 'string' || ref.path.endsWith('/sync_control/state')
                    || ref.path.includes('/history_months/') || ref.path.includes('/nutrition_months/')) {
                    return { exists: () => false, data: () => undefined } as any;
                }
                return {
            exists: () => true,
            data: () => ({
                profile: { name: 'Mario' },
                _schemaVersion: 1,
                _sync: { protocolVersion: 3, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0 } },
            })
        } as any;
            });

        vi.mocked(getDocs).mockResolvedValue({
            forEach: () => {}
        } as any);

        const loadedData = await DB.loadUserData();

        expect(loadedData).not.toBeNull();
        expect(loadedData?.trainingCycles).toEqual([]);
        expect(loadedData?.activeCycleId).toBeNull();
    });
});
