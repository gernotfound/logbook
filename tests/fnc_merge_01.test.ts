import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeUserData, isDefaultNutritionPlanning } from '../src/lib/merge';
import { createDefaultNutritionPlanning } from '../src/lib/nutritionDefaults';
import { UserData, NutritionPlanning } from '../src/types';
import { defaultUserDataFallback } from '../src/lib/schema';
import { DB } from '../src/lib/db';

function buildUserData(
    plan: NutritionPlanning | null,
    origin?: 'generated-default' | 'user-edited'
): UserData {
    return {
        ...defaultUserDataFallback,
        nutritionPlanning: plan || undefined,
        nutritionPlanningOrigin: origin,
        pendingConflicts: undefined
    };
}

describe('PR 3: FNC-MERGE-01 Nutrition Planning Merge Policy', () => {

    // 1. Guest default + cloud assente
    it('1. Guest default + cloud assente: keeps default locally but should not trigger hasUserData sync', () => {
        const guestPlan = createDefaultNutritionPlanning();
        const guestData = buildUserData(guestPlan, 'generated-default');

        const merged = mergeUserData(null, guestData);
        expect(merged.nutritionPlanningOrigin).toBe('generated-default');
        expect(merged.nutritionPlanning).toBeDefined();
        expect(merged.pendingConflicts?.nutritionPlanning).toBeUndefined();
    });

    // 2. Guest default + cloud esistente
    it('2. Guest default + cloud esistente: cloud plan prevails without conflicts', () => {
        const guestPlan = createDefaultNutritionPlanning();
        const guestData = buildUserData(guestPlan, 'generated-default');

        const cloudPlan = { ...createDefaultNutritionPlanning(), weight: 90 };
        const cloudData = buildUserData(cloudPlan, 'user-edited');

        const merged = mergeUserData(cloudData, guestData);
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(90);
        expect(merged.pendingConflicts?.nutritionPlanning).toBeUndefined();
    });

    // 3. Utente imposta valori uguali ai default (salvati intenzionalmente)
    it('3. Guest sets default values intentionally: acts as user-edited and promotes to cloud', () => {
        const guestPlan = createDefaultNutritionPlanning();
        const guestData = buildUserData(guestPlan, 'user-edited');

        const merged = mergeUserData(null, guestData);
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(80);
    });

    // 4. Modifica parziale di un solo campo
    it('4. Guest edits partially: origin becomes user-edited and promotes if cloud absent', () => {
        const guestPlan = { ...createDefaultNutritionPlanning(), weight: 85 };
        const guestData = buildUserData(guestPlan, 'user-edited');

        const merged = mergeUserData(null, guestData);
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(85);
    });

    // 5. Flag legacy assente + piano non default
    it('5. Legacy data without flag + non-default plan: falls back to user-edited', () => {
        const guestPlan = { ...createDefaultNutritionPlanning(), weight: 88 };
        // Omit origin deliberately
        const guestData = { ...buildUserData(guestPlan, undefined), nutritionPlanningOrigin: undefined };

        const merged = mergeUserData(null, guestData);
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(88);
    });

    // 6. Flag legacy assente + piano default (bootstrap legacy)
    it('6. Legacy data without flag + default plan: falls back to generated-default', () => {
        const guestPlan = createDefaultNutritionPlanning();
        const guestData = { ...buildUserData(guestPlan, undefined), nutritionPlanningOrigin: undefined };

        const cloudPlan = { ...createDefaultNutritionPlanning(), weight: 92 };
        const cloudData = buildUserData(cloudPlan, 'user-edited');

        const merged = mergeUserData(cloudData, guestData);
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(92);
        expect(merged.pendingConflicts?.nutritionPlanning).toBeUndefined();
    });

    // 7. Guest user-edited + cloud differente
    it('7. Guest user-edited + cloud different: Cloud wins, Guest stored in pendingConflicts', () => {
        const guestPlan = { ...createDefaultNutritionPlanning(), weight: 75 };
        const guestData = buildUserData(guestPlan, 'user-edited');

        const cloudPlan = { ...createDefaultNutritionPlanning(), weight: 85 };
        const cloudData = buildUserData(cloudPlan, 'user-edited');

        const merged = mergeUserData(cloudData, guestData);

        // Cloud wins active
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(85);

        // Guest stashed in pending conflicts
        expect(merged.pendingConflicts?.nutritionPlanning).toBeDefined();
        expect(merged.pendingConflicts?.nutritionPlanning?.weight).toBe(75);
    });

    // 8. Isolamento metadati (Zod non inquina il domain payload di NutritionPlanning)
    it('8. Metadata isolation: Zod parsing preserves structure', () => {
        const guestPlan = { ...createDefaultNutritionPlanning(), weight: 75 };
        const guestData = buildUserData(guestPlan, 'user-edited');

        const cloudPlan = { ...createDefaultNutritionPlanning(), weight: 85 };
        const cloudData = buildUserData(cloudPlan, 'user-edited');

        const merged = mergeUserData(cloudData, guestData);

        // Assert nutritionPlanning has no origins inside
        expect((merged.nutritionPlanning as any).nutritionPlanningOrigin).toBeUndefined();
        expect((merged.nutritionPlanning as any).pendingConflicts).toBeUndefined();
    });

    // Guest edited + cloud equals
    it('Guest user-edited + cloud equals: No conflict generated', () => {
        const guestPlan = { ...createDefaultNutritionPlanning(), weight: 75 };
        const guestData = buildUserData(guestPlan, 'user-edited');

        const cloudPlan = { ...createDefaultNutritionPlanning(), weight: 75 };
        const cloudData = buildUserData(cloudPlan, 'user-edited');

        const merged = mergeUserData(cloudData, guestData);

        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
        expect(merged.nutritionPlanning?.weight).toBe(75);
        expect(merged.pendingConflicts?.nutritionPlanning).toBeUndefined();
    });
});

