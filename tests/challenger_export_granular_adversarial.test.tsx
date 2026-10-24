import { describe, it, expect, vi } from 'vitest';
import { Exporter } from '../src/lib/export';

describe('Challenger: Granular Export Adversarial & Stress', () => {
    it('exports exact transitive dependencies from a large catalog', async () => {
        // Generate massive dataset
        const library = Array.from({ length: 500 }).map((_, i) => ({
            id: `ex_${i}`,
            name: `Exercise ${i}`,
            setsCount: 3,
            sets: []
        }));

        const routines = Array.from({ length: 300 }).map((_, i) => ({
            id: `rt_${i}`,
            name: `Routine ${i}`,
            exercises: [
                { exId: `ex_${i % 500}` },
                { exId: `ex_${(i + 1) % 500}` }
            ]
        }));

        const trainingCycles = Array.from({ length: 100 }).map((_, i) => ({
            id: `cy_${i}`,
            name: `Cycle ${i}`,
            durationWeeks: 4,
            routines: [{ routineId: `rt_${i % 300}`, frequencyPerWeek: 1 }, { routineId: `rt_${(i + 1) % 300}`, frequencyPerWeek: 1 }]
        }));

        const mockUserData: any = { library, routines, trainingCycles };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockResolvedValue(true);
        downloadSpy.mockClear();

        // Request to export only 5 specific cycles (IDs: cy_0, cy_1, cy_2, cy_3, cy_4)
        const targetCycles = ['cy_0', 'cy_1', 'cy_2', 'cy_3', 'cy_4'];
        const result = await Exporter.exportShareJson(mockUserData, {
            exportTrainingCycles: targetCycles,
            exportRoutines: [],
            exportLibrary: []
        });

        expect(downloadSpy).toHaveBeenCalled();
        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content);
        const exported = parsed.userData;

        // Share export now uses the versioned backup envelope; selected business data lives in userData.
        expect(parsed.format).toBe('logbook-backup');
        expect(parsed.type).toBe('share');

        // 5 cycles exported
        expect(exported.trainingCycles).toHaveLength(5);
        expect(result?.cyclesCount).toBe(5);

        // Each cycle has 2 routines, but they overlap?
        // cy_0: rt_0, rt_1
        // cy_1: rt_1, rt_2
        // cy_2: rt_2, rt_3
        // cy_3: rt_3, rt_4
        // cy_4: rt_4, rt_5
        // Unique routines: rt_0, rt_1, rt_2, rt_3, rt_4, rt_5 => 6 routines
        expect(exported.routines).toHaveLength(6);
        expect(result?.routinesCount).toBe(6);

        // Each routine has 2 exercises
        // Unique exercises: ex_0 to ex_6 => 7 exercises
        expect(exported.library).toHaveLength(7);
        expect(result?.libraryCount).toBe(7);

        // The full selection verifies that the source dimensions are real:
        // selecting five cycles above is not a test of exporting all 500 items.
        await Exporter.exportShareJson(mockUserData, {
            exportTrainingCycles: true, exportRoutines: true, exportLibrary: true,
        });
        const full = JSON.parse(downloadSpy.mock.calls[1][1]).userData;
        expect(full.trainingCycles.map((item: { id: string }) => item.id))
            .toEqual(trainingCycles.map(item => item.id));
        expect(full.routines.map((item: { id: string }) => item.id))
            .toEqual(routines.map(item => item.id));
        expect(full.library.map((item: { id: string }) => item.id))
            .toEqual(library.map(item => item.id));
    });
});
