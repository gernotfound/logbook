import { describe, it, expect } from 'vitest';
import { getMergePolicy, resolveIdentity } from '../src/lib/sync/semanticProjection';
import { identitySeed } from '../src/lib/sync/semanticProjection/policy';
import { normalizeBusinessId, requireBusinessId } from '../src/lib/businessIdentity';

describe('Semantic Merge Policy', () => {
    it('1. returns correct policy for root fields', () => {
        expect(getMergePolicy('', ['profile'])).toBe('property');
        expect(getMergePolicy('', ['library'])).toBe('keyed');
        expect(getMergePolicy('', ['library', 'ex1'])).toBe('property');
        expect(getMergePolicy('', ['routines'])).toBe('ordered-keyed');
    });

    it('rejects the reserved order marker as an entity ID before semantic compilation', () => {
        expect(normalizeBusinessId('$order')).toBeNull();
        expect(() => requireBusinessId('$order', 'Routine')).toThrow();
        expect(() => resolveIdentity(['routines'], { id: '$order' })).toThrow();
        expect(() => resolveIdentity(['routines', 'r1', 'exercises'], { exId: '$order' })).toThrow();
        expect(() => identitySeed(['trainingCycles', 'c1', 'routines'], '$order')).toThrow();
        expect(identitySeed(['trainingCycles', 'c1', 'routines'], 'r1')).toEqual({ routineId: 'r1' });
        expect(resolveIdentity(['routines'], { id: '__proto__' })).toBe('__proto__');
    });

    it('2. returns correct policy for nested activeWorkout sets', () => {
        expect(getMergePolicy('', ['activeWorkout', 'exercises', 'ex1', 'sets', 's1'])).toBe('property');
        expect(getMergePolicy('', ['activeWorkout', 'exercises', 'ex1', 'sets', 's1', 'segments'])).toBe('ordered-keyed');
        expect(getMergePolicy('history_months/2026-09', ['w1', 'exercises', 'ex1', 'sets', 's1', 'segments'])).toBe('ordered-keyed');
    });
});