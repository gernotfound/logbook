import { describe, it, expect, vi } from 'vitest';
import { mergeUserData } from '../merge';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';

vi.mock('../catalog/catalogService', () => ({
    getInMemoryCatalog: () => ({ exercises: [], foods: [] }),
    getSeedCatalog: () => ({ exercises: [], foods: [] }),
}));

describe('Integration: Schema -> Merge -> Valid Output', () => {
    it('full pipeline: cloud data + local data = valid merged user data', () => {
        // "Dirty" cloud data
        const cloudData = {
            profile: { height: '180' },
            library: [{ id: '1', name: 'Cloud Ex', muscles: null }], // muscles null is invalid for zod
            routines: 'invalid_string', // should fallback to []
        };

        // Guest local data
        const localData = {
            profile: { weight: '80' },
            library: [{ id: '1', name: 'Guest Ex' }], // Collides with cloud ID 1
        };

        // 1. Zod parse the dirty cloud data (simulating load from DB)
        const parsedCloud = UserDataSchema.parse(cloudData) as UserData;
        
        // 2. Zod parse local data (simulating load from IndexedDB)
        const parsedLocal = UserDataSchema.parse(localData) as UserData;

        // 3. Merge them
        const merged = mergeUserData(parsedCloud, parsedLocal);

        // 4. Validate output
        expect(merged).toBeDefined();
        
        // Profile merged
        expect(merged.profile!.height).toBe('180');
        expect((merged.profile as any).weight).toBe('80'); // '80' string is preserved as string per UserProfileSchema
        
        // Routines fallback to []
        expect(merged.routines).toEqual([]);

        // Library merged, guest overrides cloud
        expect(merged.library!).toHaveLength(1);
        expect(merged.library![0].name).toBe('Guest Ex');
        expect(merged.library![0].muscles).toEqual([]); // Fallback array applied by schema
    });
});
