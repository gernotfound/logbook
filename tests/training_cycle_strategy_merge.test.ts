import { describe, expect, it } from 'vitest';
import { mergeUserData } from '../src/lib/merge';
import type { UserData } from '../src/types';

describe('training cycle strategy guest/account merge', () => {
    it('preserves the guest cycle strategy on an id collision and validates the merged data', () => {
        const cloud: UserData = {
            trainingCycles: [{
                id: 'cycle-1',
                name: 'Cloud cycle',
                durationWeeks: 4,
                strategy: { intent: 'maintenance' },
                routines: [],
            }],
        };
        const guest: UserData = {
            trainingCycles: [{
                id: 'cycle-1',
                name: 'Guest cycle',
                durationWeeks: 6,
                strategy: {
                    intent: 'development',
                    progressionFocus: 'volume',
                    primaryMuscles: ['quads'],
                },
                routines: [],
            }],
        };

        const merged = mergeUserData(cloud, guest);

        expect(merged.trainingCycles).toHaveLength(1);
        expect(merged.trainingCycles?.[0]).toMatchObject({
            id: 'cycle-1',
            name: 'Guest cycle',
            durationWeeks: 6,
            strategy: {
                intent: 'development',
                progressionFocus: 'volume',
                primaryMuscles: ['quads'],
            },
        });
    });
});
