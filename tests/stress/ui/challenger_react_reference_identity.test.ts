import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('React identity and memoization regressions', () => {
    describe('Scope 3: Memoization Referential Identity Verification', () => {
        it('verifies EMPTY_HISTORY_ARRAY in TrainingSession preserves strict reference equality (===) for multiple exercises without history', async () => {
            const activeSessionFile = fs.readFileSync(
                path.resolve(__dirname, '../../../src/components/Training/ActiveWorkoutSession.tsx'),
                'utf-8'
            );

            // Verify module-level declaration exists
            expect(activeSessionFile).toMatch(/const EMPTY_HISTORY_ARRAY:\s*Array<.*?>\s*=\s*\[\];/);

            // Verify the fallback uses EMPTY_HISTORY_ARRAY instead of inline []
            expect(activeSessionFile).toMatch(/exerciseHistoryMap\.get\(exItem\.exId\)\s*\|\|\s*EMPTY_HISTORY_ARRAY/);
            expect(activeSessionFile).not.toMatch(/exerciseHistoryMap\.get\(exItem\.exId\)\s*\|\|\s*\[\]/);

            // Emulate the exact lookup logic
            const exerciseHistoryMap = new Map<string, any[]>();
            exerciseHistoryMap.set('ex_with_history', [{ date: '2026-08-10', sets: [], note: '' }]);

            const EMPTY_HISTORY_ARRAY: any[] = [];
            const getPastWorkouts = (exId: string) => exerciseHistoryMap.get(exId) || EMPTY_HISTORY_ARRAY;

            // Multiple exercises with no history across multiple render cycles
            const render1_ex1 = getPastWorkouts('ex_new_1');
            const render1_ex2 = getPastWorkouts('ex_new_2');
            const render1_ex3 = getPastWorkouts('ex_new_3');

            const render2_ex1 = getPastWorkouts('ex_new_1');
            const render2_ex2 = getPastWorkouts('ex_new_2');

            // Referential identity checks:
            expect(render1_ex1).toBe(EMPTY_HISTORY_ARRAY);
            expect(render1_ex2).toBe(EMPTY_HISTORY_ARRAY);
            expect(render1_ex3).toBe(EMPTY_HISTORY_ARRAY);
            expect(render1_ex1 === render1_ex2).toBe(true);
            expect(render1_ex1 === render2_ex1).toBe(true);
            expect(render1_ex2 === render2_ex2).toBe(true);

            // In contrast, inline [] would fail strict equality:
            const brokenLookup = () => exerciseHistoryMap.get('ex_new_1') || [];
            expect(brokenLookup() === brokenLookup()).toBe(false);
        });

        it('Production SessionExerciseCard and SessionSetRow expose their real React.memo boundary', async () => {
            const { SessionExerciseCard } = await import('../../../src/components/Training/session/SessionExerciseCard');
            const { SessionSetRow } = await import('../../../src/components/Training/session/SessionSetRow');
            expect((SessionExerciseCard as any).$$typeof).toBe(Symbol.for('react.memo'));
            expect((SessionSetRow as any).$$typeof).toBe(Symbol.for('react.memo'));
            // Production uses React.memo's default shallow comparison; no test-side comparator is authoritative.
            expect((SessionExerciseCard as any).compare).toBeNull();
            expect((SessionSetRow as any).compare).toBeNull();
        });
    });
});
