import { describe, it, expect, vi } from 'vitest';
import { mergeUserData } from '../merge';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { assertCloudBusinessPreserved, CloudDataIntegrityError } from '../sync/cloudBusinessIntegrity';

vi.mock('../catalog/catalogService', () => ({
    getInMemoryCatalog: () => ({ exercises: [], foods: [] }),
    getSeedCatalog: () => ({ exercises: [], foods: [] }),
}));

describe('Integration: Schema -> Merge -> Valid Output', () => {
    it('merges two already-parsed inputs without replacing valid guest identity', () => {
        // Non-authoritative malformed fixture: this is ONLY a pure schema/merge test,
        // not a simulation of successful Firestore hydration.
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

        // 1. Parse the non-authoritative schema fixture, not a DB read.
        const parsedCloud = UserDataSchema.parse(cloudData) as UserData;
        
        // 2. Parse the local fixture without claiming an IndexedDB read.
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

    it('blocks a lossy cloud root before it could become merge authority', () => {
        const cloudRoot = {
            profile: { height: '180' },
            routines: 'malformed-non-array',
            library: [{ id: 'ex1', name: 'Cloud Exercise', muscles: null }],
        };
        const parsed = UserDataSchema.parse(cloudRoot);
        // Parsing alone can replace a collection with defaults. Real cloud
        // hydration must reject that loss rather than treating defaults as truth.
        expect(parsed.routines).toEqual([]);
        expect(() => assertCloudBusinessPreserved('', cloudRoot, parsed))
            .toThrow(CloudDataIntegrityError);
        expect(cloudRoot.routines).toBe('malformed-non-array');
        expect(cloudRoot.library[0].muscles).toBeNull();
    });
});
