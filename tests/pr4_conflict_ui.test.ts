import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';

describe('PR 4: Nutrition Conflict Resolution (Store Unit Tests)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            userData: {
                profile: { name: 'Test' },
                nutritionPlanning: { totalKcal: 2500, onDaysCount: 3 },
                pendingConflicts: {
                    nutritionPlanning: { totalKcal: 3000, onDaysCount: 4 }
                }
            } as any
        });
        
        vi.spyOn(useAppStore.getState(), 'updateUserData').mockImplementation(async (updater: any) => {
            const nextData = updater(useAppStore.getState().userData);
            useAppStore.setState({ userData: nextData });
            return { ok: true, status: 'synced' };
        });
    });

    it('Mantieni Cloud: should just remove the local conflict and not call updateUserData', async () => {
        const expectedUid = '123';
        const expectedConflictFingerprint = JSON.stringify({ totalKcal: 3000, onDaysCount: 4 });
        
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'cloud',
            expectedUid,
            expectedConflictFingerprint
        });
        
        expect(result).toEqual({ ok: true, status: 'synced' });
        
        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts).toBeUndefined();
        expect(state.userData?.nutritionPlanning?.totalKcal).toBe(2500); // Cloud plan retained
        
        expect(state.updateUserData).not.toHaveBeenCalled();
    });

    it('Mantieni Dispositivo: should overwrite cloud plan and call updateUserData', async () => {
        const expectedUid = '123';
        const expectedConflictFingerprint = JSON.stringify({ totalKcal: 3000, onDaysCount: 4 });
        
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'local',
            expectedUid,
            expectedConflictFingerprint
        });
        
        expect(result).toEqual({ ok: true, status: 'synced' });
        
        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts).toBeUndefined();
        expect(state.userData?.nutritionPlanning?.totalKcal).toBe(3000); // Local plan applied
        
        expect(state.updateUserData).toHaveBeenCalledTimes(1);
    });

    it('Stale Conflict Prevention: should fail if fingerprint differs', async () => {
        const expectedUid = '123';
        const expectedConflictFingerprint = JSON.stringify({ totalKcal: 1111, onDaysCount: 1 });
        
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'local',
            expectedUid,
            expectedConflictFingerprint
        });
        
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.status).toBe('failed');
        
        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts?.nutritionPlanning).toBeDefined(); // Conflict still there
        expect(state.updateUserData).not.toHaveBeenCalled();
    });

    it('Preserve Local Backup: should not remove conflict if updateUserData fails', async () => {
        vi.spyOn(useAppStore.getState(), 'updateUserData').mockImplementation(async (updater: any) => {
            const nextData = updater(useAppStore.getState().userData);
            useAppStore.setState({ userData: nextData });
            return { ok: false, status: 'failed', error: new Error('Network Error') };
        });

        const expectedUid = '123';
        const expectedConflictFingerprint = JSON.stringify({ totalKcal: 3000, onDaysCount: 4 });
        
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'local',
            expectedUid,
            expectedConflictFingerprint
        });
        
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.status).toBe('failed');
        
        const state = useAppStore.getState();
        // Conflict must be preserved
        expect(state.userData?.pendingConflicts?.nutritionPlanning?.totalKcal).toBe(3000); 
    });
});
