import { describe, it, expect, vi } from 'vitest';
import { Exporter } from '../src/lib/export';

// Mock per il download file
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
    if (tagName === 'a') {
        return {
            setAttribute: vi.fn(),
            click: vi.fn(),
            style: {},
        } as any;
    }
    return originalCreateElement(tagName);
});

describe('Challenger: Granular Export Adversarial & Stress', () => {
    it('Handles stress test with max items (500 ex, 300 routines, 100 cycles) instantly without crashing', async () => {
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
            routines: [`rt_${i % 300}`, `rt_${(i + 1) % 300}`]
        }));

        const mockUserData: any = { library, routines, trainingCycles };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        downloadSpy.mockClear();

        const start = performance.now();
        // Request to export only 5 specific cycles (IDs: cy_0, cy_1, cy_2, cy_3, cy_4)
        const targetCycles = ['cy_0', 'cy_1', 'cy_2', 'cy_3', 'cy_4'];
        const result = await Exporter.exportShareJson(mockUserData, {
            exportTrainingCycles: targetCycles,
            exportRoutines: [],
            exportLibrary: []
        });
        const duration = performance.now() - start;

        expect(downloadSpy).toHaveBeenCalled();
        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content);

        // 5 cycles exported
        expect(parsed.trainingCycles).toHaveLength(5);
        expect(result.cyclesCount).toBe(5);

        // Each cycle has 2 routines, but they overlap?
        // cy_0: rt_0, rt_1
        // cy_1: rt_1, rt_2
        // cy_2: rt_2, rt_3
        // cy_3: rt_3, rt_4
        // cy_4: rt_4, rt_5
        // Unique routines: rt_0, rt_1, rt_2, rt_3, rt_4, rt_5 => 6 routines
        expect(parsed.routines).toHaveLength(6);
        expect(result.routinesCount).toBe(6);

        // Each routine has 2 exercises
        // Unique exercises: ex_0 to ex_6 => 7 exercises
        expect(parsed.library).toHaveLength(7);
        expect(result.libraryCount).toBe(7);

        // Performance check
        expect(duration).toBeLessThan(150); // Generous margin for CI
    });
});
