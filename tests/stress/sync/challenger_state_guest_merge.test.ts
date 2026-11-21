import { describe, expect, it } from 'vitest';
import { defaultUserDataFallback } from '../../../src/lib/schema';
import { mergeUserData, hasUserData } from '../../../src/lib/merge';
import type { UserData, Exercise } from '../../../src/types';

describe('2. Deterministic Guest-to-Cloud Merge Resilience (R1-R6)', () => {
    it('2.1 mergeUserData correctly performs union and deduplication of activePains', () => {
        const cloudData: UserData = {
            ...defaultUserDataFallback,
            activePains: ['chest', 'biceps_left'],
        };

        const guestData: UserData = {
            ...defaultUserDataFallback,
            activePains: ['biceps_left', 'quadriceps', 'back_lats'],
        };

        const merged = mergeUserData(cloudData, guestData);
        expect(merged.activePains).toHaveLength(4);
        expect(merged.activePains).toContain('chest');
        expect(merged.activePains).toContain('biceps_left');
        expect(merged.activePains).toContain('quadriceps');
        expect(merged.activePains).toContain('back_lats');
    });

    it('2.2 mergeUserData preserves guest priority on library collisions with isBodyweight & equipmentWeight', () => {
        const cloudData: UserData = {
            ...defaultUserDataFallback,
            library: [
                { id: 'ex_dip', name: 'Dip', setsCount: 3, isBodyweight: false, sets: [] },
                { id: 'ex_squat', name: 'Squat', setsCount: 4, sets: [] }
            ]
        };

        const guestData: UserData = {
            ...defaultUserDataFallback,
            library: [
                { id: 'ex_dip', name: 'Dip alle parallele (Guest)', setsCount: 4, isBodyweight: true, equipmentWeight: 10, sets: [] },
                { id: 'ex_pullup', name: 'Pullup', setsCount: 3, isBodyweight: true, sets: [] }
            ]
        };

        const merged = mergeUserData(cloudData, guestData);
        expect(merged.library).toHaveLength(3);
        const dip = merged.library?.find(e => e.id === 'ex_dip');
        expect(dip?.name).toBe('Dip alle parallele (Guest)');
        expect(dip?.isBodyweight).toBe(true);
        expect(dip?.equipmentWeight).toBe(10);
        expect(dip?.setsCount).toBe(4);

        expect(merged.library?.some(e => e.id === 'ex_squat')).toBe(true);
        expect(merged.library?.some(e => e.id === 'ex_pullup')).toBe(true);
    });

    it('2.3 hasUserData returns true when only activePains or bodyweight exercises exist', () => {
        expect(hasUserData(null)).toBe(false);
        // Generated default planning is not user-created data.
        expect(hasUserData(defaultUserDataFallback)).toBe(false);
        expect(hasUserData({} as UserData)).toBe(false);

        const dataWithPainOnly: UserData = {
            ...defaultUserDataFallback,
            activePains: ['shoulders_right']
        };
        expect(hasUserData(dataWithPainOnly)).toBe(true);

        const dataWithLibOnly: UserData = {
            ...defaultUserDataFallback,
            library: [{ id: 'ex1', name: 'Custom Pushup', setsCount: 3, isBodyweight: true, sets: [] }]
        };
        expect(hasUserData(dataWithLibOnly)).toBe(true);
    });

    it('2.4 High volume merge preserves the identity and guest precedence of all 500 collisions', () => {
        const cloudLib: Exercise[] = [];
        const guestLib: Exercise[] = [];
        for (let i = 0; i < 500; i++) {
            cloudLib.push({ id: `ex_${i}`, name: `Cloud Ex ${i}`, setsCount: 3, sets: [] });
            guestLib.push({ id: `ex_${i}`, name: `Guest Ex ${i}`, setsCount: 4, isBodyweight: i % 2 === 0, equipmentWeight: i, sets: [] });
        }

        const cloudData: UserData = { ...defaultUserDataFallback, library: cloudLib, activePains: ['chest'] };
        const guestData: UserData = { ...defaultUserDataFallback, library: guestLib, activePains: ['back_lats'] };

        const merged = mergeUserData(cloudData, guestData);

        expect(merged.library).toHaveLength(500);
        expect(new Set(merged.library?.map(exercise => exercise.id)).size).toBe(500);
        for (let i = 0; i < 500; i++) {
            expect(merged.library?.find(exercise => exercise.id === `ex_${i}`)).toMatchObject({
                name: `Guest Ex ${i}`,
                setsCount: 4,
                isBodyweight: i % 2 === 0,
                equipmentWeight: i,
            });
        }
        expect(merged.activePains).toEqual(['chest', 'back_lats']);
    });
});
