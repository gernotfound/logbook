import { afterEach, describe, expect, it, vi } from 'vitest';
import { Exporter } from '../../src/lib/export';
import { useDialogStore } from '../../src/store/useDialogStore';
import type { NutritionDay, WorkoutSession } from '../../src/types';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('CSV portability contract', () => {
    it('writes one UTF-8 BOM through the native save picker before reporting success', async () => {
        let writtenBlob: Blob | undefined;
        const writable = {
            write: vi.fn(async (blob: Blob) => { writtenBlob = blob; }),
            close: vi.fn(async () => {}),
        };
        const picker = vi.fn().mockResolvedValue({ createWritable: vi.fn().mockResolvedValue(writable) });
        vi.stubGlobal('showSaveFilePicker', picker);
        const fallback = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        expect(await Exporter.downloadFile('allenamenti.csv', '"test"\n')).toBe(true);
        expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'allenamenti.csv' }));
        expect(writable.write).toHaveBeenCalledOnce();
        expect(writable.close).toHaveBeenCalledOnce();
        expect(fallback).not.toHaveBeenCalled();

        const bytes = await new Promise<Uint8Array>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(writtenBlob!);
        });
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
        expect(new TextDecoder().decode(bytes.slice(3))).toBe('"test"\n');
    });

    it('does not fall back to a download after native picker cancellation', async () => {
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(
            Object.assign(new Error('user cancelled'), { name: 'AbortError' }),
        ));
        const fallback = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        await expect(Exporter.downloadFile('allenamenti.csv', 'content')).resolves.toBe(false);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('reports native save write failures without claiming a completed download', async () => {
        const writable = {
            write: vi.fn().mockRejectedValue(new Error('disk full')),
            close: vi.fn(),
        };
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({
            createWritable: vi.fn().mockResolvedValue(writable),
        }));
        const fallback = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const alert = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);

        await expect(Exporter.downloadFile('allenamenti.csv', 'content')).resolves.toBe(false);
        expect(writable.close).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith('Esportazione fallita:', expect.any(Error));
        expect(alert).toHaveBeenCalledWith('Esportazione fallita, riprova.');
    });

    it.each(['createWritable', 'write', 'close'] as const)(
        'never starts a fallback download when native %s fails after file selection',
        async failingStep => {
            // SecurityError / TypeError are also emitted by native file writes,
            // not only by the picker before the user selects the destination.
            const nativeError = Object.assign(new Error('native file operation failed'), {
                name: failingStep === 'write' ? 'SecurityError' : 'TypeError',
            });
            const writable = {
                write: vi.fn(async (_blob: Blob) => {
                    if (failingStep === 'write') throw nativeError;
                }),
                close: vi.fn(async () => {
                    if (failingStep === 'close') throw nativeError;
                }),
            };
            const createWritable = vi.fn(async () => {
                if (failingStep === 'createWritable') throw nativeError;
                return writable;
            });
            vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable }));
            const fallback = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const alert = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);

            expect(await Exporter.downloadFile('allenamenti.csv', 'content')).toBe(false);
            expect(createWritable).toHaveBeenCalledOnce();
            expect(writable.write).toHaveBeenCalledTimes(failingStep === 'createWritable' ? 0 : 1);
            expect(writable.close).toHaveBeenCalledTimes(failingStep === 'close' ? 1 : 0);
            expect(fallback).not.toHaveBeenCalled();
            expect(warning).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalledWith('Esportazione fallita:', nativeError);
            expect(alert).toHaveBeenCalledWith('Esportazione fallita, riprova.');
        },
    );

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

    it('exports a workout without date using the local day of its start instant', async () => {
        const download = vi.spyOn(Exporter, 'downloadFile').mockResolvedValue(true);
        const session: WorkoutSession = {
            id: 'timestamp-only',
            globalStartTime: new Date(2026, 7, 23, 12).getTime(),
            routineName: 'Spinta A',
            exercises: [{
                exId: 'ex-1',
                sessionNote: '',
                sets: [{ id: 'set-1', kg: '100', reps: '8' }],
            }],
        };

        expect(await Exporter.exportToCSV([session], {}, [{ id: 'ex-1', name: 'Panca piana' }])).toBe(true);
        expect(download).toHaveBeenCalledOnce();
        const row = download.mock.calls[0][1].split('\n')[1];
        expect(row).toMatch(/^"2026-08-23","Spinta A","Panca piana",/);
    });

    it('does not download partial CSV files when a later workout has no valid date', async () => {
        const download = vi.spyOn(Exporter, 'downloadFile').mockResolvedValue(true);
        const history: WorkoutSession[] = [
            { id: 'valid', date: '2026-08-23', exercises: [] },
            { id: 'invalid', exercises: [] },
        ];

        await expect(Exporter.exportToCSV(history, {}, []))
            .rejects.toThrow('identità temporale non valida');
        expect(download).not.toHaveBeenCalled();
    });

    it('exports normalized nutrition details using the canonical hip field', async () => {
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
            measurementTime: '08:15',
            isDayOn: true,
            meals: [{ id: 'm1', name: 'Pasto', meal: 'pranzo', quantity: 100, kcal: 500, carbs: 50, pro: 40, fat: 15 }],
            supplementsIntake: [{ id: 'i1', supplementId: 's1', amount: 5, time: 123 }],
            bfProvenance: { method: 'us_navy', inputs: { heightCm: 180, waistCm: 82, neckCm: 38 } },
        };

        await Exporter.exportToCSV([], { [day.date]: day }, []);
        expect(csv).toContain(',101,');
        expect(csv).toContain('"08:15"');
        expect(csv).toContain('"m1"');
        expect(csv).toContain('"supplementId"');
        expect(csv).toContain('"heightCm"');
    });

    it('waits for each pending save before starting the next CSV or reporting completion', async () => {
        const pending: Array<(saved: boolean) => void> = [];
        const save = vi.spyOn(Exporter, 'downloadFile').mockImplementation(() =>
            new Promise<boolean>(resolve => { pending.push(resolve); }));
        const workout: WorkoutSession = { id: 'w1', date: '2026-10-04', exercises: [] };
        const day: NutritionDay = {
            date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0,
            steps: 1000, cardioSessions: [{ id: 'c1', modality: 'walk', durationMinutes: 20 }],
        };
        let completed = false;
        const exportPromise = Exporter.exportToCSV([workout], { [day.date]: day }, [])
            .then(result => { completed = true; return result; });

        const filenames = ['allenamenti.csv', 'misurazioni.csv', 'passi.csv', 'cardio.csv'];
        for (const [index] of filenames.entries()) {
            await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(index + 1));
            expect(save.mock.calls.map(call => call[0])).toEqual(filenames.slice(0, index + 1));
            expect(completed).toBe(false);
            pending[index](true);
        }
        expect(await exportPromise).toBe(true);
        expect(completed).toBe(true);
        expect(save.mock.calls.map(call => call[0]))
            .toEqual(['allenamenti.csv', 'misurazioni.csv', 'passi.csv', 'cardio.csv']);
    });
    it('propagates a late save error and never starts subsequent files', async () => {
        let failSecond: (reason: Error) => void = () => { throw new Error('Second file not started'); };
        const save = vi.spyOn(Exporter, 'downloadFile')
            .mockResolvedValueOnce(true)
            .mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => { failSecond = reject; }));
        const workout: WorkoutSession = { id: 'w1', date: '2026-10-04', exercises: [] };
        const day: NutritionDay = { date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0, steps: 1000 };
        const exportPromise = Exporter.exportToCSV([workout], { [day.date]: day }, []);
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        failSecond(new Error('disk full'));
        await expect(exportPromise).rejects.toThrow('disk full');
        expect(save.mock.calls.map(call => call[0])).toEqual(['allenamenti.csv', 'misurazioni.csv']);
    });
    it('keeps complete output and stable row order for large datasets', async () => {
        const exported: Record<string, string> = {};
        vi.spyOn(Exporter, 'downloadFile').mockImplementation(async (name, content) => {
            exported[name] = content;
            return true;
        });
        const history: WorkoutSession[] = Array.from({ length: 1500 }, (_, index) => ({
            id: 'workout-' + index,
            date: '2026-01-01',
            routineName: index === 1499 ? '=injection' : 'Session ' + index,
            exercises: [],
        }));
        expect(await Exporter.exportToCSV(history, {}, [])).toBe(true);
        const rows = exported['allenamenti.csv'].trimEnd().split('\n');
        expect(rows).toHaveLength(1501);
        expect(rows[1]).toContain('"workout-0"');
        expect(rows[1500]).toContain('"workout-1499"');
        expect(rows[1500]).toContain('"\'=injection"');
    });

    it('stops saving later CSV files if one is cancelled, without reporting completion', async () => {
        const save = vi.spyOn(Exporter, 'downloadFile')
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const history: WorkoutSession[] = [{ id: 'w1', date: '2026-10-04', exercises: [] }];
        const nutrition: Record<string, NutritionDay> = {
            '2026-10-04': {
                date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0,
                steps: 400, cardioSessions: [{ id: 'c1', modality: 'walk', durationMinutes: 20 }],
            },
        };
        expect(await Exporter.exportToCSV(history, nutrition, [])).toBe(false);
        expect(save.mock.calls.map(call => call[0])).toEqual(['allenamenti.csv', 'misurazioni.csv']);
    });

});
