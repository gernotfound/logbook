import { describe, expect, it } from 'vitest';
import { buildCsvFiles, formatCsvRow } from '../src/lib/csvExport';
import type { NutritionDay, WorkoutSession } from '../src/types';

describe('pure CSV export builder', () => {
    it('preserves file order, current business fields, advanced sets and the source snapshot', () => {
        const workout: WorkoutSession = {
            id: 'w-1',
            date: '2026-10-22',
            routineName: '=formula',
            exercises: [{
                id: 'se-1', exId: 'bench', sessionNote: 'Fermo al petto',
                technicalStandard: 'ROM completo',
                sets: [{
                    id: 'set-1', kg: '70', reps: '8', rir: 0, technique: 'dropset',
                    segments: [{ id: 'seg-1', kg: '50', reps: '4', technique: 'dropset', restBeforeSeconds: 45 }],
                    dropsets: [{ id: 'drop-1', kg: '45', reps: '5' }],
                    isometrics: [{ id: 'iso-1', kg: '30', time: '10' }],
                }],
            }],
        };
        const day: NutritionDay = {
            date: '2026-10-22',
            kcal: 2100, carbs: 220, pro: 160, fat: 70, hip: 98,
            sleepHours: '07:30', steps: 0, stepsSource: 'manual',
            cardioSessions: [{ id: 'bike-1', modality: 'bike', durationMinutes: 20, notes: '=do-not-run' }],
        };
        const history = [workout];
        const nutrition = { [day.date]: day };
        const snapshot = structuredClone({ history, nutrition });

        const files = buildCsvFiles(history, nutrition, [{ id: 'bench', name: '@Bench' }]);
        expect(files.map(([name]) => name))
            .toEqual(['allenamenti.csv', 'misurazioni.csv', 'passi.csv', 'cardio.csv']);
        expect(files).toEqual(buildCsvFiles(history, nutrition, [{ id: 'bench', name: '@Bench' }]));
        expect({ history, nutrition }).toEqual(snapshot);

        const byName = new Map(files);
        const workouts = byName.get('allenamenti.csv')!;
        const rows = workouts.trimEnd().split('\n');
        expect(rows).toHaveLength(5); // header, primary set, continuation, dropset, isometry
        expect(rows[1]).toContain('"\'=formula"');
        expect(rows[1]).toContain('"\'@Bench"');
        expect(rows[1]).toContain('"set-1"');
        expect(rows[2]).toContain('"seg-1"');
        expect(rows[3]).toContain('"drop-1"');
        expect(rows[4]).toContain('"iso-1"');
        expect(byName.get('misurazioni.csv')).toContain(',98,');
        expect(byName.get('passi.csv')).toContain(',0,');
        expect(byName.get('cardio.csv')).toContain('"\'=do-not-run"');
        expect(workouts.startsWith('\uFEFF')).toBe(false); // BOM added exactly once by downloadFile
    });

    it('omits empty optional files and exports sessions with no exercises', () => {
        const history: WorkoutSession[] = [{ id: 'empty', date: '2026-10-22', exercises: [] }];
        const files = buildCsvFiles(history, {}, []);
        expect(files.map(([name]) => name)).toEqual(['allenamenti.csv']);
        expect(files[0][1].trimEnd().split('\n')).toHaveLength(2);
        expect(buildCsvFiles([], {}, [])).toEqual([]);
    });

    it('uses canonical CSV quoting and rejects invalid business dates rather than publishing partial files', () => {
        expect(formatCsvRow(['=danger', 'with "quotes"', 'new\nline', 0, null]))
            .toBe('"\'=danger","with ""quotes""","new\nline",0,\n');
        const invalid: WorkoutSession[] = [{ id: 'broken', date: 'invalid', exercises: [] }];
        expect(() => buildCsvFiles(invalid, {}, [])).toThrow();
    });
});
