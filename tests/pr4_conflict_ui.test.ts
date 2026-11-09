import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { UserDataSchema } from '../src/lib/schema';
import * as repo from '../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';
import { getNutritionConflictFingerprint } from '../src/lib/utils/object';
import type { UserData } from '../src/types';

const OWNER = 'user:test-user-id';
const originalDispatchDomainOperation = useAppStore.getState().dispatchDomainOperation;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

const initialConflictData = () => parse({
    profile: { name: 'Test', height: '170', gender: 'M' },
    nutritionPlanning: { normocalorica: { kcal: 2500 }, onDaysCount: 3 },
    pendingConflicts: {
        nutritionPlanning: { normocalorica: { kcal: 3000 }, onDaysCount: 4 }
    }
});

describe('PR 4: Nutrition Conflict Resolution (Store Unit Tests)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const initial = initialConflictData();
        useAppStore.setState({
            userData: initial,
            dataOwner: OWNER,
            dispatchDomainOperation: originalDispatchDomainOperation,
            localPersistenceBlocked: false,
            compatibilityStatus: 'ok',
        });
        await prepareUnlockedTestArchive(OWNER);
        await repo.initializeLocal(OWNER, initial);

        // Observe the real dispatcher, including its identity guard and durable commit.
        vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation');
    });

    afterEach(() => {
        lockAllVaults();
        vi.restoreAllMocks();
        useAppStore.setState({
            dispatchDomainOperation: originalDispatchDomainOperation,
            userData: null,
            dataOwner: null,
        });
    });

    it('Mantieni Cloud: should remove the local conflict from memory and the durable repository without a domain dispatch', async () => {
        const expectedUid = 'test-user-id';
        const expectedConflictFingerprint = getNutritionConflictFingerprint(
            useAppStore.getState().userData?.pendingConflicts?.nutritionPlanning
        );

        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'cloud',
            expectedUid,
            expectedConflictFingerprint
        });

        expect(result).toEqual({ ok: true, status: 'synced' });

        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts).toBeUndefined();
        expect(state.userData?.nutritionPlanning?.normocalorica?.kcal).toBe(2500); // Cloud plan retained
        expect(state.dispatchDomainOperation).not.toHaveBeenCalled();

        const stored = await repo.readLocal(OWNER);
        expect(stored?.data.pendingConflicts?.nutritionPlanning).toBeUndefined();
        expect(stored?.data.nutritionPlanning?.normocalorica?.kcal).toBe(2500);
    });

    it('Mantieni Dispositivo: should persist the local plan through a domain operation before clearing the conflict CAS', async () => {
        const expectedUid = 'test-user-id';
        const expectedLocalPlan = useAppStore.getState().userData?.pendingConflicts?.nutritionPlanning;
        if (!expectedLocalPlan) throw new Error('Expected normalized pending nutrition conflict');
        const expectedConflictFingerprint = getNutritionConflictFingerprint(expectedLocalPlan);

        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'local',
            expectedUid,
            expectedConflictFingerprint
        });

        expect(result).toEqual({ ok: true, status: 'synced' });

        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts).toBeUndefined();
        expect(state.userData?.nutritionPlanning?.normocalorica?.kcal).toBe(3000); // Local plan applied
        expect(state.dispatchDomainOperation).toHaveBeenCalledTimes(1);
        expect(state.dispatchDomainOperation).toHaveBeenCalledWith({
            type: 'nutrition-planning.replace',
            value: expectedLocalPlan,
            origin: 'user-edited',
        });

        const stored = await repo.readLocal(OWNER);
        expect(stored?.data.pendingConflicts?.nutritionPlanning).toBeUndefined();
        expect(stored?.data.nutritionPlanning?.normocalorica?.kcal).toBe(3000);
    });

    it.each([
        { resolution: 'cloud' as const, dataOwner: null },
        { resolution: 'local' as const, dataOwner: null },
        { resolution: 'cloud' as const, dataOwner: 'user:another-account' },
        { resolution: 'local' as const, dataOwner: 'user:another-account' },
    ])('refuses $resolution for ownerless or foreign data ($dataOwner)', async ({ resolution, dataOwner }) => {
        const before = await repo.readLocal(OWNER);
        useAppStore.setState({ dataOwner });
        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution,
            expectedUid: 'test-user-id',
            expectedConflictFingerprint: getNutritionConflictFingerprint(before?.data.pendingConflicts?.nutritionPlanning),
        });
        expect(result).toMatchObject({ ok: false, status: 'failed' });
        expect(useAppStore.getState().dispatchDomainOperation).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData?.pendingConflicts).toEqual(before?.data.pendingConflicts);
        expect(await repo.readLocal(OWNER)).toEqual(before);
    });

    it('Stale Conflict Prevention: should fail if fingerprint differs', async () => {
        const expectedUid = 'test-user-id';
        const expectedConflictFingerprint = getNutritionConflictFingerprint({ normocalorica: { kcal: 1111 }, onDaysCount: 1 });

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
        const expectedConflictFingerprint = getNutritionConflictFingerprint(
            useAppStore.getState().userData?.pendingConflicts?.nutritionPlanning
        );

        const result = await useAppStore.getState().resolveNutritionConflict({
            resolution: 'local',
            expectedUid,
            expectedConflictFingerprint
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.status).toBe('failed');

        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts?.nutritionPlanning?.normocalorica?.kcal).toBe(3000);

        const stored = await repo.readLocal(OWNER);
        expect(stored?.data.pendingConflicts?.nutritionPlanning?.normocalorica?.kcal).toBe(3000);
    });

    it('Resolved elsewhere: should return failed with conflict-resolved-elsewhere if pending is absent', async () => {
        useAppStore.setState({
            userData: parse({
                profile: { name: 'Test', height: '170', gender: 'M' },
                nutritionPlanning: { normocalorica: { kcal: 2500 } }
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
            expect(result.error).toMatchObject({ message: 'conflict-resolved-elsewhere' });
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
        if (!result.ok) {
            expect(result.status).toBe('failed');
            expect(result.error).toBeDefined();
        }

        const state = useAppStore.getState();
        expect(state.userData?.pendingConflicts?.nutritionPlanning).toBeDefined(); // No destructive mutation
        expect(state.dispatchDomainOperation).not.toHaveBeenCalled();
    });
});

describe('PR 4: Nutrition Conflict Fingerprint', () => {
    it('generates a versioned fingerprint', () => {
        const plan = { normocalorica: { kcal: 2500 }, weight: 80, onDaysCount: 4 };
        const fp = getNutritionConflictFingerprint(plan);
        expect(fp.startsWith('v4:')).toBe(true);
        expect(getNutritionConflictFingerprint({ ...plan, lockedMacro: 'carbs' } as any)).toBe(fp);
        expect(getNutritionConflictFingerprint({ ...plan, chartPeriod: 30 } as any)).toBe(fp);
        expect(getNutritionConflictFingerprint({ ...plan, totalKcal: 9999 } as typeof plan)).toBe(fp);
    });

    it('generates the same fingerprint regardless of key order', () => {
        const plan1 = { normocalorica: { kcal: 2500 }, weight: 80, onDaysCount: 4 };
        const plan2 = { weight: 80, onDaysCount: 4, normocalorica: { kcal: 2500 } }; // Different order

        expect(getNutritionConflictFingerprint(plan1)).toBe(getNutritionConflictFingerprint(plan2));
    });

    it('generates different fingerprints when scalar data changes (non-calorie)', () => {
        const plan1 = { normocalorica: { kcal: 2500 }, weight: 80, onDaysCount: 4 };
        const plan2 = { normocalorica: { kcal: 2500 }, weight: 80, onDaysCount: 5 }; // Days changed

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

    it('ignores retired top-level ratios while still comparing nested targets', () => {
        const plan = { avgMacros: { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1 } };
        const retired = { ...plan, carbsPerKg: 99, proPerKg: 99, fatPerKg: 99 };
        expect(getNutritionConflictFingerprint(retired)).toBe(getNutritionConflictFingerprint(plan));
        const edited = { avgMacros: { ...plan.avgMacros, proPerKg: 2.2 } };
        expect(getNutritionConflictFingerprint(edited)).not.toBe(getNutritionConflictFingerprint(plan));
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
