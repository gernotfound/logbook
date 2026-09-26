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

    it('exportToCSV produce un formato CSV sicuro', async () => {
        // Mock downloadFile per catturare il risultato finale
        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockImplementation(() => {});

        const mockHistory = [
            {
                id: '1',
                globalStartTime: '2023-10-10T10:00:00.000Z',
                routineName: '=cmd|calc', // Malevolo
                globalDurationStr: '01:00:00',
                exercises: [
                    {
                        exId: 'ex1',
                        name: '-Attacco!', // Malevolo
                        sets: [
                            { reps: 10, weight: -10 } // Numero negativo (legittimo)
                        ]
                    }
                ]
            }
        ];

        const mockNutrition = {
            '2023-10-10': {
                weight: 80,
                notes: '+SUM(B2:B5)\nAltra riga' // Malevolo con newline
            }
        };

        vi.useFakeTimers();
        await Exporter.exportToCSV(mockHistory, mockNutrition, []);
        
        // La seconda chiamata (misurazioni) avviene dopo un setTimeout(..., 500)
        vi.advanceTimersByTime(600);

        expect(downloadSpy).toHaveBeenCalledTimes(2); // allenamenti e misurazioni

        const workoutCsv = downloadSpy.mock.calls[0][1];
        const nutritionCsv = downloadSpy.mock.calls[1][1];
        // Parser di test limitato, conforme RFC 4180
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
                        if (nextChar === '"') {
                            currentCell += '"';
                            i++; // salta escape
                        } else {
                            inQuotes = false;
                        }
                    } else {
                        currentCell += char;
                    }
                } else {
                    if (char === '"') {
                        inQuotes = true;
                    } else if (char === ',') {
                        currentRow.push(currentCell);
                        currentCell = '';
                    } else if (char === '\r' && nextChar === '\n') {
                        currentRow.push(currentCell);
                        rows.push(currentRow);
                        currentRow = [];
                        currentCell = '';
                        i++; // salta \n
                    } else if (char === '\n') {
                        currentRow.push(currentCell);
                        rows.push(currentRow);
                        currentRow = [];
                        currentCell = '';
                    } else {
                        currentCell += char;
                    }
                }
            }
            if (currentRow.length > 0 || currentCell !== '') {
                currentRow.push(currentCell);
                rows.push(currentRow);
            }
            return rows;
        };

        const workoutRecords = parseCsvForTest(workoutCsv);
        // La riga 0 è l'header, la 1 è il record; il numero di colonne deve restare coerente anche con i nuovi metadati.
        // La riga 2 potrebbe essere vuota se c'è un trailing newline.
        const validWorkoutRecords = workoutRecords.filter(r => r.length > 1);
        
        expect(validWorkoutRecords[0].length).toBe(26);
        expect(validWorkoutRecords[1].length).toBe(26);
        expect(validWorkoutRecords[1][1]).toBe(`'=cmd|calc`);
        expect(validWorkoutRecords[1][2]).toBe(`'-Attacco!`);
        expect(validWorkoutRecords[1][7]).toBe(''); // RIR assente resta una cella vuota.
        expect(validWorkoutRecords[1][9]).toBe("-10"); // Kg numerico intoccato!

        // Test espliciti su Nutrition per LF, CRLF, escaped quotes e virgole interne
        const nutritionRecords = parseCsvForTest(nutritionCsv).filter(r => r.length > 1);
        expect(nutritionRecords[0].length).toBe(22);
        expect(nutritionRecords[1].length).toBe(22);
        
        // Verifica multiriga (RFC 4180 garantisce che questo non spezzi la riga se i quotes sono corretti)
        // Dimostra LF dentro cella, escaped quote ("") se ci fossero
        expect(nutritionRecords[1][21]).toBe(`'+SUM(B2:B5)\nAltra riga`);
        
        // Ulteriore test per casi speciali
        const testCsv = Exporter.formatCsvRow(['cella con, virgola', 'cella con\nLF', 'cella con\r\nCRLF', 'cella con "quote"', '']);
        const parsedSpecials = parseCsvForTest(testCsv);
        expect(parsedSpecials[0][0]).toBe('cella con, virgola');
        expect(parsedSpecials[0][1]).toBe('cella con\nLF');
        expect(parsedSpecials[0][2]).toBe('cella con\r\nCRLF');
        expect(parsedSpecials[0][3]).toBe('cella con "quote"');
        expect(parsedSpecials[0][4]).toBe(''); // Cella vuota
        
        // Pulizia
        vi.useRealTimers();
        vi.restoreAllMocks();
    });
});
