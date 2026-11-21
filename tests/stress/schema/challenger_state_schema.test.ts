import { describe, expect, it } from 'vitest';
import { UserDataSchema, ExerciseSchema, DomainParsers } from '../../../src/lib/schema';

describe('1. Zod Gateway & Defensive Schema Parsing Stress (R1-R6)', () => {
    it('1.1 UserDataSchema sanitizes corrupted activePains, library, and nested fields without crashing', () => {
        const corruptedPayload = {
            ['__proto__']: { isAdmin: true },
            profile: { name: 12345, dob: null },
            activePains: ['chest', '   ', '', null, undefined, 42, { malicious: true }, '__proto__', 'back_lats_left'],
            library: [
                {
                    id: 'ex_bw_1',
                    name: 'Trazioni alla sbarra',
                    isBodyweight: 'true', // string boolean coercion
                    equipmentWeight: 12.5,
                    setsCount: '4', // string number coercion
                    muscles: ['dorso', null, ''],
                },
                {
                    id: 'ex_bw_2',
                    name: 'Dip alle parallele',
                    isBodyweight: 1, // numeric 1 boolean coercion
                    equipmentWeight: null,
                    setsCount: -3,
                },
                {
                    // Fatal corruption item (missing id / name)
                    id: null,
                    name: null,
                }
            ],
            history: 'invalid_history_string', // Should fallback to []
            nutrition: null, // Should fallback to {}
            customFoods: undefined, // Should fallback to []
        };

        const parsed = UserDataSchema.parse(corruptedPayload);
        expect(Object.hasOwn(corruptedPayload, '__proto__')).toBe(true);
        expect(Object.hasOwn(parsed, '__proto__')).toBe(false);
        expect(Object.hasOwn(parsed, 'isAdmin')).toBe(false);
        expect(parsed).toBeDefined();
        expect(Array.isArray(parsed.activePains)).toBe(true);
        expect(parsed.activePains).toContain('chest');
        expect(parsed.activePains).toContain('back_lats_left');
        // Check library
        expect(Array.isArray(parsed.library)).toBe(true);
        const ex1 = parsed.library.find(e => e.id === 'ex_bw_1');
        expect(ex1).toBeDefined();
        expect(ex1?.isBodyweight).toBe(true);
        expect(typeof ex1?.setsCount).toBe('number');
        expect(parsed.history).toEqual([]);
        expect(parsed.nutrition).toEqual({});
    });

    it('1.2 ExerciseSchema correctly validates and coerces isBodyweight and equipmentWeight variations', () => {
        // Test boolean truthy variations
        const truthy1 = ExerciseSchema.parse({ id: 'e1', name: 'Pushups', isBodyweight: 'true' });
        expect(truthy1.isBodyweight).toBe(true);

        const truthy2 = ExerciseSchema.parse({ id: 'e2', name: 'Pushups', isBodyweight: '1' });
        expect(truthy2.isBodyweight).toBe(true);

        const truthy3 = ExerciseSchema.parse({ id: 'e3', name: 'Pushups', isBodyweight: 1 });
        expect(truthy3.isBodyweight).toBe(true);

        const falsy1 = ExerciseSchema.parse({ id: 'e4', name: 'Bench', isBodyweight: 'false' });
        expect(falsy1.isBodyweight).toBe(false);

        const falsy2 = ExerciseSchema.parse({ id: 'e5', name: 'Bench', isBodyweight: 0 });
        expect(falsy2.isBodyweight).toBe(false);

        const falsy3 = ExerciseSchema.parse({ id: 'e6', name: 'Bench', isBodyweight: null });
        expect(falsy3.isBodyweight).toBeUndefined();

        // Test equipmentWeight variations
        const eq1 = ExerciseSchema.parse({ id: 'e7', name: 'Belt Squat', equipmentWeight: 15 });
        expect(eq1.equipmentWeight).toBe(15);

        const eq2 = ExerciseSchema.parse({ id: 'e8', name: 'Belt Squat', equipmentWeight: '22.5' });
        expect(eq2.equipmentWeight).toBe(22.5);

        const eq3 = ExerciseSchema.parse({ id: 'e9', name: 'Belt Squat', equipmentWeight: 'invalid' });
        expect(eq3.equipmentWeight).toBeUndefined();

        const eq4 = ExerciseSchema.parse({ id: 'e10', name: 'Belt Squat', equipmentWeight: NaN });
        expect(eq4.equipmentWeight).toBeUndefined();
    });

    it('1.3 DomainParsers.parseActivePains cleanly filters corrupt values and whitespace', () => {
        const rawPains = ['chest', '', '   ', null, undefined, 123, {}, 'back_lats_left', 'quadriceps'];
        const cleaned = DomainParsers.parseActivePains(rawPains);
        expect(cleaned).toEqual(['chest', 'back_lats_left', 'quadriceps']);

        // Non-array input fallback
        expect(DomainParsers.parseActivePains(null)).toEqual([]);
        expect(DomainParsers.parseActivePains('chest')).toEqual([]);
        expect(DomainParsers.parseActivePains({})).toEqual([]);
    });

    it('1.4 DomainParsers.parseLibrary preserves valid records with defensive fallbacks', () => {
        const rawLib = [
            { id: 'ex1', name: 'Panca', isBodyweight: false },
            'corrupted_string',
            null,
            { id: 'ex2', name: 'Dip', isBodyweight: true, equipmentWeight: 0 },
            { random: 'data_without_id_name' }
        ];

        const parsed = DomainParsers.parseLibrary(rawLib);
        expect(parsed.length).toBe(2); // 2 valid items preserved, 3 ghosts filtered
        expect(parsed.find(e => e.id === 'ex1')?.name).toBe('Panca');
        expect(parsed.find(e => e.id === 'ex2')?.isBodyweight).toBe(true);
    });
});
