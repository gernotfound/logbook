import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { getNutritionConflictFingerprint } from '../src/lib/utils/object';

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
        const expectedConflictFingerprint = getNutritionConflictFingerprint({ totalKcal: 3000, onDaysCount: 4 });

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
        const expectedConflictFingerprint = getNutritionConflictFingerprint({ totalKcal: 3000, onDaysCount: 4 });

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
        const expectedConflictFingerprint = getNutritionConflictFingerprint({ totalKcal: 1111, onDaysCount: 1 });

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
        const expectedConflictFingerprint = getNutritionConflictFingerprint({ totalKcal: 3000, onDaysCount: 4 });

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

    it('Resolved elsewhere: should return failed with conflict-resolved-elsewhere if pending is absent', async () => {
        useAppStore.setState({
            userData: {
                profile: { name: 'Test' },
                nutritionPlanning: { totalKcal: 2500 }
            } as any
        });
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'cloud',
            expectedUid: '123',
            expectedConflictFingerprint: 'v1:xyz'
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe('failed');
            expect(result.error?.message).toBe('conflict-resolved-elsewhere');
        }
    });

    it('Empty/Invalid Fingerprint Prevention: should return failed if fingerprint is empty', async () => {
        const expectedUid = '123';
        const expectedConflictFingerprint = ''; // Empty string simulates missing/invalid

        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'cloud',
            expectedUid,
            expectedConflictFingerprint
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.status).toBe('failed');
        expect(result.error).toBeDefined();

        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts?.nutritionPlanning).toBeDefined(); // No destructive mutation
        expect(state.updateUserData).not.toHaveBeenCalled();
    });
});

describe('PR 4: Nutrition Conflict Fingerprint', () => {
    it('generates a versioned fingerprint', () => {
        const plan = { totalKcal: 2500, weight: 80, onDaysCount: 4 };
        const fp = getNutritionConflictFingerprint(plan);
        expect(fp.startsWith('v1:')).toBe(true);
    });

    it('generates the same fingerprint regardless of key order', () => {
        const plan1 = { totalKcal: 2500, weight: 80, onDaysCount: 4 };
        const plan2 = { weight: 80, onDaysCount: 4, totalKcal: 2500 }; // Different order

        expect(getNutritionConflictFingerprint(plan1)).toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints when scalar data changes (non-calorie)', () => {
        const plan1 = { totalKcal: 2500, weight: 80, onDaysCount: 4 };
        const plan2 = { totalKcal: 2500, weight: 80, onDaysCount: 5 }; // Days changed

        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints when nested data changes', () => {
        const plan1 = { avgMacros: { carbsPerKg: 4, proPerKg: 2, fatPerKg: 1 } };
        const plan2 = { avgMacros: { carbsPerKg: 5, proPerKg: 2, fatPerKg: 1 } }; // carbs changed

        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints for onBoost changes', () => {
        const plan1 = { onBoost: { carbsPercent: 40, proPercent: 30, fatPercent: 30 } };
        const plan2 = { onBoost: { carbsPercent: 45, proPercent: 30, fatPercent: 25 } };
        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints for onMacros changes', () => {
        const plan1 = { onMacros: { carbsPerKg: 4, proPerKg: 2, fatPerKg: 1 } };
        const plan2 = { onMacros: { carbsPerKg: 4, proPerKg: 2.5, fatPerKg: 1 } };
        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints for offMacros changes', () => {
        const plan1 = { offMacros: { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1 } };
        const plan2 = { offMacros: { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1.2 } };
        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints for normocalorica changes', () => {
        const plan1 = { normocalorica: { kcal: 2000, carbs: 200, pro: 150, fat: 66 } };
        const plan2 = { normocalorica: { kcal: 2100, carbs: 200, pro: 150, fat: 66 } };
        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints for legacy macro fields', () => {
        const plan1 = { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1 };
        const plan2 = { carbsPerKg: 3, proPerKg: 2.2, fatPerKg: 1 };
        expect(getNutritionConflictFingerprint(plan1)).not.toBe(getNutritionConflictFingerprint(plan2));
    });

    it('handles nested objects properly across reordering', () => {
        const plan1 = { avgMacros: { carbsPerKg: 4, proPerKg: 2, fatPerKg: 1 } };
        const plan2 = { avgMacros: { fatPerKg: 1, carbsPerKg: 4, proPerKg: 2 } };

        expect(getNutritionConflictFingerprint(plan1)).toBe(getNutritionConflictFingerprint(plan2));
    });

    it('returns empty string when plan is null or undefined', () => {
        expect(getNutritionConflictFingerprint(null)).toBe('');
        expect(getNutritionConflictFingerprint(undefined)).toBe('');
    });
});
