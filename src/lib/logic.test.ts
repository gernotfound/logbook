import { describe, it, expect } from 'vitest';
import { Logic } from './logic';

describe('Logic Library Tests', () => {
    
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

    it('calculateBodyFat: calculates BMI-based body fat for Male correctly', () => {
        const weight = 80; // kg
        const profile = {
            gender: 'M',
            height: 180, // cm
            neck: 38,
            waist: 85
        };
        // Expected BF based on Navy formula
        const bf = Logic.calculateBodyFat(weight, profile);
        expect(Number(bf)).toBeGreaterThan(10);
        expect(Number(bf)).toBeLessThan(25);
    });

    it('calculateBodyFat: calculates BMI-based body fat for Female correctly', () => {
        const weight = 65; // kg
        const profile = {
            gender: 'F',
            height: 165, // cm
            neck: 34,
            waist: 70,
            hip: 95
        };
        const bf = Logic.calculateBodyFat(weight, profile);
        expect(Number(bf)).toBeGreaterThan(15);
        expect(Number(bf)).toBeLessThan(35);
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
        const shuffledData = [...ascendingData].sort(() => 0.5 - Math.random());

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

        // 7 measurements on the exact same date
        const sameDay = [];
        for (let i = 0; i < 7; i++) {
            sameDay.push({ date: '2026-08-01', weight: 80, kcal: 2500 });
        }
        expect(Logic.calculateTDEE(sameDay)).toEqual({
            error: true,
            message: 'Dati insufficienti (stesso giorno)'
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

    it('scaleFoodNutrients: returns zero nutrients when quantity is 0', () => {
        const food = { baseQty: 100, kcal: 200, carbs: 30, pro: 10, fat: 5, unit: 'g' };
        const scaled = Logic.scaleFoodNutrients(food, 0, 'g');
        expect(scaled.kcal).toBe(0);
        expect(scaled.carbs).toBe(0);
        expect(scaled.pro).toBe(0);
        expect(scaled.fat).toBe(0);
    });

    it('calculateNormocaloricaDiff: calculates percentages and returns carbsPct, proPct, fatPct, kcalPct', () => {
        const current = { carbsGrams: 300, proGrams: 160, fatGrams: 70, totalKcal: 2470 };
        const normocalorica = { carbs: 250, pro: 150, fat: 60, kcal: 2140 };
        const diff = Logic.calculateNormocaloricaDiff(current, normocalorica);
        expect(diff!.carbsPct).toBeGreaterThan(0);
        expect(diff!.proPct).toBeGreaterThan(0);
        expect(diff!.fatPct).toBeGreaterThan(0);
        expect(diff!.kcalPct).toBeGreaterThan(0);
    });

    it('filterItems: fuzzy search handles typos for exercises', () => {
        const library = [
            { id: '1', name: 'Panca piana bilanciere' },
            { id: '2', name: 'Squat con bilanciere' },
            { id: '3', name: 'Trazioni alla sbarra' }
        ];

        // Exact search
        expect(Logic.filterItems(library, 'Panca').length).toBe(1);

        // Typo search: "pancca" instead of "panca"
        const typoResults = Logic.filterItems(library, 'pancca');
        expect(typoResults.length).toBeGreaterThan(0);
        expect(typoResults[0].id).toBe('1');

        // Typo search: "squatt" instead of "squat"
        const squatResults = Logic.filterItems(library, 'squatt');
        expect(squatResults.length).toBeGreaterThan(0);
        expect(squatResults[0].id).toBe('2');
    });

    it('searchFoods: fuzzy search handles typos for food items', () => {
        const foods = [
            { id: 'f1', name: 'Petto di pollo', brand: 'Aia', category: 'Carne' },
            { id: 'f2', name: 'Fiocchi di avena', brand: 'Quaker', category: 'Cereali' },
            { id: 'f3', name: 'Olio extravergine di oliva', brand: 'Monini', category: 'Grassi' }
        ];

        // Exact match
        expect(Logic.searchFoods(foods, 'pollo').length).toBe(1);

        // Typo match: "peto di polo" -> "Petto di pollo"
        const polloTypo = Logic.searchFoods(foods, 'peto polo');
        expect(polloTypo.length).toBeGreaterThan(0);
        expect(polloTypo[0].id).toBe('f1');

        // Typo match: "avenna" -> "Fiocchi di avena"
        const avenaTypo = Logic.searchFoods(foods, 'avenna');
        expect(avenaTypo.length).toBeGreaterThan(0);
        expect(avenaTypo[0].id).toBe('f2');
    });

    it('calculateAge: computes age accurately from various inputs', () => {
        // Person born in 1990
        const age1990 = Logic.calculateAge('1990-01-01');
        expect(age1990).toBeGreaterThanOrEqual(34);

        // Person born exactly 20 years ago
        const twentyYearsAgo = new Date();
        twentyYearsAgo.setFullYear(twentyYearsAgo.getFullYear() - 20);
        const age20 = Logic.calculateAge(Logic.getLocalDateString(twentyYearsAgo));
        expect(age20).toBe(20);

        // Fallback for invalid/empty inputs
        expect(Logic.calculateAge('')).toBe(30);
        expect(Logic.calculateAge('invalid-date')).toBe(30);
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

    describe('calculateCycleTimeline', () => {
        it('handles null/undefined or cycles without startDate gracefully', () => {
            const res = Logic.calculateCycleTimeline(null);
            expect(res.currentWeek).toBe(1);
            expect(res.totalWeeks).toBe(4);
            expect(res.progressPercent).toBe(0);

            const cycleWithoutStart = {
                id: 'c1',
                name: 'Test Cycle',
                durationWeeks: 8,
                routines: []
            };
            const res2 = Logic.calculateCycleTimeline(cycleWithoutStart);
            expect(res2.currentWeek).toBe(1);
            expect(res2.totalWeeks).toBe(8);
            expect(res2.formattedRange).toBe('8 settimane');
        });

        it('calculates correct timeline for future cycle (not started)', () => {
            const cycle = {
                id: 'c2',
                name: 'Future Cycle',
                durationWeeks: 4,
                startDate: '2026-09-01',
                routines: []
            };
            const res = Logic.calculateCycleTimeline(cycle, new Date('2026-08-25'));
            expect(res.isStarted).toBe(false);
            expect(res.isEnded).toBe(false);
            expect(res.daysRemaining).toBe(7);
            expect(res.statusLabel).toBe('Inizia tra 7 giorni');
            expect(res.formattedStartDate).toBe('01/09/2026');
            expect(res.formattedEndDate).toBe('28/09/2026');
            expect(res.formattedRange).toBe('dal 01/09/2026 al 28/09/2026');
        });

        it('calculates correct timeline during active cycle', () => {
            const cycle = {
                id: 'c3',
                name: 'Active Cycle',
                durationWeeks: 6,
                startDate: '2026-08-01',
                routines: []
            };
            // 15th of August -> day 15 -> week 3
            const res = Logic.calculateCycleTimeline(cycle, new Date('2026-08-15'));
            expect(res.isStarted).toBe(true);
            expect(res.isEnded).toBe(false);
            expect(res.currentWeek).toBe(3);
            expect(res.totalWeeks).toBe(6);
            expect(res.statusLabel).toBe('Settimana 3 di 6');
            expect(res.progressPercent).toBeGreaterThan(0);
            expect(res.formattedStartDate).toBe('01/08/2026');
            expect(res.formattedEndDate).toBe('11/09/2026');
        });

        it('calculates correct timeline for completed cycle', () => {
            const cycle = {
                id: 'c4',
                name: 'Completed Cycle',
                durationWeeks: 4,
                startDate: '2026-06-01',
                routines: []
            };
            const res = Logic.calculateCycleTimeline(cycle, new Date('2026-08-01'));
            expect(res.isStarted).toBe(true);
            expect(res.isEnded).toBe(true);
            expect(res.progressPercent).toBe(100);
            expect(res.statusLabel).toBe('Ciclo completato');
        });
    });

    describe('calculateCycleSchedule & getNextScheduledRoutine (Rolling Rotation)', () => {
        const mockRoutines = [
            { id: 'rA', name: 'Scheda A', exercises: [] },
            { id: 'rB', name: 'Scheda B', exercises: [] },
            { id: 'rC', name: 'Scheda C', exercises: [] },
            { id: 'rD', name: 'Scheda D', exercises: [] },
            { id: 'rE', name: 'Scheda E', exercises: [] },
            { id: 'rF', name: 'Scheda F', exercises: [] },
        ];

        it('scenario 1: 6 routines (A-F) with 4 sessions/week for 3 weeks', () => {
            const cycle = {
                id: 'cycle-6-4',
                name: 'Ciclo 6 schede 4x',
                durationWeeks: 3,
                sessionsPerWeek: 4,
                startDate: '2026-08-10',
                routines: [
                    { routineId: 'rA', frequencyPerWeek: 1 },
                    { routineId: 'rB', frequencyPerWeek: 1 },
                    { routineId: 'rC', frequencyPerWeek: 1 },
                    { routineId: 'rD', frequencyPerWeek: 1 },
                    { routineId: 'rE', frequencyPerWeek: 1 },
                    { routineId: 'rF', frequencyPerWeek: 1 },
                ]
            };

            const schedule = Logic.calculateCycleSchedule(cycle, mockRoutines as any);
            expect(schedule.totalSessions).toBe(12);
            expect(schedule.weeks.length).toBe(3);

            // Settimana 1: A, B, C, D
            expect(schedule.weeks[0].sessions.map(s => s.routineName)).toEqual(['Scheda A', 'Scheda B', 'Scheda C', 'Scheda D']);
            expect(schedule.weeks[0].sessions[0].globalSessionIndex).toBe(1);

            // Settimana 2: E, F, A, B
            expect(schedule.weeks[1].sessions.map(s => s.routineName)).toEqual(['Scheda E', 'Scheda F', 'Scheda A', 'Scheda B']);
            expect(schedule.weeks[1].sessions[0].globalSessionIndex).toBe(5);

            // Settimana 3: C, D, E, F
            expect(schedule.weeks[2].sessions.map(s => s.routineName)).toEqual(['Scheda C', 'Scheda D', 'Scheda E', 'Scheda F']);
            expect(schedule.weeks[2].sessions[0].globalSessionIndex).toBe(9);

            // Verifica getNextScheduledRoutine
            // 0 sessioni completate -> Scheda A
            const next0 = Logic.getNextScheduledRoutine(cycle, mockRoutines as any, []);
            expect(next0?.nextRoutine?.name).toBe('Scheda A');
            expect(next0?.nextSessionIndex).toBe(1);
            expect(next0?.rotationNumber).toBe(1);
            expect(next0?.positionInRotation).toBe(1);

            // 1 sessione completata -> Scheda B
            const history1 = [{ id: 'w1', cycleId: 'cycle-6-4', routineId: 'rA', date: '2026-08-10' }];
            const next1 = Logic.getNextScheduledRoutine(cycle, mockRoutines as any, history1 as any);
            expect(next1?.nextRoutine?.name).toBe('Scheda B');
            expect(next1?.nextSessionIndex).toBe(2);

            // 4 sessioni completate (fine settimana 1) -> Scheda E (inizio settimana 2)
            const history4 = [
                { id: 'w1', cycleId: 'cycle-6-4', routineId: 'rA', date: '2026-08-10' },
                { id: 'w2', cycleId: 'cycle-6-4', routineId: 'rB', date: '2026-08-11' },
                { id: 'w3', cycleId: 'cycle-6-4', routineId: 'rC', date: '2026-08-13' },
                { id: 'w4', cycleId: 'cycle-6-4', routineId: 'rD', date: '2026-08-14' },
            ];
            const next4 = Logic.getNextScheduledRoutine(cycle, mockRoutines as any, history4 as any);
            expect(next4?.nextRoutine?.name).toBe('Scheda E');
            expect(next4?.nextSessionIndex).toBe(5);
            expect(next4?.rotationNumber).toBe(1);
            expect(next4?.positionInRotation).toBe(5);

            // 6 sessioni completate (terminato il 1° giro di A-F) -> ricomincia con Scheda A (giro 2)
            const history6 = [
                ...history4,
                { id: 'w5', cycleId: 'cycle-6-4', routineId: 'rE', date: '2026-08-17' },
                { id: 'w6', cycleId: 'cycle-6-4', routineId: 'rF', date: '2026-08-18' },
            ];
            const next6 = Logic.getNextScheduledRoutine(cycle, mockRoutines as any, history6 as any);
            expect(next6?.nextRoutine?.name).toBe('Scheda A');
            expect(next6?.nextSessionIndex).toBe(7);
            expect(next6?.rotationNumber).toBe(2);
            expect(next6?.positionInRotation).toBe(1);
        });

        it('scenario 2: 4 routines (A-D) with 1 session/week for 4 weeks', () => {
            const cycle = {
                id: 'cycle-4-1',
                name: 'Ciclo 4 schede 1x',
                durationWeeks: 4,
                sessionsPerWeek: 1,
                startDate: '2026-08-10',
                routines: [
                    { routineId: 'rA', frequencyPerWeek: 1 },
                    { routineId: 'rB', frequencyPerWeek: 1 },
                    { routineId: 'rC', frequencyPerWeek: 1 },
                    { routineId: 'rD', frequencyPerWeek: 1 },
                ]
            };

            const schedule = Logic.calculateCycleSchedule(cycle, mockRoutines as any);
            expect(schedule.totalSessions).toBe(4);
            expect(schedule.weeks.length).toBe(4);

            expect(schedule.weeks[0].sessions.map(s => s.routineName)).toEqual(['Scheda A']);
            expect(schedule.weeks[1].sessions.map(s => s.routineName)).toEqual(['Scheda B']);
            expect(schedule.weeks[2].sessions.map(s => s.routineName)).toEqual(['Scheda C']);
            expect(schedule.weeks[3].sessions.map(s => s.routineName)).toEqual(['Scheda D']);
        });

        it('isolates workouts belonging to other cycles correctly', () => {
            const cycleA = {
                id: 'cycleA',
                name: 'Ciclo A',
                durationWeeks: 4,
                sessionsPerWeek: 3,
                routines: [
                    { routineId: 'rA', frequencyPerWeek: 1 },
                    { routineId: 'rB', frequencyPerWeek: 1 },
                    { routineId: 'rC', frequencyPerWeek: 1 },
                ]
            };

            const historyWithOtherCycle = [
                { id: 'w1', cycleId: 'cycle_OTHER', routineId: 'rA', date: '2026-08-10' },
                { id: 'w2', cycleId: 'cycle_OTHER', routineId: 'rB', date: '2026-08-11' },
                { id: 'w3', cycleId: 'cycleA', routineId: 'rA', date: '2026-08-12' },
            ];

            const next = Logic.getNextScheduledRoutine(cycleA, mockRoutines as any, historyWithOtherCycle as any);
            // Only w3 belongs to cycleA -> completedCount = 1 -> next is Scheda B
            expect(next?.completedCount).toBe(1);
            expect(next?.nextRoutine?.name).toBe('Scheda B');
            expect(next?.nextSessionIndex).toBe(2);
        });

        it('supports repeating routines in sequence (e.g., A, B, A, C)', () => {
            const cycle = {
                id: 'cycle-repeat',
                name: 'Ciclo Split ABAC',
                durationWeeks: 4,
                sessionsPerWeek: 4,
                routines: [
                    { routineId: 'rA', frequencyPerWeek: 1 },
                    { routineId: 'rB', frequencyPerWeek: 1 },
                    { routineId: 'rA', frequencyPerWeek: 1 },
                    { routineId: 'rC', frequencyPerWeek: 1 },
                ]
            };

            const schedule = Logic.calculateCycleSchedule(cycle, mockRoutines as any);
            expect(schedule.weeks[0].sessions.map(s => s.routineName)).toEqual(['Scheda A', 'Scheda B', 'Scheda A', 'Scheda C']);

            const history2 = [
                { id: 'w1', cycleId: 'cycle-repeat', routineId: 'rA' },
                { id: 'w2', cycleId: 'cycle-repeat', routineId: 'rB' },
            ];
            const next = Logic.getNextScheduledRoutine(cycle, mockRoutines as any, history2 as any);
            expect(next?.nextRoutine?.name).toBe('Scheda A');
            expect(next?.positionInRotation).toBe(3);
        });
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

    describe('Volume & Weight Calculation Engine (R1)', () => {
        describe('getLatestUserWeight', () => {
            it('returns latest weight from chronological nutrition days', () => {
                const nutrition = {
                    '2026-08-01': { weight: 82.5 },
                    '2026-08-15': { weight: 81.0 },
                    '2026-08-10': { weight: 81.8 },
                };
                expect(Logic.getLatestUserWeight(nutrition)).toBe(81.0);
            });

            it('skips invalid/empty weight entries in nutrition', () => {
                const nutrition = {
                    '2026-08-01': { weight: 82.5 },
                    '2026-08-15': { weight: '' },
                    '2026-08-20': { weight: null },
                };
                expect(Logic.getLatestUserWeight(nutrition)).toBe(82.5);
            });

            it('falls back to nutritionPlanning weight if no valid nutrition entries', () => {
                const planning = { weight: 75 };
                expect(Logic.getLatestUserWeight({}, planning)).toBe(75);
                expect(Logic.getLatestUserWeight(null, planning)).toBe(75);
            });

            it('falls back to 80 if both nutrition and nutritionPlanning are missing or empty', () => {
                expect(Logic.getLatestUserWeight(null, null)).toBe(80);
                expect(Logic.getLatestUserWeight({}, {})).toBe(80);
            });
        });

        describe('calculateEffectiveSetWeight', () => {
            it('returns baseKg for standard exercise without bodyweight or equipment', () => {
                expect(Logic.calculateEffectiveSetWeight(50, null, 80)).toBe(50);
                expect(Logic.calculateEffectiveSetWeight('60', { isBodyweight: false }, 75)).toBe(60);
            });

            it('adds user weight when isBodyweight is true', () => {
                // 0 kg + 80 kg user = 80 kg
                expect(Logic.calculateEffectiveSetWeight(0, { isBodyweight: true }, 80)).toBe(80);
                expect(Logic.calculateEffectiveSetWeight('0', { isBodyweight: true }, 80)).toBe(80);
                // +10 kg ballast + 80 kg user = 90 kg
                expect(Logic.calculateEffectiveSetWeight(10, { isBodyweight: true }, 80)).toBe(90);
                expect(Logic.calculateEffectiveSetWeight('15.5', { isBodyweight: true }, 70)).toBe(85.5);
            });

            it('adds equipment weight when equipmentWeight is specified', () => {
                // 60 kg + 20 kg barbell = 80 kg
                expect(Logic.calculateEffectiveSetWeight(60, { equipmentWeight: 20 }, 80)).toBe(80);
                expect(Logic.calculateEffectiveSetWeight(0, { equipmentWeight: 20 }, 80)).toBe(20);
            });

            it('combines bodyweight and equipment weight when both are present', () => {
                // 0 kg + 75 kg user + 5 kg weighted vest = 80 kg
                expect(Logic.calculateEffectiveSetWeight(0, { isBodyweight: true, equipmentWeight: 5 }, 75)).toBe(80);
                // 10 kg + 75 kg user + 5 kg vest = 90 kg
                expect(Logic.calculateEffectiveSetWeight(10, { isBodyweight: true, equipmentWeight: 5 }, 75)).toBe(90);
            });

            it('handles invalid or undefined inputs gracefully', () => {
                expect(Logic.calculateEffectiveSetWeight('', null, 80)).toBe(0);
                expect(Logic.calculateEffectiveSetWeight(null, null, 80)).toBe(0);
                expect(Logic.calculateEffectiveSetWeight('invalid', null, 80)).toBe(0);
            });
        });

        describe('calculateSetVolume', () => {
            it('calculates standard volume as effectiveWeight * reps', () => {
                const set = { kg: '50', reps: '10' };
                expect(Logic.calculateSetVolume(set, null, 80)).toBe(500);
            });

            it('calculates volume for bodyweight exercise with 0 kg correctly (acceptance criterion R1)', () => {
                const set = { kg: '0', reps: '10' };
                const bwEx = { isBodyweight: true };
                // 80 kg * 10 reps = 800
                expect(Logic.calculateSetVolume(set, bwEx, 80)).toBe(800);
            });

            it('includes dropsets volume in the total set volume', () => {
                const set = {
                    kg: '100',
                    reps: '8', // 800
                    dropsets: [
                        { kg: '70', reps: '6' },  // 420
                        { kg: '50', reps: '8' }   // 400
                    ]
                };
                expect(Logic.calculateSetVolume(set, null, 80)).toBe(800 + 420 + 400); // 1620
            });

            it('includes dropsets on bodyweight exercises', () => {
                const set = {
                    kg: '20', // +20 ballast on 80kg = 100kg
                    reps: '5', // 500
                    dropsets: [
                        { kg: '0', reps: '5' } // 0 ballast on 80kg = 80kg * 5 = 400
                    ]
                };
                const bwEx = { isBodyweight: true };
                expect(Logic.calculateSetVolume(set, bwEx, 80)).toBe(500 + 400); // 900
            });

            it('returns 0 for null/undefined or empty sets', () => {
                expect(Logic.calculateSetVolume(null as any)).toBe(0);
                expect(Logic.calculateSetVolume({ kg: '50', reps: '0' })).toBe(0);
            });
        });

        describe('calculateWorkoutVolume', () => {
            it('calculates total volume across multiple exercises matching library metadata', () => {
                const library = [
                    { id: 'ex-bench', name: 'Panca piana', isBodyweight: false, equipmentWeight: 0 },
                    { id: 'ex-pullup', name: 'Trazioni', isBodyweight: true, equipmentWeight: 0 },
                    { id: 'ex-trapbar', name: 'Trap Bar Deadlift', isBodyweight: false, equipmentWeight: 25 },
                ];

                const session = {
                    exercises: [
                        {
                            exId: 'ex-bench',
                            sets: [
                                { kg: '80', reps: '10' }, // 800
                                { kg: '90', reps: '8' }   // 720
                            ]
                        },
                        {
                            exId: 'ex-pullup',
                            sets: [
                                { kg: '0', reps: '10' }, // (80 + 0) * 10 = 800
                                { kg: '10', reps: '6' }  // (80 + 10) * 6 = 540
                            ]
                        },
                        {
                            exId: 'ex-trapbar',
                            sets: [
                                { kg: '100', reps: '5' } // (100 + 25) * 5 = 625
                            ]
                        }
                    ]
                };

                const total = Logic.calculateWorkoutVolume(session, library, 80);
                expect(total).toBe(800 + 720 + 800 + 540 + 625); // 3485
            });

            it('returns 0 for empty or invalid sessions', () => {
                expect(Logic.calculateWorkoutVolume(null as any)).toBe(0);
                expect(Logic.calculateWorkoutVolume({ exercises: [] })).toBe(0);
            });
        });

        describe('DOMS Muscle Pain Tracking & Auto-Healing (R5 & R6)', () => {
            it('getMuscleName: returns Italian localized name for valid ID and falls back to ID if not found', () => {
                expect(Logic.getMuscleName('chest')).toBe('Petto');
                expect(Logic.getMuscleName('biceps')).toBe('Bicipiti');
                expect(Logic.getMuscleName('biceps_left')).toBe('Bicipite sinistro');
                expect(Logic.getMuscleName('unknown_muscle_id')).toBe('unknown_muscle_id');
                expect(Logic.getMuscleName('')).toBe('');
            });

            it('searchMuscles: finds muscles with direct, fuzzy, and Italian stemmed queries', () => {
                const chestMatches = Logic.searchMuscles('pettorali');
                expect(chestMatches.length).toBeGreaterThan(0);
                expect(chestMatches.some(m => m.id === 'chest' || m.name.toLowerCase().includes('petto'))).toBe(true);

                const bicepsMatches = Logic.searchMuscles('bicipite');
                expect(bicepsMatches.length).toBeGreaterThan(0);
                expect(bicepsMatches.some(m => m.id.includes('biceps'))).toBe(true);

                const emptyMatches = Logic.searchMuscles('');
                expect(emptyMatches).toEqual([]);
            });

            it('autoHealPains: heals trained primary muscle if left unselected in session pains', () => {
                const activePains = ['chest', 'quads'];
                const sessionExercises = [{ exId: 'ex_bench' }];
                const library = [{ id: 'ex_bench', muscles: ['chest'] }];
                const sessionPains: string[] = []; // Not re-selected

                const result = Logic.autoHealPains(activePains, sessionExercises, library, sessionPains);
                expect(result).toEqual(['quads']); // Chest healed, quads preserved
            });

            it('autoHealPains: preserves trained primary muscle if re-selected in session pains', () => {
                const activePains = ['chest', 'quads'];
                const sessionExercises = [{ exId: 'ex_bench' }];
                const library = [{ id: 'ex_bench', muscles: ['chest'] }];
                const sessionPains = ['chest']; // Explicitly re-selected

                const result = Logic.autoHealPains(activePains, sessionExercises, library, sessionPains);
                expect(result).toEqual(['chest', 'quads']);
            });

            it('autoHealPains: handles lateral muscle symmetry during auto-healing', () => {
                const activePains = ['biceps_left'];
                const sessionExercises = [{ exId: 'ex_curls' }];
                const library = [{ id: 'ex_curls', muscles: ['biceps'] }];
                const sessionPains: string[] = [];

                const result = Logic.autoHealPains(activePains, sessionExercises, library, sessionPains);
                expect(result).toEqual([]); // Healed
            });

            it('autoHealPains: appends newly reported post-workout pains', () => {
                const activePains = ['lats'];
                const sessionExercises = [{ exId: 'ex_squat' }];
                const library = [{ id: 'ex_squat', muscles: ['quads'] }];
                const sessionPains = ['quads', 'glutes'];

                const result = Logic.autoHealPains(activePains, sessionExercises, library, sessionPains);
                expect(result).toContain('lats');   // Untrained, preserved
                expect(result).toContain('quads');  // Trained but re-selected
                expect(result).toContain('glutes'); // Brand new pain
            });

            it('autoHealPains: safely handles null and empty inputs without crashing', () => {
                expect(Logic.autoHealPains()).toEqual([]);
                expect(Logic.autoHealPains(null as any, null as any, null as any, null as any)).toEqual([]);
            });
        });
    });
});



