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
                    segments: [
                        { id: 'seg-1', kg: '50', reps: '4', technique: 'dropset', restBeforeSeconds: 45 },
                        { technique: 'dropset' as const, id: 'drop-1', kg: '45', reps: '5' },
                        { technique: 'isometry' as const, reps: '', id: 'iso-1', kg: '30', time: '10' }
                    ],
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
        expect(rows).toHaveLength(5); // header, primary set and three continuation segments
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

    it('exports only the canonical workout end timestamp without mutating the source', () => {
        const source = { id: 'w-clock', date: '2026-10-22', exercises: [],
            globalStartTime: Date.parse('2026-10-22T10:00:00Z'),
            endTime: Date.parse('2020-01-01T09:00:00Z'),
        };
        const before = structuredClone(source);
        const withoutEnd = buildCsvFiles([source], {}, [])[0][1];
        expect(withoutEnd).toContain('2026-10-22T10:00:00.000Z');
        expect(withoutEnd).not.toContain('2020-01-01T09:00:00.000Z');
        const withEnd = buildCsvFiles([{ ...source, globalEndTime: Date.parse('2026-10-22T11:00:00Z') }], {}, [])[0][1];
        expect(withEnd).toContain('2026-10-22T11:00:00.000Z');
        expect(source).toEqual(before);
    });

    it('omits impossible but finite timestamps without aborting a valid CSV export', () => {
        const history: WorkoutSession[] = [{
            id: 'workout-overflow', date: '2026-10-22', exercises: [],
            globalStartTime: Number.MAX_VALUE, globalEndTime: -Number.MAX_VALUE,
        }];
        const nutrition: Record<string, NutritionDay> = {
            '2026-10-22': {
                date: '2026-10-22', kcal: 2000, carbs: 200, pro: 120, fat: 60,
                steps: 1000, stepsCapturedAt: Number.MAX_VALUE,
                cardioSessions: [{
                    id: 'cardio-overflow', modality: 'bike', durationMinutes: 10,
                    startedAt: Number.MAX_VALUE,
                }],
            },
        };
        const files = new Map(buildCsvFiles(history, nutrition));
        expect(files.get('allenamenti.csv')).toContain('"workout-overflow"');
        expect(files.get('passi.csv')).toContain('"2026-10-22",1000');
        expect(files.get('cardio.csv')).toContain('"cardio-overflow"');
        expect(files.get('allenamenti.csv')).not.toContain('Invalid Date');
        expect(files.get('cardio.csv')).not.toContain('Invalid Date');
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
