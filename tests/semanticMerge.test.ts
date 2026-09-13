import { describe, it, expect } from 'vitest';
import { getMergePolicy } from '../src/lib/sync/semanticProjection';

describe('Semantic Merge Policy', () => {
    it('1. returns correct policy for root fields', () => {
        expect(getMergePolicy('', ['profile'])).toBe('atomic');
        expect(getMergePolicy('', ['library'])).toBe('keyed');
        expect(getMergePolicy('', ['library', 'ex1'])).toBe('property');
        expect(getMergePolicy('', ['routines'])).toBe('ordered-keyed');
    });

    it('2. returns correct policy for nested activeWorkout sets', () => {
        expect(getMergePolicy('', ['activeWorkout', 'exercises', 'ex1', 'sets', 's1'])).toBe('keyed');
    });
});