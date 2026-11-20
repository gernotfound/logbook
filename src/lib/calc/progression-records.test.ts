import { describe, expect, it } from 'vitest';
import { computeProgressionEngine } from './progression';
import { library, set, workout } from './progressionTestFixtures';

describe('contextual progression engine: records, effort and dosage', () => {
    it('recognizes +1 rep at the same load and RIR as a strong performance record', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('high');
        expect(analysis.classification).toBe('performance_record');
        expect(analysis.isRecord).toBe(true);
        expect(analysis.detail).toContain('100 kg × 8 · RIR 2');
        expect(analysis.detail).toContain('100 kg × 9 · RIR 2');
    });

    it('does not award a new record when the current output only ties the historical best', () => {
        const older = workout({ id: 'w1', date: '2026-08-25', sets: [set(100, 8, 2)] });
        const best = workout({ id: 'w2', date: '2026-09-01', sets: [set(100, 10, 2)] });
        const current = workout({ id: 'w3', date: '2026-09-08', sets: [set(100, 10, 2)] });

        const analysis = computeProgressionEngine(current, [older, best], library).exercises[0];

        expect(analysis.isRecord).toBe(false);
        expect(analysis.classification).toBe('stable');
    });

    it('suppresses a historical record claim when an otherwise relevant exposure has missing RIR', () => {
        const incomplete = workout({ id: 'w1', date: '2026-08-25', sets: [set(105, 10)] });
        const comparable = workout({ id: 'w2', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w3', date: '2026-09-08', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [incomplete, comparable], library).exercises[0];

        expect(analysis.isRecord).toBe(false);
        expect(analysis.bestHistorical?.sessionId).toBe('w2');
        expect(analysis.quality).toBe('preliminary');
    });

    it('selects a dominant historical reference despite many lower-RIR candidates', () => {
        const history = Array.from({ length: 31 }, (_, index) => workout({
            id: `low-${index}`, date: `2026-07-${String(index + 1).padStart(2, '0')}`,
            sets: [set(80 + index, 6 + index, index % 4)],
        }));
        const strongest = workout({ id: 'strongest', date: '2026-08-01', sets: [set(125, 40, 6)] });
        const current = workout({ id: 'current', date: '2026-08-10', sets: [set(130, 41, 6)] });
        const analysis = computeProgressionEngine(current, [...history, strongest], library).exercises[0];
        expect(analysis.bestHistorical?.sessionId).toBe('strongest');
    });

    it('does not mistake higher output at greater effort for a dominant historical reference', () => {
        const easier = workout({ id: 'easier', date: '2026-08-01', sets: [set(100, 8, 5)] });
        const harder = workout({ id: 'harder', date: '2026-08-08', sets: [set(110, 9, 1)] });
        const current = workout({ id: 'current', date: '2026-08-15', sets: [set(112, 10, 5)] });
        const analysis = computeProgressionEngine(current, [easier, harder], library).exercises[0];
        expect(analysis.bestHistorical).toBeUndefined();
    });

    it('recovers clear record analysis after old incomplete RIR ages out of the recent comparable window', () => {
        const incomplete = workout({ id: 'w0', date: '2026-08-01', sets: [set(120, 10)] });
        const first = workout({ id: 'w1', date: '2026-08-15', sets: [set(100, 8, 2)] });
        const second = workout({ id: 'w2', date: '2026-08-22', sets: [set(100, 9, 2)] });
        const third = workout({ id: 'w3', date: '2026-08-29', sets: [set(100, 10, 2)] });
        const current = workout({ id: 'w4', date: '2026-09-05', sets: [set(100, 11, 2)] });

        const analysis = computeProgressionEngine(current, [incomplete, first, second, third], library).exercises[0];

        expect(analysis.quality).toBe('clear');
        expect(analysis.bestHistorical?.sessionId).toBe('w3');
        expect(analysis.classification).toBe('performance_record');
        expect(analysis.isRecord).toBe(true);
    });

    it('keeps a recent missing-RIR exposure conservative while retaining the best high-comparability reference', () => {
        const first = workout({ id: 'w1', date: '2026-08-15', sets: [set(100, 8, 2)] });
        const second = workout({ id: 'w2', date: '2026-08-22', sets: [set(100, 9, 2)] });
        const incomplete = workout({ id: 'w3', date: '2026-08-29', sets: [set(105, 9)] });
        const current = workout({ id: 'w4', date: '2026-09-05', sets: [set(100, 10, 2)] });

        const analysis = computeProgressionEngine(current, [first, second, incomplete], library).exercises[0];

        expect(analysis.quality).toBe('preliminary');
        expect(analysis.bestHistorical?.sessionId).toBe('w2');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.qualityReasons.join(' ')).toContain('RIR mancante');
    });

    it('qualifies more reps when the athlete also reports more effort', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 0)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('output_up_effort_up');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.headline).toContain('effort maggiore');
    });

    it('describes the same output with a higher RIR as lower declared effort, not a PR', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 1)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 8, 3)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('stable_less_effort');
        expect(analysis.isRecord).toBe(false);
    });

    it('treats a 2 to 4 work-set increase as volume progression under a volume focus', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', cycleId: 'c1', intent: 'development', focus: 'volume',
            sets: [set(100, 10, 2), set(100, 9, 2)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', cycleId: 'c1', intent: 'development', focus: 'volume',
            sets: [set(100, 10, 2), set(100, 9, 2), set(100, 8, 2), set(100, 7, 2)],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('volume_progression');
        expect(analysis.current.workSets).toBe(4);
        expect(analysis.previousComparable?.workSets).toBe(2);
    });

    it('does not call reduced dose a regression during maintenance when reference performance is stable', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', intent: 'maintenance', focus: 'performance',
            sets: [set(100, 8, 2), set(100, 8, 2), set(100, 8, 2)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', intent: 'maintenance', focus: 'performance',
            sets: [set(100, 8, 2), set(100, 8, 2)],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('maintenance_stable');
        expect(analysis.detail).toContain('Dose osservata: 3 → 2 serie');
    });

    it('describes deload reductions without classifying them as regression', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', intent: 'development', focus: 'performance',
            sets: [set(100, 8, 1), set(100, 8, 1), set(100, 8, 1)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', intent: 'deload', focus: 'performance',
            sets: [set(80, 6, 4), set(80, 6, 4)],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('deload_change');
        expect(analysis.headline).toContain('Deload');
        expect(analysis.isRecord).toBe(false);
    });
});
