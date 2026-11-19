import { describe, it, expect } from 'vitest';
import { Logic } from './logic';
import { createFoodSearcher } from './calc/foodSearch';

describe('Logic Library Tests', () => {
    
    it('calculateMacrosFromKg does not adopt the retired object signature or return aliases', () => {
        const oldInput = { weight: 80, carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 };
        expect(Logic.calculateMacrosFromKg(oldInput as unknown as number).totalKcal).toBe(0);
        const current = Logic.calculateMacrosFromKg('80', '3.5', '2', '1');
        expect(current).toEqual({ carbsGrams: 280, proGrams: 160, fatGrams: 80,
            carbsKcal: 1120, proKcal: 640, fatKcal: 720, totalKcal: 2480 });
        for (const alias of ['carbsG', 'proG', 'fatG', 'fat']) expect(current).not.toHaveProperty(alias);
    });

    it('calculateMacrosFromKg: calculates correct macros based on body weight', () => {
        const weight = 80;
        const carbsPerKg = 3.5;
        const proPerKg = 2.0;
        const fatPerKg = 1.0;
        
        const macros = Logic.calculateMacrosFromKg(weight, carbsPerKg, proPerKg, fatPerKg);
        
        expect(macros.carbsGrams).toBeCloseTo(80 * 3.5); // 280
        expect(macros.proGrams).toBeCloseTo(80 * 2.0);   // 160
        expect(macros.fatGrams).toBeCloseTo(80 * 1.0);   // 80
        
        // 280*4 + 160*4 + 80*9 = 1120 + 640 + 720 = 2480
        expect(macros.totalKcal).toBeCloseTo(2480);
    });

    it('calculateBodyFat: uses US Navy male circumference formula', () => {
        const weight = 80; // kg
        const profile = {
            gender: 'M',
            height: 180, // cm
            neck: 38,
            waist: 85
        };
        // Expected BF based on Navy formula
        const bf = Logic.calculateBodyFat(weight, profile);
        // US Navy independent reference: 495 / (1.0324 - 0.19077*log10(85-38) + 0.15456*log10(180)) - 450.
        expect(bf).toBe(16.1);
    });

    it('calculateBodyFat: uses US Navy female circumference formula', () => {
        const weight = 65; // kg
        const profile = {
            gender: 'F',
            height: 165, // cm
            neck: 34,
            waist: 70,
            hip: 95
        };
        const bf = Logic.calculateBodyFat(weight, profile);
        // US Navy independent reference: 495 / (1.29579 - 0.35004*log10(70+95-34) + 0.22100*log10(165)) - 450.
        expect(bf).toBe(23.8);
    });

    it('calculateTDEE: estimates TDEE correctly from chronoData', () => {
        // Mock 14 days of data with steady weight and exactly 2500 kcal intake
        const chronoData = [];
        for (let i = 0; i < 14; i++) {
            const date = Logic.getLocalDateString(new Date(2023, 0, i + 1));
            chronoData.push({
                date,
                kcal: 2500,
                weight: 80 // weight doesn't change
            });
        }

        const tdee = Logic.calculateTDEE(chronoData);
        expect(tdee.error).toBe(false);
        expect(Number(tdee.tdee)).toBe(2500); // Because weight is steady, TDEE = intake
        expect(Number(tdee.weightDiff)).toBe(0);
    });

    it('calculateTDEE: never returns zero or negative daily energy expenditure', () => {
        const records = Array.from({ length: 7 }, (_, index) => ({
            date: `2026-10-${String(index + 1).padStart(2, '0')}`,
            weight: 80 + index / 3,
            kcal: 2000,
        }));
        // A 2 kg gain over 6 days is compatible with substantial water-weight
        // fluctuation, not with a physiologically meaningful negative TDEE.
        const estimated = Logic.calculateTDEE(records);
        expect(estimated.error).toBe(true);
        expect(estimated.message).toContain('Stima non attendibile');
        expect(estimated).not.toHaveProperty('tdee');

        const nutrition = Object.fromEntries(records.map(day => [day.date, {
            weight: day.weight, kcal: day.kcal, meals: [],
        }]));
        const summary = Logic.calculateTDEEAndMacros({
            nutrition,
            nutritionPlanning: { weight: 80, normocalorica: { kcal: 2400 } },
        } as any);
        expect(summary.tdee).toBe(2400);
    });

    it('calculateTDEE: does not estimate expenditure from seven isolated monthly records', () => {
        const sparseRecords = Array.from({ length: 7 }, (_, index) => ({
            date: `2026-${String(index + 1).padStart(2, '0')}-01`,
            weight: 80 + index * 0.1,
            kcal: 2500,
        }));
        const result = Logic.calculateTDEE(sparseRecords);
        expect(result.error).toBe(true);
        expect(result.message).toContain('giornate valide negli ultimi 14 giorni');
        expect(result).not.toHaveProperty('tdee');

        // A rejected estimate must not overwrite a user-entered normocaloric target.
        const nutrition = Object.fromEntries(sparseRecords.map(({ date, weight, kcal }) => [
            date, { date, weight, kcal, meals: [] },
        ]));
        const summary = Logic.calculateTDEEAndMacros({
            nutrition,
            nutritionPlanning: { weight: 80, normocalorica: { kcal: 2350 } },
        } as any);
        expect(summary.tdee).toBe(2350);
    });

    it('calculateTDEE: uses only recent calendar days, not older caloric records', () => {
        const oldWeek = Array.from({ length: 7 }, (_, index) => ({
            date: `2026-01-${String(index + 1).padStart(2, '0')}`,
            weight: 80, kcal: 4000,
        }));
        const recentWeek = Array.from({ length: 7 }, (_, index) => ({
            date: `2026-04-${String(index + 1).padStart(2, '0')}`,
            weight: 80, kcal: 2100,
        }));
        const result = Logic.calculateTDEE([...recentWeek, ...oldWeek]);
        expect(result.error).toBe(false);
        expect(result.tdee).toBe(2100);
        expect(result.avgKcal).toBe(2100);
        expect(result.daysTracked).toBe(7);
        expect(result.timeSpanDays).toBe(6);
    });

    it('calculateTDEE: estimates TDEE correctly when gaining weight', () => {
        const chronoData = [];
        for (let i = 0; i < 14; i++) {
            const date = Logic.getLocalDateString(new Date(2023, 0, i + 1));
            chronoData.push({
                date,
                kcal: 3000,
                weight: 80 + (i * (1/13)) // linear increase from 80 to 81
            });
        }
        chronoData[0].weight = 80;
        chronoData[13].weight = 81;

        const tdee = Logic.calculateTDEE(chronoData);
        expect(tdee.error).toBe(false);
        expect(tdee.tdee).toBeGreaterThan(2300);
        expect(tdee.tdee).toBeLessThan(2700);
    });

    it('calculateTDEE: produces identical results for pre-sorted, reverse-sorted, and randomly shuffled arrays', () => {
        const ascendingData = [];
        for (let i = 0; i < 14; i++) {
            const date = Logic.getLocalDateString(new Date(2026, 7, i + 1));
            ascendingData.push({
                date,
                kcal: 2800,
                weight: 75 + (i * 0.1) // 75.0 to 76.3
            });
        }
        ascendingData[0].weight = 75;
        ascendingData[13].weight = 76;

        const descendingData = [...ascendingData].reverse();
        // Deterministic odd/even permutation: unlike random sort, this always
        // exercises non-chronological input without nondeterministic CI outcomes.
        const shuffledData = [
            ...ascendingData.filter((_, i) => i % 2 === 1),
            ...ascendingData.filter((_, i) => i % 2 === 0),
        ];
        expect(shuffledData.map(day => day.date)).not.toEqual(ascendingData.map(day => day.date));

        const resAsc = Logic.calculateTDEE(ascendingData);
        const resDesc = Logic.calculateTDEE(descendingData);
        const resShuffled = Logic.calculateTDEE(shuffledData);

        expect(resAsc.error).toBe(false);
        expect(resDesc.error).toBe(false);
        expect(resShuffled.error).toBe(false);

        expect(resDesc.tdee).toBe(resAsc.tdee);
        expect(resShuffled.tdee).toBe(resAsc.tdee);
        expect(resDesc.weightDiff).toBe(resAsc.weightDiff);
        expect(resShuffled.weightDiff).toBe(resAsc.weightDiff);
    });

    it('calculateTDEE: handles edge cases gracefully (0, 1, 6 measurements, same day, non-array)', () => {
        // Non-array
        expect(Logic.calculateTDEE(null as any)).toEqual({ error: true, message: 'Dati non validi' });
        expect(Logic.calculateTDEE(undefined as any)).toEqual({ error: true, message: 'Dati non validi' });
        expect(Logic.calculateTDEE('string' as any)).toEqual({ error: true, message: 'Dati non validi' });

        // 0 measurements
        expect(Logic.calculateTDEE([])).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (0/7 giorni richiesti)'
        });

        // 1 measurement
        expect(Logic.calculateTDEE([{ date: '2026-08-01', weight: 80, kcal: 2500 }])).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (1/7 giorni richiesti)'
        });

        // 6 measurements
        const sixDays = [];
        for (let i = 0; i < 6; i++) {
            sixDays.push({ date: `2026-08-0${i + 1}`, weight: 80, kcal: 2500 });
        }
        expect(Logic.calculateTDEE(sixDays)).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (6/7 giorni richiesti)'
        });

        // Seven entries for the same day are one calendar-day observation.
        const sameDay = [];
        for (let i = 0; i < 7; i++) {
            sameDay.push({ date: '2026-08-01', weight: 80, kcal: 2500 });
        }
        expect(Logic.calculateTDEE(sameDay)).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (1/7 giorni richiesti)'
        });
    });

    it('calculateTDEE: correctly parses string weights and commas', () => {
        const stringData = [];
        for (let i = 0; i < 14; i++) {
            const date = Logic.getLocalDateString(new Date(2026, 7, i + 1));
            stringData.push({
                date,
                kcal: '2500,0',
                weight: i === 0 ? '80,0' : (i === 13 ? '81,0' : '80,5')
            });
        }
        const res = Logic.calculateTDEE(stringData);
        expect(res.error).toBe(false);
        expect(res.weightDiff).toBe('1.00');
    });

    it('getLocalDateString: formats local date YYYY-MM-DD correctly', () => {
        const testDate = new Date(2026, 6, 26); // July 26, 2026
        const dateStr = Logic.getLocalDateString(testDate);
        expect(dateStr).toBe('2026-07-26');
    });

    it('searchFoods: fuzzy search handles typos for food items', () => {
        const foods = [
            { id: 'f1', name: 'Petto di pollo', brand: 'Aia', category: 'Carne' },
            { id: 'f2', name: 'Fiocchi di avena', brand: 'Quaker', category: 'Cereali' },
            { id: 'f3', name: 'Olio extravergine di oliva', brand: 'Monini', category: 'Grassi' }
        ];

        const search = createFoodSearcher(foods);
        // Exact match
        expect(search('pollo').length).toBe(1);

        // Typo match: "peto di polo" -> "Petto di pollo"
        const polloTypo = search('peto polo');
        expect(polloTypo.length).toBeGreaterThan(0);
        expect(polloTypo[0].id).toBe('f1');

        // Typo match: "avenna" -> "Fiocchi di avena"
        const avenaTypo = search('avenna');
        expect(avenaTypo.length).toBeGreaterThan(0);
        expect(avenaTypo[0].id).toBe('f2');
    });

    it('getLocalDateString: handles strings, numbers, dates and invalid input', () => {
        expect(Logic.getLocalDateString('2025-12-31')).toBe('2025-12-31');
        expect(Logic.getLocalDateString(new Date(2025, 11, 31))).toBe('2025-12-31');
        const nowStr = Logic.getLocalDateString();
        expect(nowStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('getCalendarMonthGrid: creates a valid grid starting from Monday with at least 35 cells', () => {
        // August 2026 (month 7)
        const grid = Logic.getCalendarMonthGrid(2026, 7);
        expect(grid.length).toBeGreaterThanOrEqual(35);
        expect(grid.length % 7).toBe(0);

        // Ensure days have valid structure
        const firstCell = grid[0];
        expect(firstCell).toHaveProperty('dayNum');
        expect(firstCell).toHaveProperty('dateStr');
        expect(firstCell).toHaveProperty('isCurrentMonth');
        expect(firstCell).toHaveProperty('isToday');

        // Check that dates are sequential
        expect(firstCell.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('formatItalianDate: formats ISO string or Date to DD/MM/YYYY', () => {
        expect(Logic.formatItalianDate('2026-08-08')).toBe('08/08/2026');
        expect(Logic.formatItalianDate('08/08/2026')).toBe('08/08/2026');
        expect(Logic.formatItalianDate(new Date(2026, 8, 15))).toBe('15/09/2026');
        expect(Logic.formatItalianDate('')).toBe('');
        expect(Logic.formatItalianDate(null)).toBe('');
    });

    it('formatItalianDate: keeps epoch zero and validates calendar-only strings', () => {
        const epoch = new Date(0);
        const epochDate = [epoch.getDate(), epoch.getMonth() + 1, epoch.getFullYear()]
            .map((value, index) => String(value).padStart(index === 2 ? 4 : 2, '0')).join('/');
        expect(Logic.formatItalianDate(0)).toBe(epochDate);
        expect(Logic.formatItalianDate('29/02/2024')).toBe('29/02/2024');
        expect(Logic.formatItalianDate('2024-02-29')).toBe('29/02/2024');
        for (const value of ['29/02/2026', '31/04/2026', '00/00/2026', '2026-02-31', '2026-04-31']) {
            expect(Logic.formatItalianDate(value)).toBe('');
        }
        expect(Logic.formatItalianDate(new Date(Number.NaN))).toBe('');
        expect(Logic.formatItalianDate(Number.NaN)).toBe('');
        expect(Logic.formatItalianDate(undefined)).toBe('');
    });

    it('parseDateInput: parses various date string formats to YYYY-MM-DD', () => {
        expect(Logic.parseDateInput('08/08/2026')).toBe('2026-08-08');
        expect(Logic.parseDateInput('8/8/2026')).toBe('2026-08-08');
        expect(Logic.parseDateInput('15-09-2026')).toBe('2026-09-15');
        expect(Logic.parseDateInput('15.09.2026')).toBe('2026-09-15');
        expect(Logic.parseDateInput('2026-09-15')).toBe('2026-09-15');

        // Invalid dates
        expect(Logic.parseDateInput('31/02/2026')).toBe(null);
        expect(Logic.parseDateInput('invalid')).toBe(null);
        expect(Logic.parseDateInput('')).toBe(null);
        expect(Logic.parseDateInput(null)).toBe(null);
    });


    describe('formatSleepTime, parseSleepInput & isSleepTimeValid', () => {
        it('formatSleepTime: normalizes and validates HH:MM strings', () => {
            expect(Logic.formatSleepTime('08:30')).toBe('08:30');
            expect(Logic.formatSleepTime('8:30')).toBe('08:30');
            expect(Logic.formatSleepTime('00:00')).toBe('00:00');
            expect(Logic.formatSleepTime('23:59')).toBe('23:59');
        });

        it('formatSleepTime: returns empty string for invalid or empty inputs', () => {
            expect(Logic.formatSleepTime('')).toBe('');
            expect(Logic.formatSleepTime('   ')).toBe('');
            expect(Logic.formatSleepTime(null)).toBe('');
            expect(Logic.formatSleepTime(undefined)).toBe('');
            expect(Logic.formatSleepTime('invalid')).toBe('');
            expect(Logic.formatSleepTime('25:00')).toBe('');
            expect(Logic.formatSleepTime('12:65')).toBe('');
        });

        it('parseSleepInput: parses and canonicalizes sleep strings', () => {
            expect(Logic.parseSleepInput('08:30')).toBe('08:30');
            expect(Logic.parseSleepInput('8:30')).toBe('08:30');
            expect(Logic.parseSleepInput('')).toBe(null);
            expect(Logic.parseSleepInput(null)).toBe(null);
            expect(Logic.parseSleepInput(undefined)).toBe(null);
            expect(Logic.parseSleepInput('invalid')).toBe(null);
        });

        it('isSleepTimeValid: validates sleep format correctly', () => {
            expect(Logic.isSleepTimeValid('08:30')).toBe(true);
            expect(Logic.isSleepTimeValid('8:30')).toBe(true);
            expect(Logic.isSleepTimeValid('00:00')).toBe(true);
            expect(Logic.isSleepTimeValid('23:59')).toBe(true);

            expect(Logic.isSleepTimeValid('')).toBe(false);
            expect(Logic.isSleepTimeValid('   ')).toBe(false);
            expect(Logic.isSleepTimeValid(null as any)).toBe(false);
            expect(Logic.isSleepTimeValid(undefined as any)).toBe(false);
            expect(Logic.isSleepTimeValid('invalid')).toBe(false);
            expect(Logic.isSleepTimeValid('25:00')).toBe(false);
            expect(Logic.isSleepTimeValid('08:60')).toBe(false);
        });
    });
});
