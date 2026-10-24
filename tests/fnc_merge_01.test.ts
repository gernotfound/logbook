import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDocFromServer } from 'firebase/firestore';
import { firestoreMockStore } from './setup';

// The hydration regressions must exercise the real DB loader, not a mocked return value.
vi.unmock('../src/lib/db');
vi.mock('../src/lib/catalog/catalogService', async importOriginal => ({
    ...await importOriginal<typeof import('../src/lib/catalog/catalogService')>(),
    syncGlobalCatalog: vi.fn(async () => ({ catalog: { exercises: [], foods: [] }, updated: false })),
    getCachedCatalog: vi.fn(async () => ({ exercises: [], foods: [] })),
}));
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

describe('Nutrition planning provenance and metadata integrity', () => {
    it('classifies modern and additional fields as edited when origin is missing', () => {
        const legacy = createDefaultNutritionPlanning();
        expect(isDefaultNutritionPlanning(legacy)).toBe(true);
        const modern = { ...legacy, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 } };
        expect(isDefaultNutritionPlanning(modern)).toBe(false);
        expect(isDefaultNutritionPlanning({ ...legacy, normocalorica: { ...legacy.normocalorica, carbs: 345 } })).toBe(false);
        expect(isDefaultNutritionPlanning({ ...legacy, onDaysCount: 4 })).toBe(false);
        expect(isDefaultNutritionPlanning({ ...legacy, futureSetting: 'preserve' } as NutritionPlanning)).toBe(false);

        const cloud = buildUserData({ ...legacy, weight: 90 }, 'user-edited');
        const guest = buildUserData(modern);
        const merged = mergeUserData(cloud, guest);
        expect(merged.nutritionPlanning?.weight).toBe(90);
        expect(merged.pendingConflicts?.nutritionPlanning?.avgMacros?.carbsPerKg).toBe(3.5);
    });

    it('does not let forward-compatible nutrition keys overwrite merge metadata', () => {
        const cloud = {
            ...createDefaultNutritionPlanning(),
            weight: 90,
            activePlan: null,
            pendingConflict: null,
            activeOrigin: 'untrusted',
        };
        const guest = { ...createDefaultNutritionPlanning(), weight: 75 };
        const merged = mergeUserData(
            buildUserData(cloud, 'user-edited'),
            buildUserData(guest, 'user-edited'),
        );
        expect(merged.nutritionPlanning?.weight).toBe(90);
        expect(merged.pendingConflicts?.nutritionPlanning?.weight).toBe(75);
        expect(merged.nutritionPlanningOrigin).toBe('user-edited');
    });
});

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

// Read real Firestore-root normalization through DB.loadCloudPayload, with only
// the remote Firestore documents stubbed. The transport mock is shared with CI.
describe('Current Firestore nutritionPlanningOrigin hydration', () => {
    const ownerRoot = 'users/test-user-id';

    function seedRoot(origin: unknown, includeOrigin = true) {
        const document: Record<string, unknown> = {
            _schemaVersion: 1,
            _sync: {
                protocolVersion: 3,
                clock: {},
                fields: {},
                writer: { slot: 's00', replicaId: 'cloud-test', generation: 1, seq: 0 },
            },
            profile: { height: '180' },
            nutritionPlanning: { ...createDefaultNutritionPlanning(), weight: 90 },
        };
        if (includeOrigin) document.nutritionPlanningOrigin = origin;
        firestoreMockStore[ownerRoot] = document;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        seedRoot('user-edited');
    });

    it('R1. Firestore returns user-edited: real hydration preserves the explicit origin', async () => {
        const result = await DB.loadCloudPayload();
        expect(result?.data.nutritionPlanningOrigin).toBe('user-edited');
        expect(result?.data.nutritionPlanning?.weight).toBe(90);
        expect(result?.cloudDocuments.get('')?.nutritionPlanningOrigin).toBe('user-edited');
        expect(vi.mocked(getDocFromServer).mock.calls.some(([ref]) =>
            (ref as { path?: string }).path === ownerRoot,
        )).toBe(true);
    });

    it('R2. Firestore returns generated-default: real hydration preserves the explicit origin', async () => {
        seedRoot('generated-default');
        const result = await DB.loadCloudPayload();
        expect(result?.data.nutritionPlanningOrigin).toBe('generated-default');
        expect(result?.cloudDocuments.get('')?.nutritionPlanningOrigin).toBe('generated-default');
    });

    it('R3. Firestore root without origin: real hydration leaves origin undefined', async () => {
        seedRoot(undefined, false);
        const result = await DB.loadCloudPayload();
        expect(result?.data.nutritionPlanningOrigin).toBeUndefined();
        expect(result?.data.nutritionPlanning?.weight).toBe(90);
        expect(Object.hasOwn(result?.cloudDocuments.get('') ?? {}, 'nutritionPlanningOrigin')).toBe(false);
    });

    it('R4. Invalid Firestore origin fails closed rather than accepting a lossy normalized root', async () => {
        seedRoot('invalid_value');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(DB.loadCloudPayload()).rejects.toThrow();
            expect(vi.mocked(getDocFromServer).mock.calls.some(([ref]) =>
                (ref as { path?: string }).path === ownerRoot,
            )).toBe(true);
        } finally {
            log.mockRestore();
        }
    });

    it('R5. Hydration merge uses rehydrated cloud origin, not just heuristic', () => {
        const defaultPlan = createDefaultNutritionPlanning();
        const cloudData = buildUserData(defaultPlan, 'user-edited');
        const guestData = buildUserData({ ...defaultPlan, weight: 70 }, 'user-edited');
        const merged = mergeUserData(cloudData, guestData);

        expect(merged.nutritionPlanning?.weight).toBe(defaultPlan.weight);
        expect(merged.pendingConflicts?.nutritionPlanning?.weight).toBe(70);
    });
});
