import { describe, it, expect } from 'vitest';
import { diffDocuments } from '../src/lib/sync/semanticProjection';

describe('activeWorkout Lifecycle Guard', () => {
    it('generates a guard for child operations of an activeWorkout', () => {
        const base = new Map();
        base.set('', {
            activeWorkout: { id: 'w-1', date: '2026-09-01', exercises: [] }
        });

        const desired = new Map();
        desired.set('', {
            activeWorkout: { id: 'w-1', date: '2026-09-01', exercises: [{ id: 'ex-1', name: 'Bench' }] }
        });

        const ops = diffDocuments(base, desired, 'actor1', 1, { 'actor1': 1 });

        // We expect one operation for the exercises array insertion
        expect(ops.length).toBeGreaterThan(0);

        const op = ops.find(o => o.path.includes('exercises'));
        expect(op).toBeDefined();

        // The guard should verify that the activeWorkout's ID is still 'w-1'
        expect(op?.guard).toEqual({
            path: ['activeWorkout', 'id'],
            equals: 'w-1'
        });
    });

    it('does not generate a guard if activeWorkout has no id', () => {
        const base = new Map();
        base.set('', {
            activeWorkout: { date: '2026-09-01', exercises: [] }
        });

        const desired = new Map();
        desired.set('', {
            activeWorkout: { date: '2026-09-01', exercises: [{ id: 'ex-1', name: 'Bench' }] }
        });

        const ops = diffDocuments(base, desired, 'actor1', 1, { 'actor1': 1 });

        const op = ops.find(o => o.path.includes('exercises'));
        expect(op).toBeDefined();

        expect(op?.guard).toBeUndefined();
    });
});
