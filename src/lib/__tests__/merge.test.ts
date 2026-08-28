import { describe, it, expect, vi } from 'vitest';
import { mergeArrayById, mergeNutrition, mergeUserData } from '../merge';
import { UserDataSchema } from '../schema';

vi.mock('../catalog/catalogService', () => ({
    getInMemoryCatalog: () => ({ exercises: [], foods: [] }),
    getSeedCatalog: () => ({ exercises: [], foods: [] }),
}));

describe('mergeArrayById', () => {
    it('should prioritize guest item over cloud item on ID collision', () => {
        const cloud = [{ id: '1', name: 'Cloud Name', lastSyncedAt: 100 }];
        const guest = [{ id: '1', name: 'Guest Name', lastSyncedAt: 200 }];
        const merged = mergeArrayById(cloud, guest);
        expect(merged).toHaveLength(1);
        expect(merged[0].name).toBe('Guest Name');
    });

    it('should deduplicate and preserve non-colliding items', () => {
        const cloud = [{ id: '1', name: 'Cloud 1' }, { id: '2', name: 'Cloud 2' }];
        const guest = [{ id: '2', name: 'Guest 2' }, { id: '3', name: 'Guest 3' }];
        const merged = mergeArrayById(cloud, guest);
        expect(merged).toHaveLength(3);
        const map = new Map(merged.map(m => [m.id, m.name]));
        expect(map.get('1')).toBe('Cloud 1');
        expect(map.get('2')).toBe('Guest 2');
        expect(map.get('3')).toBe('Guest 3');
    });

    it('should handle nested workouts correctly (timestamp conflicts)', () => {
        const cloud = [{ id: 'w1', sets: [{ setId: 's1', reps: 10, timestamp: 100 }] }];
        const guest = [{ id: 'w1', sets: [{ setId: 's1', reps: 12, timestamp: 200 }] }];
        // Guest overrides cloud entirely for this array entry
        const merged = mergeArrayById(cloud, guest);
        expect(merged).toHaveLength(1);
        expect(merged[0].sets[0].reps).toBe(12);
        expect(merged[0].sets[0].timestamp).toBe(200);
    });

    it('should preserve items without valid IDs', () => {
        const cloud = [{ name: 'No ID 1' }, { id: '1', name: 'Cloud 1' }] as any[];
        const guest = [{ name: 'No ID 2' }, { id: '1', name: 'Guest 1' }] as any[];
        const merged = mergeArrayById(cloud, guest);
        expect(merged).toHaveLength(3);
        expect(merged.filter(m => !m.id)).toHaveLength(2);
        expect(merged.find(m => m.id === '1').name).toBe('Guest 1');
    });
});

describe('mergeNutrition', () => {
    it('should merge nested meals prioritizing guest by ID', () => {
        const cloud = {
            '2025-01-01': {
                date: '2025-01-01',
                meals: [{ id: 'm1', name: 'Apple', baseQty: 100, kcal: 50 }]
            }
        } as any;
        const guest = {
            '2025-01-01': {
                date: '2025-01-01',
                meals: [{ id: 'm1', name: 'Apple (Guest)', baseQty: 100, kcal: 60 }]
            }
        } as any;
        const merged = mergeNutrition(cloud, guest);
        expect(merged['2025-01-01'].meals[0].name).toBe('Apple (Guest)');
        expect(merged['2025-01-01'].kcal).toBe(60);
    });
});

describe('mergeUserData', () => {
    it('should fallback to defaults on missing required fields via Zod parse', () => {
        const cloudData = { profile: null, library: null } as any;
        const guestData = { customFoods: undefined } as any;
        const merged = mergeUserData(cloudData, guestData);
        expect(merged.profile).toBeDefined();
        expect(Array.isArray(merged.library)).toBe(true);
        expect(Array.isArray(merged.customFoods)).toBe(true);
        expect(Array.isArray(merged.history)).toBe(true);
    });
});
