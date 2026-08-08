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
            const date = new Date(2023, 0, i + 1).toISOString().split('T')[0];
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
        // Mock 14 days of data, eating 3000 kcal, weight goes from 80 to 81 (+1kg in 14 days)
        // 1kg of tissue = ~7000 kcal surplus. 7000 / 14 days = 500 kcal surplus/day.
        // If intake is 3000, TDEE should be 3000 - 500 = 2500.
        const chronoData = [];
        for (let i = 0; i < 14; i++) {
            const date = new Date(2023, 0, i + 1).toISOString().split('T')[0];
            chronoData.push({
                date,
                kcal: 3000,
                weight: 80 + (i * (1/13)) // linear increase from 80 to 81
            });
        }
        // Force the first and last to be exactly 80 and 81 to avoid floating math issues
        chronoData[0].weight = 80;
        chronoData[13].weight = 81;

        const tdee = Logic.calculateTDEE(chronoData);
        expect(tdee.error).toBe(false);
        // Depending on exact formula (sometimes uses 7700 instead of 7000)
        // Let's assume it's in the ballpark of 2400-2600
        expect(tdee.tdee).toBeGreaterThan(2300);
        expect(tdee.tdee).toBeLessThan(2700);
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
        const age20 = Logic.calculateAge(twentyYearsAgo.toISOString().split('T')[0]);
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
});


