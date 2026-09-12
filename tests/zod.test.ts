import { describe, it, expect } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';

describe('Zod Parse', () => {
    it('should strip undefined properties or keep them?', () => {
        const parsed = UserDataSchema.parse({ activeWorkout: undefined });
        console.log('Keys in parsed:', Object.keys(parsed));
        console.log('activeWorkout in parsed:', 'activeWorkout' in parsed);
        console.log('activeWorkout:', parsed.activeWorkout);
    });
});
