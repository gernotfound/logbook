import { describe, it, expect, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import { useDialogStore } from '../src/store/useDialogStore';

describe('SEC-01: CSV Formula Injection Mitigation in Export', () => {
    it('formatCsvField protegge le stringhe che iniziano con caratteri pericolosi', () => {
        // Stringhe malevole
        expect(Exporter.formatCsvField('=1+1')).toBe(`"\'=1+1"`);
        expect(Exporter.formatCsvField('+SUM(A1:A10)')).toBe(`"\'+SUM(A1:A10)"`);
        expect(Exporter.formatCsvField('-cmd|\' /C calc\'!A0')).toBe(`"\'-cmd|\' /C calc\'!A0"`);
        expect(Exporter.formatCsvField('@foo')).toBe(`"\'@foo"`);
        expect(Exporter.formatCsvField('\t=1+1')).toBe(`"\'\t=1+1"`);
        expect(Exporter.formatCsvField('\r=1+1')).toBe(`"\'\r=1+1"`);
        expect(Exporter.formatCsvField('   =foo')).toBe(`"\'   =foo"`); // leading spaces
        expect(Exporter.formatCsvField('-1+2')).toBe(`"\'-1+2"`); // stringa, non numero

        // Stringhe legittime
        expect(Exporter.formatCsvField('Allenamento normale')).toBe(`"Allenamento normale"`);
        expect(Exporter.formatCsvField('Nota: 1+1 fa 2')).toBe(`"Nota: 1+1 fa 2"`); // + non all'inizio

        // Quotazione doppie virgolette interne (e conservazione newline)
        expect(Exporter.formatCsvField('Nota con "virgolette"')).toBe(`"Nota con ""virgolette"""`);
        expect(Exporter.formatCsvField('Nota\nMulti riga')).toBe(`"Nota\nMulti riga"`);

        // Comportamenti numerici e nullish (NON devono essere alterati o diventare stringhe vuote inattese)
        expect(Exporter.formatCsvField(0)).toBe('0');
        expect(Exporter.formatCsvField(-12.5)).toBe('-12.5'); // Numero negativo legittimo!
        expect(Exporter.formatCsvField(false)).toBe('false');
        expect(Exporter.formatCsvField(null)).toBe('');
        expect(Exporter.formatCsvField(undefined)).toBe('');
    });

    it('exportToCSV mantiene righe coerenti e neutralizza i campi testuali pericolosi', async () => {
        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockResolvedValue(true);
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockImplementation(() => {});

        await Exporter.exportToCSV([
            {
                id: '1',
                date: '2023-10-10',
                globalStartTime: Date.parse('2023-10-10T10:00:00.000Z'),
                routineName: '=cmd|calc',
                globalDurationStr: '01:00:00',
                exercises: [{
                    id: 'se1',
                    exId: 'ex1',
                    sessionNote: '',
                    sets: [{ id: 's1', reps: '10', kg: '-10' }],
                }],
            },
        ], {
            '2023-10-10': {
                date: '2023-10-10',
                kcal: 2000,
                carbs: 200,
                pro: 150,
                fat: 60,
                weight: 80,
                measurementTime: '08:00',
            },
        }, [{ id: 'ex1', name: '-Attacco!' }]);

        expect(downloadSpy).toHaveBeenCalledTimes(2);
        const workoutCsv = downloadSpy.mock.calls[0][1];
        const nutritionCsv = downloadSpy.mock.calls[1][1];

        const parseCsvForTest = (text: string): string[][] => {
            const rows: string[][] = [];
            let currentRow: string[] = [];
            let currentCell = '';
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const nextChar = text[i + 1];
                if (inQuotes) {
                    if (char === '"') {
                        if (nextChar === '"') { currentCell += '"'; i++; }
                        else inQuotes = false;
                    } else currentCell += char;
                } else if (char === '"') inQuotes = true;
                else if (char === ',') { currentRow.push(currentCell); currentCell = ''; }
                else if (char === '\r' && nextChar === '\n') {
                    currentRow.push(currentCell); rows.push(currentRow); currentRow = []; currentCell = ''; i++;
                } else if (char === '\n') {
                    currentRow.push(currentCell); rows.push(currentRow); currentRow = []; currentCell = '';
                } else currentCell += char;
            }
            if (currentRow.length > 0 || currentCell !== '') { currentRow.push(currentCell); rows.push(currentRow); }
            return rows;
        };

        const workoutRecords = parseCsvForTest(workoutCsv).filter(row => row.length > 1);
        expect(workoutRecords[1].length).toBe(workoutRecords[0].length);
        expect(workoutRecords[1][0]).toBe('2023-10-10');
        expect(workoutRecords[1][1]).toBe(`'=cmd|calc`);
        expect(workoutRecords[1][2]).toBe(`'-Attacco!`);
        expect(workoutRecords[1][7]).toBe('');

        const nutritionRecords = parseCsvForTest(nutritionCsv).filter(row => row.length > 1);
        expect(nutritionRecords[1].length).toBe(nutritionRecords[0].length);
        expect(nutritionRecords[1][0]).toBe('2023-10-10');

        const testCsv = Exporter.formatCsvRow(['cella con, virgola', 'cella con\nLF', 'cella con\r\nCRLF', 'cella con "quote"', '']);
        const parsedSpecials = parseCsvForTest(testCsv);
        expect(parsedSpecials[0]).toEqual(['cella con, virgola', 'cella con\nLF', 'cella con\r\nCRLF', 'cella con "quote"', '']);

        vi.restoreAllMocks();
    });

});
