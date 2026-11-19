import { describe, it, expect } from 'vitest';
import { Logic } from './logic';

describe('Logic Library Tests', () => {
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

describe('Linear planning history and TDEE feed regressions', () => {
    it('counts only the chosen cycle and selects the last comparable workout on timestamp ties', () => {
        const cycle = {
            id: 'selected', name: 'Ciclo', durationWeeks: 4, sessionsPerWeek: 3,
            routines: ['first', 'second', 'third'].map(routineId => ({ routineId, frequencyPerWeek: 1 })),
        };
        const routines = ['first', 'second', 'third'].map(id => ({ id, name: id, exercises: [] }));
        const unrelated = Array.from({ length: 512 }, (_, index) => ({
            id: `other-${index}`, cycleId: 'different', routineId: 'third',
            date: '2026-10-31', exercises: [],
        }));
        const workout = (id: string, routineId: string, timestamp: number) => ({
            id, cycleId: cycle.id, routineId,
            date: '2026-08-01', globalStartTime: timestamp, exercises: [],
        });
        const history = [
            workout('early-in-array', 'first', 2_000),
            ...unrelated,
            workout('unknown-routine', 'removed', 9_000),
            workout('later-in-array', 'second', 2_000),
            { id: 'without-routine', cycleId: cycle.id, date: '2026-08-01', exercises: [] },
        ];
        const before = JSON.stringify(history);
        const result = Logic.getNextScheduledRoutine(cycle, routines, history);
        expect(result).toMatchObject({
            completedCount: 3, nextSessionIndex: 4, nextRoutineId: 'third',
            nextRoutineName: 'third', totalSessions: 12, isCycleCompleted: false,
        });
        expect(JSON.stringify(history)).toBe(before);

        const reverseTie = [
            workout('later-in-array', 'second', 2_000),
            ...unrelated,
            workout('early-in-array', 'first', 2_000),
        ];
        expect(Logic.getNextScheduledRoutine(cycle, routines, reverseTie)?.nextRoutineId).toBe('second');
        const noKnownRoutine = [{ id: 'unknown', cycleId: cycle.id, routineId: 'removed', exercises: [] }];
        expect(Logic.getNextScheduledRoutine(cycle, routines, noKnownRoutine))
            .toMatchObject({ completedCount: 1, nextRoutineId: 'second' });
    });

    it('estimates the same nutrition TDEE for reversed days and ignores noncanonical keys', () => {
        const recentDays = Array.from({ length: 7 }, (_, i) => ({
            date: `2026-10-${String(i + 1).padStart(2, '0')}`,
            weight: 80, kcal: 2_200,
        }));
        const map = Object.fromEntries([
            ...recentDays.map(day => [day.date, day]),
            ['2026-01-01', { date: '2026-01-01', weight: 100, kcal: 9_000 }],
            ['2026-10-8', { date: '2026-10-8', weight: 100, kcal: 9_000 }],
        ]);
        const original = JSON.stringify(map);
        const plan = { weight: 80, normocalorica: { kcal: 2_400 } };
        for (const nutrition of [map, Object.fromEntries(Object.entries(map).reverse())]) {
            const result = Logic.calculateTDEEAndMacros({ nutrition, nutritionPlanning: plan } as any);
            expect(result.tdee).toBe(2_200);
            expect(result.carbs).toBe(280);
        }
        expect(JSON.stringify(map)).toBe(original);
    });
});
