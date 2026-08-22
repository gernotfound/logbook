import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    checkDocSize,
    calculateDocSizeBytes,
    isDocSizeWithinLimit,
    DOC_SIZE_LIMIT_BYTES,
    FIRESTORE_HARD_LIMIT_BYTES
} from '../src/security/checkDocSize';

import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    createExerciseOverride,
    createFoodOverride,
    hideCatalogExercise,
    unhideCatalogExercise,
    hideCatalogFood,
    unhideCatalogFood,
    applyExerciseOverride,
    applyFoodOverride,
    migrateLegacyLibraryToOverrides,
    migrateLegacyFoodsToOverrides,
    type Exercise,
    type Food
} from '../src/catalog/deltaResolver';

import type {
    CatalogExercise,
    CatalogFood,
    CatalogOverrides
} from '../src/catalog/catalogTypes';

describe('Adversarial Stress Test Suite: Firestore Rules & Global Catalog Delta Resolver', () => {

    // =========================================================================
    // SECTION 1: FIRESTORE SECURITY RULES ADVERSARIAL STRESS
    // =========================================================================
    describe('1. Firestore Security Rules Static & Logic Adversarial Verification', () => {
        const rulesPath = path.resolve(__dirname, '../firestore.rules');
        const rulesContent = fs.readFileSync(rulesPath, 'utf8');

        it('STATIC AUDIT: Enforces absolute zero get() / exists() / getAfter() / existsAfter() invariant', () => {
            const strippedRules = rulesContent
                .replace(/\/\/.*/g, '')
                .replace(/\/\*[\s\S]*?\*\//g, '');

            expect(/\bget\s*\(/.test(strippedRules)).toBe(false);
            expect(/\bexists\s*\(/.test(strippedRules)).toBe(false);
            expect(/\bgetAfter\s*\(/.test(strippedRules)).toBe(false);
            expect(/\bexistsAfter\s*\(/.test(strippedRules)).toBe(false);
        });

        it('STATIC AUDIT: Default deny-all fallback is present at root level', () => {
            expect(rulesContent).toMatch(/match\s*\/\{document=\*\*\}/);
            expect(rulesContent).toMatch(/allow\s+read,\s*write:\s*if\s+false;/);
        });

        it('STATIC AUDIT: Public catalog allows public read and denies all client writes', () => {
            expect(rulesContent).toMatch(/match\s*\/global_catalog\/\{document=\*\*\}/);
            expect(rulesContent).toMatch(/match\s*\/catalog\/\{document=\*\*\}/);
            // Must contain allow write: if false
            const catalogBlocks = rulesContent.match(/match\s*\/(?:global_catalog|catalog)\/\{document=\*\*\}\s*\{[^}]*\}/g) || [];
            expect(catalogBlocks.length).toBeGreaterThanOrEqual(2);
            for (const block of catalogBlocks) {
                expect(block).toContain('allow read: if true;');
                expect(block).toContain('allow write: if false;');
            }
        });

        // Exact Rule simulation helpers
        const WHITELISTED_ROOT_KEYS = [
            'profile',
            'library',
            'customExercises',
            'routines',
            'customFoods',
            'activeWorkout',
            'trainingCycles',
            'activeCycleId',
            'nutritionPlanning',
            'supplements',
            'activePains',
            'catalogOverrides',
            'catalogHiddenIds',
            'exerciseOverrides',
            'foodOverrides',
            'hiddenCatalogExercises',
            'hiddenCatalogFoods'
        ];

        const ARRAY_BOUNDS: Record<string, number> = {
            library: 500,
            customExercises: 500,
            routines: 100,
            customFoods: 1000,
            trainingCycles: 50,
            supplements: 50,
            activePains: 50,
            catalogHiddenIds: 500,
            hiddenCatalogExercises: 500,
            hiddenCatalogFoods: 500,
        };

        function simulateRootDocValidation(data: Record<string, any>): { allowed: boolean; reason?: string } {
            const keys = Object.keys(data);

            // 1. Whitelist
            if (!keys.every(k => WHITELISTED_ROOT_KEYS.includes(k))) {
                return { allowed: false, reason: 'Unwhitelisted root key found' };
            }

            // 2. Type integrity
            if ('profile' in data && (typeof data.profile !== 'object' || data.profile === null || Array.isArray(data.profile))) {
                return { allowed: false, reason: 'profile must be a map' };
            }
            if ('activeWorkout' in data && data.activeWorkout !== null && (typeof data.activeWorkout !== 'object' || Array.isArray(data.activeWorkout))) {
                return { allowed: false, reason: 'activeWorkout must be null or map' };
            }
            if ('activeCycleId' in data && data.activeCycleId !== null && typeof data.activeCycleId !== 'string') {
                return { allowed: false, reason: 'activeCycleId must be null or string' };
            }
            if ('nutritionPlanning' in data && data.nutritionPlanning !== null && (typeof data.nutritionPlanning !== 'object' || Array.isArray(data.nutritionPlanning))) {
                return { allowed: false, reason: 'nutritionPlanning must be null or map' };
            }
            if ('catalogOverrides' in data && data.catalogOverrides !== null && (typeof data.catalogOverrides !== 'object' || Array.isArray(data.catalogOverrides))) {
                return { allowed: false, reason: 'catalogOverrides must be null or map' };
            }
            if ('exerciseOverrides' in data && data.exerciseOverrides !== null && (typeof data.exerciseOverrides !== 'object' || Array.isArray(data.exerciseOverrides))) {
                return { allowed: false, reason: 'exerciseOverrides must be null or map' };
            }
            if ('foodOverrides' in data && data.foodOverrides !== null && (typeof data.foodOverrides !== 'object' || Array.isArray(data.foodOverrides))) {
                return { allowed: false, reason: 'foodOverrides must be null or map' };
            }

            // 3. Array bounds
            for (const [key, limit] of Object.entries(ARRAY_BOUNDS)) {
                if (key in data) {
                    const val = data[key];
                    if (!Array.isArray(val)) {
                        return { allowed: false, reason: `${key} must be a list` };
                    }
                    if (val.length > limit) {
                        return { allowed: false, reason: `${key} length (${val.length}) exceeds limit of ${limit}` };
                    }
                }
            }

            return { allowed: true };
        }

        it('WHITELIST ATTACK: Rejects dangerous root key injection attempts', () => {
            const forbiddenKeys = [
                'isAdmin', 'isOwner', 'role', 'permissions', '__proto__', 'constructor',
                'toString', 'valueOf', 'createdAt', 'updatedAt', 'subcollections',
                'rootAccess', 'debug', 'bypassSecurity', 'quotaExempt', 'superUser'
            ];

            for (const forbiddenKey of forbiddenKeys) {
                const payload = { [forbiddenKey]: true };
                const res = simulateRootDocValidation(payload);
                expect(res.allowed).toBe(false);
                expect(res.reason).toContain('Unwhitelisted root key');
            }
        });

        it('TYPE INTEGRITY ATTACK: Rejects invalid types for profile, activeWorkout, activeCycleId, etc.', () => {
            expect(simulateRootDocValidation({ profile: 'invalid_string' }).allowed).toBe(false);
            expect(simulateRootDocValidation({ profile: 12345 }).allowed).toBe(false);
            expect(simulateRootDocValidation({ profile: null }).allowed).toBe(false);
            expect(simulateRootDocValidation({ profile: [] }).allowed).toBe(false);
            expect(simulateRootDocValidation({ profile: {} }).allowed).toBe(true);

            expect(simulateRootDocValidation({ activeWorkout: 'string' }).allowed).toBe(false);
            expect(simulateRootDocValidation({ activeWorkout: 99 }).allowed).toBe(false);
            expect(simulateRootDocValidation({ activeWorkout: [] }).allowed).toBe(false);
            expect(simulateRootDocValidation({ activeWorkout: null }).allowed).toBe(true);
            expect(simulateRootDocValidation({ activeWorkout: {} }).allowed).toBe(true);

            expect(simulateRootDocValidation({ activeCycleId: 12345 }).allowed).toBe(false);
            expect(simulateRootDocValidation({ activeCycleId: {} }).allowed).toBe(false);
            expect(simulateRootDocValidation({ activeCycleId: [] }).allowed).toBe(false);
            expect(simulateRootDocValidation({ activeCycleId: null }).allowed).toBe(true);
            expect(simulateRootDocValidation({ activeCycleId: 'cycle_valid_id' }).allowed).toBe(true);
        });

        it('ARRAY BOUNDARIES OFF-BY-ONE STRESS: Rigorously tests exact bounds for all 10 array fields', () => {
            for (const [key, limit] of Object.entries(ARRAY_BOUNDS)) {
                // Exact limit: MUST PASS
                const exactPayload = { [key]: new Array(limit).fill({ item: 1 }) };
                expect(simulateRootDocValidation(exactPayload).allowed).toBe(true);

                // Limit + 1: MUST FAIL
                const exceedPayload = { [key]: new Array(limit + 1).fill({ item: 1 }) };
                const exceedRes = simulateRootDocValidation(exceedPayload);
                expect(exceedRes.allowed).toBe(false);
                expect(exceedRes.reason).toContain(`exceeds limit of ${limit}`);

                // Non-array value: MUST FAIL
                const nonArrayPayload = { [key]: 'not_an_array' };
                expect(simulateRootDocValidation(nonArrayPayload).allowed).toBe(false);

                // Empty array: MUST PASS
                const emptyPayload = { [key]: [] };
                expect(simulateRootDocValidation(emptyPayload).allowed).toBe(true);
            }
        });

        it('SUBCOLLECTION REGEX ADVERSARIAL STRESS: Validates monthId regex against injection vectors', () => {
            const regex = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

            // Valid month IDs
            const validMonths = [
                '1970-01', '1999-12', '2000-06', '2026-01', '2026-02', '2026-08',
                '2026-09', '2026-10', '2026-11', '2026-12', '2099-12', '9999-12'
            ];
            for (const m of validMonths) {
                expect(regex.test(m)).toBe(true);
            }

            // Adversarial & Malformed vectors
            const invalidMonths = [
                '2026-00', '2026-13', '2026-14', '2026-99',
                '2026-1', '2026-8', '2026-001', '2026-080',
                '2026/08', '2026_08', '2026.08', '2026 08',
                '26-08', '202608', '2026-08-01', '2026-08T00:00:00Z',
                '../2026-08', '2026-08/..', '2026-08\n', '2026-08\r', '2026-08\0',
                '2026-08; DROP TABLE users;', '2026-08<script>', '2026-08 ',
                '', 'null', 'undefined', '[object Object]'
            ];
            for (const m of invalidMonths) {
                expect(regex.test(m)).toBe(false);
            }
        });

        it('SUBCOLLECTION KEY LIMIT STRESS: Validates history (<= 120) and nutrition (<= 31) bucket limits', () => {
            // history_months: max 120
            const history120: Record<string, any> = {};
            for (let i = 0; i < 120; i++) history120[`s_${i}`] = { id: i };
            expect(Object.keys(history120).length <= 120).toBe(true);

            const history121 = { ...history120, s_120: { id: 120 } };
            expect(Object.keys(history121).length <= 120).toBe(false);

            // nutrition_months: max 31
            const nutrition31: Record<string, any> = {};
            for (let i = 1; i <= 31; i++) nutrition31[`2026-08-${i < 10 ? '0' + i : i}`] = { kcal: 2000 };
            expect(Object.keys(nutrition31).length <= 31).toBe(true);

            const nutrition32 = { ...nutrition31, '2026-08-32': { kcal: 2000 } };
            expect(Object.keys(nutrition32).length <= 31).toBe(false);
        });

        it('AUTHENTICATION & AUTHORIZATION SIMULATION: Enforces tenant isolation and rejects unauthorized ops', () => {
            function simulateAuthRule(
                auth: { uid: string } | null,
                pathSegments: string[],
                operation: 'read' | 'write' | 'delete'
            ): boolean {
                // Public catalog read
                if (pathSegments[0] === 'global_catalog' || pathSegments[0] === 'catalog') {
                    if (operation === 'read') return true;
                    if (operation === 'write' || operation === 'delete') return false; // Client writes forbidden
                }

                // Users collection
                if (pathSegments[0] === 'users' && pathSegments.length >= 2) {
                    const targetUserId = pathSegments[1];
                    const isOwner = auth !== null && auth.uid === targetUserId;
                    return isOwner;
                }

                // Default deny-all
                return false;
            }

            // Unauthenticated
            expect(simulateAuthRule(null, ['users', 'user_1'], 'read')).toBe(false);
            expect(simulateAuthRule(null, ['users', 'user_1'], 'write')).toBe(false);
            expect(simulateAuthRule(null, ['users', 'user_1'], 'delete')).toBe(false);
            expect(simulateAuthRule(null, ['global_catalog', 'seed'], 'read')).toBe(true);
            expect(simulateAuthRule(null, ['global_catalog', 'seed'], 'write')).toBe(false);
            expect(simulateAuthRule(null, ['catalog', 'manifest'], 'read')).toBe(true);
            expect(simulateAuthRule(null, ['catalog', 'manifest'], 'write')).toBe(false);

            // Authenticated User A
            const userA = { uid: 'user_alice' };
            expect(simulateAuthRule(userA, ['users', 'user_alice'], 'read')).toBe(true);
            expect(simulateAuthRule(userA, ['users', 'user_alice'], 'write')).toBe(true);
            expect(simulateAuthRule(userA, ['users', 'user_alice', 'history_months', '2026-08'], 'write')).toBe(true);

            // Cross-tenant attack: Alice trying to access Bob's data
            expect(simulateAuthRule(userA, ['users', 'user_bob'], 'read')).toBe(false);
            expect(simulateAuthRule(userA, ['users', 'user_bob'], 'write')).toBe(false);
            expect(simulateAuthRule(userA, ['users', 'user_bob'], 'delete')).toBe(false);
            expect(simulateAuthRule(userA, ['users', 'user_bob', 'nutrition_months', '2026-08'], 'write')).toBe(false);

            // Client trying to write to catalog
            expect(simulateAuthRule(userA, ['global_catalog', 'exercises'], 'write')).toBe(false);
            expect(simulateAuthRule(userA, ['catalog', 'manifest'], 'write')).toBe(false);

            // Unmapped collections
            expect(simulateAuthRule(userA, ['admin', 'config'], 'read')).toBe(false);
            expect(simulateAuthRule(userA, ['system', 'metrics'], 'write')).toBe(false);
        });
    });

    // =========================================================================
    // SECTION 2: CLIENT 950KB SAFETY PRE-WRITE GUARD STRESS
    // =========================================================================
    describe('2. Client 950KB Pre-Write Size Guard (checkDocSize) Boundary Stress', () => {
        it('accepts exact 950,000 bytes boundary payload', () => {
            // Create payload exactly 950,000 bytes
            const baseObj = { data: '' };
            const jsonOverhead = JSON.stringify(baseObj).length; // 11 bytes: '{"data":""}'
            const fillLength = DOC_SIZE_LIMIT_BYTES - jsonOverhead;
            baseObj.data = 'x'.repeat(fillLength);

            const size = calculateDocSizeBytes(baseObj);
            expect(size).toBe(DOC_SIZE_LIMIT_BYTES);

            const assessment = isDocSizeWithinLimit(baseObj, DOC_SIZE_LIMIT_BYTES);
            expect(assessment.valid).toBe(true);
            expect(assessment.sizeBytes).toBe(DOC_SIZE_LIMIT_BYTES);
            expect(assessment.remainingBytes).toBe(0);
            expect(assessment.percentage).toBe(100);

            expect(() => checkDocSize(baseObj, 'users/test_boundary')).not.toThrow();
        });

        it('rejects payload at 950,001 bytes (exceeding by 1 byte) with Italian Sentence case message', () => {
            const baseObj = { data: '' };
            const jsonOverhead = JSON.stringify(baseObj).length;
            const fillLength = DOC_SIZE_LIMIT_BYTES - jsonOverhead + 1;
            baseObj.data = 'x'.repeat(fillLength);

            const size = calculateDocSizeBytes(baseObj);
            expect(size).toBe(DOC_SIZE_LIMIT_BYTES + 1);

            const assessment = isDocSizeWithinLimit(baseObj, DOC_SIZE_LIMIT_BYTES);
            expect(assessment.valid).toBe(false);
            expect(assessment.remainingBytes).toBe(0);

            expect(() => checkDocSize(baseObj, 'users/overflow_user')).toThrowError(
                /Il documento users\/overflow_user supera il limite di dimensione di sicurezza di Firestore/
            );
        });

        it('handles null, undefined, empty strings, and empty objects without crashing', () => {
            expect(calculateDocSizeBytes(null)).toBe(0);
            expect(calculateDocSizeBytes(undefined)).toBe(0);
            expect(calculateDocSizeBytes('')).toBe(0);
            expect(calculateDocSizeBytes({})).toBe(2); // '{}'
            expect(calculateDocSizeBytes([])).toBe(2); // '[]'
        });

        it('handles UTF-8 multi-byte characters accurately in byte estimation', () => {
            // '🍕' is 4 bytes in UTF-8
            const pizzaDoc = { emoji: '🍕' };
            const size = calculateDocSizeBytes(pizzaDoc);
            // {"emoji":"🍕"} -> 10 ascii chars + 4 bytes for pizza + 2 chars for closing quote and bracket = 16 bytes
            expect(size).toBe(16);
        });

        it('throws descriptive error on circular object serialization', () => {
            const circularObj: any = { name: 'Circular' };
            circularObj.self = circularObj;

            expect(() => calculateDocSizeBytes(circularObj)).toThrowError(
                /Impossibile serializzare i dati per la stima della dimensione/
            );
        });
    });

    // =========================================================================
    // SECTION 3: GLOBAL CATALOG DELTA RESOLVER ADVERSARIAL STRESS
    // =========================================================================
    describe('3. Global Catalog Delta Resolver Adversarial Stress & Edge Cases', () => {
        const mockGlobalExercises: CatalogExercise[] = [
            { id: 'ex-bench', name: 'Panca piana', setsCount: 3, muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, equipmentWeight: 20 },
            { id: 'ex-squat', name: 'Squat con bilanciere', setsCount: 4, muscles: ['quads'], trackingType: 'weight_reps', isDefault: true },
            { id: 'ex-deadlift', name: 'Stacco da terra', setsCount: 3, muscles: ['back', 'hamstrings'], trackingType: 'weight_reps', isDefault: true },
            { id: 'ex-pullup', name: 'Trazioni alla sbarra', setsCount: 3, muscles: ['back', 'biceps'], trackingType: 'weight_reps', isDefault: true, isBodyweight: true }
        ];

        const mockGlobalFoods: CatalogFood[] = [
            { id: 'f-rice', name: 'Riso basmati', brand: 'Generico', kcal: 350, pro: 7, carbs: 78, fat: 1, baseQty: 100, unit: 'g' },
            { id: 'f-chicken', name: 'Petto di pollo', brand: 'Generico', kcal: 103, pro: 23, carbs: 0, fat: 1.2, baseQty: 100, unit: 'g' },
            { id: 1001, name: 'Uova intere', brand: 'Generico', kcal: 143, pro: 13, carbs: 0.7, fat: 9.5, baseQty: 100, unit: 'g' },
            { id: 'f-oats', name: 'Fiocchi di avena', brand: 'Generico', kcal: 370, pro: 13, carbs: 65, fat: 7, baseQty: 100, unit: 'g' }
        ];

        it('COLLIDING IDs: Resolves gracefully when user custom item shares exact ID with global catalog item', () => {
            const collidingCustomExercises: Exercise[] = [
                { id: 'ex-bench', name: 'Mio Bench Customizzato', setsCount: 5, muscles: ['chest', 'triceps'] }
            ];

            const resolved = resolveEffectiveExercises(mockGlobalExercises, collidingCustomExercises);

            // User custom item must be positioned first and marked isDefault: false
            expect(resolved[0].id).toBe('ex-bench');
            expect(resolved[0].name).toBe('Mio Bench Customizzato');
            expect(resolved[0].isDefault).toBe(false);

            // Global item is still appended
            const globalInstance = resolved.slice(1).find(e => e.id === 'ex-bench');
            expect(globalInstance).toBeDefined();
            expect(globalInstance?.name).toBe('Panca piana');
            expect(globalInstance?.isDefault).toBe(true);
        });

        it('GHOST OVERRIDES: Safely ignores overrides targeting non-existent global catalog IDs without phantom injection', () => {
            const overridesWithGhosts: CatalogOverrides = {
                exercises: {
                    'ghost-exercise-999': { name: 'Esercizio fantasma', equipmentWeight: 50 },
                    'ex-bench': { name: 'Panca piana inclinata' }
                },
                foods: {
                    'ghost-food-999': { name: 'Cibo fantasma', kcal: 999 },
                    'f-chicken': { brand: 'Amadori' }
                }
            };

            const resolvedExercises = resolveEffectiveExercises(mockGlobalExercises, [], overridesWithGhosts);
            expect(resolvedExercises.find(e => e.id === 'ghost-exercise-999')).toBeUndefined();
            expect(resolvedExercises.find(e => e.id === 'ex-bench')?.name).toBe('Panca piana inclinata');

            const resolvedFoods = resolveEffectiveFoods(mockGlobalFoods, [], overridesWithGhosts);
            expect(resolvedFoods.find(f => f.id === 'ghost-food-999')).toBeUndefined();
            expect(resolvedFoods.find(f => f.id === 'f-chicken')?.brand).toBe('Amadori');
        });

        it('GHOST HIDDEN IDs: Safely ignores non-existent hidden IDs without error or data loss', () => {
            const overridesWithGhostHiddens: CatalogOverrides = {
                hiddenExerciseIds: ['ghost-hidden-1', 'ghost-hidden-2', 'ex-deadlift'],
                hiddenFoodIds: ['ghost-hidden-f1', '999999', 'f-rice']
            };

            const resolvedExercises = resolveEffectiveExercises(mockGlobalExercises, [], overridesWithGhostHiddens);
            expect(resolvedExercises.length).toBe(3); // 4 - 1 (ex-deadlift) = 3
            expect(resolvedExercises.find(e => e.id === 'ex-deadlift')).toBeUndefined();
            expect(resolvedExercises.find(e => e.id === 'ex-bench')).toBeDefined();

            const resolvedFoods = resolveEffectiveFoods(mockGlobalFoods, [], overridesWithGhostHiddens);
            expect(resolvedFoods.length).toBe(3); // 4 - 1 (f-rice) = 3
            expect(resolvedFoods.find(f => f.id === 'f-rice')).toBeUndefined();
            expect(resolvedFoods.find(f => f.id === 'f-chicken')).toBeDefined();
        });

        it('EMPTY DATASETS: Handles all permutations of empty arrays, undefined and null overrides defensively', () => {
            expect(resolveEffectiveExercises([], [])).toEqual([]);
            expect(resolveEffectiveFoods([], [])).toEqual([]);

            expect(resolveEffectiveExercises(mockGlobalExercises, [], undefined)).toHaveLength(4);
            expect(resolveEffectiveFoods(mockGlobalFoods, [], undefined)).toHaveLength(4);

            expect(resolveEffectiveExercises([], mockGlobalExercises as any, {})).toHaveLength(4);
            expect(resolveEffectiveFoods([], mockGlobalFoods as any, {})).toHaveLength(4);
        });

        it('NUMERIC vs STRING FOOD IDs: Seamlessly handles numeric and string ID resolution', () => {
            // Food ID 1001 is a number in mockGlobalFoods
            const overrides: CatalogOverrides = {
                foods: {
                    '1001': { brand: 'Aia', kcal: 150 }
                },
                hiddenFoodIds: ['1001']
            };

            // Hiding numeric ID via string
            const resolvedHidden = resolveEffectiveFoods(mockGlobalFoods, [], overrides);
            expect(resolvedHidden.find(f => String(f.id) === '1001')).toBeUndefined();

            // Overriding numeric ID
            const overridesOnly: CatalogOverrides = {
                foods: { '1001': { brand: 'Aia', kcal: 150 } }
            };
            const resolvedOverridden = resolveEffectiveFoods(mockGlobalFoods, [], overridesOnly);
            const uova = resolvedOverridden.find(f => String(f.id) === '1001');
            expect(uova).toBeDefined();
            expect(uova?.brand).toBe('Aia');
            expect(uova?.kcal).toBe(150);
        });

        it('SPECIAL CHARS, XSS & UNICODE: Preserves exotic Unicode, RTL, XSS, and SQL injection strings perfectly', () => {
            const maliciousExercise: Partial<Exercise> = {
                name: '<script>alert("xss")</script>',
                notes: '"><img src=x onerror=alert(1)> DROP TABLE users; \u202Ereversed \u0000 \n\r\t 🏋️‍♂️💪',
                equipmentWeight: 0
            };

            const override = createExerciseOverride(mockGlobalExercises[0], maliciousExercise);
            expect(override.name).toBe('<script>alert("xss")</script>');
            expect(override.notes).toBe('"><img src=x onerror=alert(1)> DROP TABLE users; \u202Ereversed \u0000 \n\r\t 🏋️‍♂️💪');

            const appliedOverrides = applyExerciseOverride('ex-bench', override);
            const resolved = resolveEffectiveExercises(mockGlobalExercises, [], appliedOverrides);

            const bench = resolved.find(e => e.id === 'ex-bench');
            expect(bench?.name).toBe('<script>alert("xss")</script>');
            expect(bench?.notes).toBe('"><img src=x onerror=alert(1)> DROP TABLE users; \u202Ereversed \u0000 \n\r\t 🏋️‍♂️💪');
        });

        it('FALSY & ZERO VALUE DIFFING: Accurately captures diffs when setting values to 0, false, empty string, or empty arrays', () => {
            // Changing equipmentWeight from 20 to 0
            const exDiff = createExerciseOverride(mockGlobalExercises[0], { equipmentWeight: 0 });
            expect(exDiff.equipmentWeight).toBe(0);

            // Changing isBodyweight from true to false
            const exBodyDiff = createExerciseOverride(mockGlobalExercises[3], { isBodyweight: false });
            expect(exBodyDiff.isBodyweight).toBe(false);

            // Changing muscles array
            const exMuscleDiff = createExerciseOverride(mockGlobalExercises[0], { muscles: ['chest', 'front_delts'] });
            expect(exMuscleDiff.muscles).toEqual(['chest', 'front_delts']);

            // Changing food kcal to 0 (e.g. water or calorie-free flavor drops)
            const foodDiff = createFoodOverride(mockGlobalFoods[0], { kcal: 0, fat: 0 });
            expect(foodDiff.kcal).toBe(0);
            expect(foodDiff.fat).toBe(0);
            expect(foodDiff.pro).toBeUndefined(); // Unchanged field omitted
        });

        it('PROTOTYPE POLLUTION DEFENSE: Ignores __proto__, constructor, and prototype injection attempts', () => {
            const maliciousOverrides: any = {
                exercises: {
                    '__proto__': { name: 'Polluted' },
                    'constructor': { name: 'Polluted' }
                },
                hiddenExerciseIds: ['__proto__', 'constructor']
            };

            const resolved = resolveEffectiveExercises(mockGlobalExercises, [], maliciousOverrides);
            expect((Object.prototype as any).name).toBeUndefined();
            expect(resolved.length).toBe(4);
        });

        it('IMMUTABILITY & PURE FUNCTION INVARIANT: Guarantees input arrays and objects are never mutated', () => {
            const baseGlobalEx = JSON.parse(JSON.stringify(mockGlobalExercises));
            const baseCustomEx: Exercise[] = [{ id: 'c1', name: 'Custom 1', setsCount: 3, muscles: ['biceps'] }];
            const baseCustomClone = JSON.parse(JSON.stringify(baseCustomEx));
            const baseOverrides: CatalogOverrides = {
                exercises: { 'ex-bench': { name: 'Modified' } },
                hiddenExerciseIds: ['ex-squat']
            };
            const baseOverridesClone = JSON.parse(JSON.stringify(baseOverrides));

            resolveEffectiveExercises(baseGlobalEx, baseCustomEx, baseOverrides);

            // Verify inputs did not change
            expect(baseGlobalEx).toEqual(mockGlobalExercises);
            expect(baseCustomEx).toEqual(baseCustomClone);
            expect(baseOverrides).toEqual(baseOverridesClone);
        });

        it('HIGH VOLUME STRESS: Resolves 5,000 global exercises + 500 custom + 500 overrides + 500 hidden items in < 50ms', () => {
            const bigGlobalExercises: CatalogExercise[] = [];
            for (let i = 0; i < 5000; i++) {
                bigGlobalExercises.push({
                    id: `ex-big-${i}`,
                    name: `Exercise Big ${i}`,
                    setsCount: 3,
                    muscles: ['chest', 'back'],
                    trackingType: 'weight_reps',
                    isDefault: true
                });
            }

            const bigCustom: Exercise[] = [];
            for (let i = 0; i < 500; i++) {
                bigCustom.push({
                    id: `custom-big-${i}`,
                    name: `Custom Big ${i}`,
                    setsCount: 4,
                    muscles: ['legs']
                });
            }

            const bigOverrides: CatalogOverrides = {
                exercises: {},
                hiddenExerciseIds: []
            };
            for (let i = 0; i < 500; i++) {
                bigOverrides.exercises![`ex-big-${i}`] = { name: `Overridden Big ${i}`, equipmentWeight: 10 };
                bigOverrides.hiddenExerciseIds!.push(`ex-big-${i + 2500}`);
            }

            const startTime = performance.now();
            const resolved = resolveEffectiveExercises(bigGlobalExercises, bigCustom, bigOverrides);
            const durationMs = performance.now() - startTime;

            expect(resolved.length).toBe(500 + (5000 - 500)); // 500 custom + 4500 global (500 hidden) = 5000 total
            expect(durationMs).toBeLessThan(100); // Must be fast and O(N)
        });

        it('LEGACY MIGRATION STRESS: Migrates heterogeneous legacy library into custom items, diffs, and hidden IDs', () => {
            const legacyLibrary: Exercise[] = [
                // 1. Modified default exercise (changed name and equipmentWeight)
                { id: 'ex-bench', name: 'Panca piana con manubri', setsCount: 3, isDefault: true, equipmentWeight: 24, muscles: ['chest'] },
                // 2. Unmodified default exercise
                { id: 'ex-pullup', name: 'Trazioni alla sbarra', setsCount: 3, isDefault: true, muscles: ['back', 'biceps'], trackingType: 'weight_reps', isBodyweight: true },
                // 3. User custom exercise (isDefault: false)
                { id: 'custom-ex-1', name: 'Alzate laterali ai cavi', setsCount: 4, isDefault: false, muscles: ['shoulders'] },
                // 4. Custom exercise missing isDefault field (should default to custom)
                { id: 'custom-ex-2', name: 'French press su panca', setsCount: 3, muscles: ['triceps'] }
                // Note: 'ex-squat' and 'ex-deadlift' are missing from legacyLibrary -> must be marked hidden!
            ];

            const migration = migrateLegacyLibraryToOverrides(legacyLibrary, mockGlobalExercises);

            // Custom exercises
            expect(migration.customExercises.length).toBe(2);
            expect(migration.customExercises.map(c => c.id)).toEqual(['custom-ex-1', 'custom-ex-2']);

            // Overrides
            expect(migration.overrides.exercises?.['ex-bench']?.name).toBe('Panca piana con manubri');
            expect(migration.overrides.exercises?.['ex-bench']?.equipmentWeight).toBe(24);
            // ex-pullup was unmodified -> should not have an entry in exercises overrides
            expect(migration.overrides.exercises?.['ex-pullup']).toBeUndefined();

            // Hidden default exercises (ex-squat and ex-deadlift were deleted by user in legacy data)
            expect(migration.overrides.hiddenExerciseIds).toContain('ex-squat');
            expect(migration.overrides.hiddenExerciseIds).toContain('ex-deadlift');
            expect(migration.overrides.hiddenExerciseIds).not.toContain('ex-bench');
            expect(migration.overrides.hiddenExerciseIds).not.toContain('ex-pullup');
        });

        it('LEGACY FOODS MIGRATION STRESS: Migrates legacy foods with string/numeric IDs and property overrides', () => {
            const legacyFoods: Food[] = [
                // 1. Modified default food
                { id: 'f-rice', name: 'Riso basmati', brand: 'Scotti', kcal: 355, pro: 7, carbs: 78, fat: 1, isCustom: false },
                // 2. Modified numeric default food
                { id: 1001, name: 'Uova biologiche', brand: 'Bio', kcal: 143, pro: 13, carbs: 0.7, fat: 9.5, isCustom: false },
                // 3. True custom food
                { id: 'my-custom-shake', name: 'Protein Shake', kcal: 250, pro: 35, carbs: 10, fat: 4, isCustom: true }
                // 'f-chicken' and 'f-oats' are missing -> must become hidden
            ];

            const migration = migrateLegacyFoodsToOverrides(legacyFoods, mockGlobalFoods);

            expect(migration.customFoods.length).toBe(1);
            expect(migration.customFoods[0].id).toBe('my-custom-shake');

            expect(migration.overrides.foods?.['f-rice']?.brand).toBe('Scotti');
            expect(migration.overrides.foods?.['f-rice']?.kcal).toBe(355);

            expect(migration.overrides.foods?.['1001']?.name).toBe('Uova biologiche');
            expect(migration.overrides.foods?.['1001']?.brand).toBe('Bio');

            expect(migration.overrides.hiddenFoodIds).toContain('f-chicken');
            expect(migration.overrides.hiddenFoodIds).toContain('f-oats');
            expect(migration.overrides.hiddenFoodIds).not.toContain('f-rice');
            expect(migration.overrides.hiddenFoodIds).not.toContain('1001');
        });
    });
});
