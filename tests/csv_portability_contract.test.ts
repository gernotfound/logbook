import { afterEach, describe, expect, it, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import type { NutritionDay, WorkoutSession } from '../src/types';

afterEach(() => vi.restoreAllMocks());

describe('CSV portability contract', () => {
    it('uses the canonical workout business date and exports sessions even without sets', async () => {
        let csv = '';
        vi.spyOn(Exporter, 'downloadFile').mockImplementation(async (filename, content) => {
            if (filename === 'allenamenti.csv') csv = content;
            return true;
        });

        const workout: WorkoutSession = {
            id: 'w1',
            date: '2026-01-01',
            globalStartTime: Date.parse('2025-12-31T23:30:00.000Z'),
            routineId: 'r1',
            routineName: 'Sessione senza serie',
            cycleId: 'c1',
            cycleName: 'Ciclo',
            cycleStrategy: { intent: 'development', progressionFocus: 'performance' },
            readiness: { capturedAt: Date.parse('2026-01-01T10:00:00.000Z'), energy: 4 },
            pains: ['chest'],
            exercises: [],
        };

        await Exporter.exportToCSV([workout], {}, []);
        const lines = csv.trimEnd().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1].startsWith('"2026-01-01",')).toBe(true);
        expect(lines[1]).toContain('"w1"');
        expect(lines[1]).toContain('"Ciclo"');
        expect(lines[1]).toContain('"chest"');
    });

    it('exports normalized nutrition details and gives canonical hip precedence', async () => {
        let csv = '';
        vi.spyOn(Exporter, 'downloadFile').mockImplementation(async (filename, content) => {
            if (filename === 'misurazioni.csv') csv = content;
            return true;
        });
        const day: NutritionDay = {
            date: '2026-10-04',
            kcal: 2100,
            carbs: 220,
            pro: 160,
            fat: 70,
            hip: 101,
            hips: 99,
            measurementTime: '08:15',
            isDayOn: true,
            meals: [{ id: 'm1', name: 'Pasto', meal: 'pranzo', quantity: 100, kcal: 500, carbs: 50, pro: 40, fat: 15 }],
            supplementsIntake: [{ id: 'i1', supplementId: 's1', amount: 5, time: 123 }],
            bfProvenance: { method: 'us_navy', inputs: { heightCm: 180, waistCm: 82, neckCm: 38 } },
        };

        await Exporter.exportToCSV([], { [day.date]: day }, []);
        expect(csv).toContain(',101,');
        expect(csv).not.toContain('"99"');
        expect(csv).toContain('"08:15"');
        expect(csv).toContain('"m1"');
        expect(csv).toContain('"supplementId"');
        expect(csv).toContain('"heightCm"');
    });

    it('finishes only after every generated file has been saved', async () => {
        const calls: string[] = [];
        vi.spyOn(Exporter, 'downloadFile').mockImplementation(async filename => {
            await Promise.resolve();
            calls.push(filename);
            return true;
        });
        const workout: WorkoutSession = {
            id: 'w1',
            date: '2026-10-04',
            exercises: [],
        };
        const day: NutritionDay = {
            date: '2026-10-04',
            kcal: 0,
            carbs: 0,
            pro: 0,
            fat: 0,
            steps: 1000,
            cardioSessions: [{ id: 'c1', modality: 'walk', durationMinutes: 20 }],
        };

        const result = await Exporter.exportToCSV([workout], { [day.date]: day }, []);
        expect(result).toBe(true);
        expect(calls).toEqual(['allenamenti.csv', 'misurazioni.csv', 'passi.csv', 'cardio.csv']);
    });
});
