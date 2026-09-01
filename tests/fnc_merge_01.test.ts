import { describe, it, expect } from 'vitest';
import { mergeUserData, isDefaultNutritionPlanning } from '../src/lib/merge';
import { createDefaultNutritionPlanning } from '../src/lib/nutritionDefaults';
import { UserData, NutritionPlanning } from '../src/types';
import { defaultUserDataFallback } from '../src/lib/schema';
import fastDeepEqual from 'fast-deep-equal';

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
