import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { UserDataSchema } from '../src/lib/schema';
import { applyDomainOperations, type DomainOperationBatch } from '../src/lib/sync/domainOperations';
import * as repo from '../src/lib/sync/localRepository';
import { getNutritionConflictFingerprint } from '../src/lib/utils/object';
import type { UserData } from '../src/types';

const OWNER = 'user:test-user-id';
const originalDispatchDomainOperation = useAppStore.getState().dispatchDomainOperation;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

const initialConflictData = () => parse({
    profile: { name: 'Test', height: '170', gender: 'M' },
    nutritionPlanning: { totalKcal: 2500, onDaysCount: 3 },
    pendingConflicts: {
        nutritionPlanning: { totalKcal: 3000, onDaysCount: 4 }
    }
});

describe('PR 4: Nutrition Conflict Resolution (Store Unit Tests)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const initial = initialConflictData();
        useAppStore.setState({ userData: initial, dispatchDomainOperation: originalDispatchDomainOperation });
        await repo.initializeLocal(OWNER, initial);

        vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation').mockImplementation(async (operation: DomainOperationBatch) => {
            const current = useAppStore.getState().userData;
            if (!current) throw new Error('Dati utente non caricati');

            // Mirror the M8 runtime boundary: optimistic Zustand state plus durable
            // DomainOperation commit in the same repository used by the conflict CAS.
            const next = applyDomainOperations(current, operation);
            useAppStore.setState({ userData: next });
            await repo.commitDomainOperations(OWNER, operation, current);
            return { ok: true, status: 'synced' };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        useAppStore.setState({ dispatchDomainOperation: originalDispatchDomainOperation });
    });

    it('Mantieni Cloud: should remove the local conflict from memory and the durable repository without a domain dispatch', async () => {
        const expectedUid = 'test-user-id';
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
        expect(state.dispatchDomainOperation).not.toHaveBeenCalled();

        const stored = await repo.readLocal(OWNER);
        expect(stored?.data.pendingConflicts?.nutritionPlanning).toBeUndefined();
        expect(stored?.data.nutritionPlanning?.totalKcal).toBe(2500);
    });

    it('Mantieni Dispositivo: should persist the local plan through a domain operation before clearing the conflict CAS', async () => {
        const expectedUid = 'test-user-id';
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
        expect(state.dispatchDomainOperation).toHaveBeenCalledTimes(1);
        expect(state.dispatchDomainOperation).toHaveBeenCalledWith({
            type: 'nutrition-planning.replace',
            value: { totalKcal: 3000, onDaysCount: 4 },
            origin: 'user-edited',
        });

        const stored = await repo.readLocal(OWNER);
        expect(stored?.data.pendingConflicts?.nutritionPlanning).toBeUndefined();
        expect(stored?.data.nutritionPlanning?.totalKcal).toBe(3000);
    });

    it('Stale Conflict Prevention: should fail if fingerprint differs', async () => {
        const expectedUid = 'test-user-id';
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
        expect(state.dispatchDomainOperation).not.toHaveBeenCalled();

        const stored = await repo.readLocal(OWNER);
        expect(getNutritionConflictFingerprint(stored?.data.pendingConflicts?.nutritionPlanning)).not.toBe(expectedConflictFingerprint);
    });

    it('Preserve Local Backup: should not remove conflict if domain dispatch fails', async () => {
        vi.mocked(useAppStore.getState().dispatchDomainOperation).mockResolvedValue({
            ok: false, status: 'failed', error: new Error('Network Error')
        });

        const expectedUid = 'test-user-id';
        const expectedConflictFingerprint = getNutritionConflictFingerprint({ totalKcal: 3000, onDaysCount: 4 });

        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'local',
            expectedUid,
            expectedConflictFingerprint
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.status).toBe('failed');

        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts?.nutritionPlanning?.totalKcal).toBe(3000);

        const stored = await repo.readLocal(OWNER);
        expect(stored?.data.pendingConflicts?.nutritionPlanning?.totalKcal).toBe(3000);
    });

    it('Resolved elsewhere: should return failed with conflict-resolved-elsewhere if pending is absent', async () => {
        useAppStore.setState({
            userData: parse({
                profile: { name: 'Test', height: '170', gender: 'M' },
                nutritionPlanning: { totalKcal: 2500 }
            })
        });
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'cloud',
            expectedUid: 'test-user-id',
            expectedConflictFingerprint: 'v1:xyz'
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe('failed');
            expect(result.error?.message).toBe('conflict-resolved-elsewhere');
        }
    });

    it('Empty/Invalid Fingerprint Prevention: should return failed if fingerprint is empty', async () => {
        const expectedUid = 'test-user-id';
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
        expect(state.dispatchDomainOperation).not.toHaveBeenCalled();
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