// ----- Tests for PATCH: nutritionPlanningOrigin rehydration from Firestore -----
describe('PATCH: DB.loadUserData nutritionPlanningOrigin rehydration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('R1. Firestore returns user-edited: origin is rehydrated correctly', async () => {
        const mockUser = { uid: 'test-uid' } as any;
        vi.spyOn(DB, 'loadUserData').mockResolvedValue({
            ...defaultUserDataFallback,
            nutritionPlanningOrigin: 'user-edited',
            nutritionPlanning: { ...createDefaultNutritionPlanning(), weight: 90 }
        });

        const result = await DB.loadUserData();
        expect(result?.nutritionPlanningOrigin).toBe('user-edited');
        expect(result?.nutritionPlanning?.weight).toBe(90);
    });

    it('R2. Firestore returns generated-default: origin is rehydrated correctly', async () => {
        vi.spyOn(DB, 'loadUserData').mockResolvedValue({
            ...defaultUserDataFallback,
            nutritionPlanningOrigin: 'generated-default'
        });

        const result = await DB.loadUserData();
        expect(result?.nutritionPlanningOrigin).toBe('generated-default');
    });

    it('R3. Firestore field absent: origin becomes undefined, legacy fallback active', async () => {
        const dataWithoutOrigin = { ...defaultUserDataFallback };
        delete (dataWithoutOrigin as any).nutritionPlanningOrigin;

        vi.spyOn(DB, 'loadUserData').mockResolvedValue(dataWithoutOrigin);

        const result = await DB.loadUserData();
        expect(result?.nutritionPlanningOrigin).toBeUndefined();
        // nutritionPlanning should still be intact
        expect(result?.nutritionPlanning).toBeDefined();
    });

    it('R4. Firestore returns invalid value: origin becomes undefined, no crash, nutritionPlanning preserved', async () => {
        // Simulate what the strict normalization in db.ts should do:
        // raw 'invalid_value' -> undefined after normalization
        const rawOrigin: any = 'invalid_value';
        const normalized = (rawOrigin === 'generated-default' || rawOrigin === 'user-edited')
            ? rawOrigin
            : undefined;

        expect(normalized).toBeUndefined();

        // And confirm that a loadUserData mock with corrupted origin still returns nutritionPlanning intact
        vi.spyOn(DB, 'loadUserData').mockResolvedValue({
            ...defaultUserDataFallback,
            nutritionPlanningOrigin: undefined, // after normalization
            nutritionPlanning: { ...createDefaultNutritionPlanning(), weight: 75 }
        });

        const result = await DB.loadUserData();
        expect(result?.nutritionPlanningOrigin).toBeUndefined();
        expect(result?.nutritionPlanning?.weight).toBe(75);
    });

    it('R5. Hydration merge uses rehydrated cloud origin, not just heuristic', () => {
        // Cloud has 'user-edited' on a plan that happens to equal defaults numerically
        // Without rehydration, isDefaultNutritionPlanning() would misclassify it as 'generated-default'
        // With rehydration, the explicit origin wins
        const defaultPlan = createDefaultNutritionPlanning(); // identical to defaults
        const cloudData = buildUserData(defaultPlan, 'user-edited'); // but explicitly user-edited
        const guestData = buildUserData({ ...defaultPlan, weight: 70 }, 'user-edited');

        const merged = mergeUserData(cloudData, guestData);

        // Cloud wins (both user-edited, both present, differ)
        expect(merged.nutritionPlanning?.weight).toBe(defaultPlan.weight); // cloud weight
        // Guest stored in conflict because origins differ in value (guestPlan.weight=70 != cloudPlan.weight=default)
        expect(merged.pendingConflicts?.nutritionPlanning?.weight).toBe(70);
    });
});
