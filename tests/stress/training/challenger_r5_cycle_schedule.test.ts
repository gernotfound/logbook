import { describe, expect, it } from 'vitest';
import { calculateCycleTimeline, calculateCycleSchedule } from '../../../src/lib/calc/planning';
import type { TrainingCycle } from '../../../src/types';
import { mockRoutines } from './cycleStressRoutines';

describe('Cycle timeline and session schedule stress', () => {
    describe('2. calculateCycleTimeline and calculateCycleSchedule Stress', () => {
        it('2.1 calculateCycleTimeline accurately computes timeline phases (not started, active, on end date, completed)', () => {
            const cycle: TrainingCycle = {
                id: 'c_test_phases',
                name: 'Ciclo 4 Settimane',
                durationWeeks: 4,
                startDate: '2026-09-01',
                endDate: '2026-09-28', // 28 days
                routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
            };

            // Before start (2026-08-25: 7 days before)
            const beforeStart = calculateCycleTimeline(cycle, '2026-08-25');
            expect(beforeStart.isStarted).toBe(false);
            expect(beforeStart.isEnded).toBe(false);
            expect(beforeStart.currentWeek).toBe(0);
            expect(beforeStart.progressPercent).toBe(0);
            expect(beforeStart.statusLabel).toBe('Inizia tra 7 giorni');
            expect(beforeStart.daysRemaining).toBe(7);

            // Exactly 1 day before (2026-08-31)
            const oneDayBefore = calculateCycleTimeline(cycle, '2026-08-31');
            expect(oneDayBefore.statusLabel).toBe('Inizia domani');
            expect(oneDayBefore.daysRemaining).toBe(1);

            // On Start Date (2026-09-01: day 1)
            const onStart = calculateCycleTimeline(cycle, '2026-09-01');
            expect(onStart.isStarted).toBe(true);
            expect(onStart.isEnded).toBe(false);
            expect(onStart.currentWeek).toBe(1);
            expect(onStart.progressPercent).toBe(4); // round(1/28 * 100) = 4
            expect(onStart.statusLabel).toBe('Settimana 1 di 4');
            expect(onStart.daysRemaining).toBe(27);

            // Mid cycle Week 3 (2026-09-16: day 16 -> diff = 15 -> floor(15/7)+1 = 3)
            const midCycle = calculateCycleTimeline(cycle, '2026-09-16');
            expect(midCycle.currentWeek).toBe(3);
            expect(midCycle.statusLabel).toBe('Settimana 3 di 4');
            expect(midCycle.progressPercent).toBe(57); // round(16/28 * 100) = 57%
            expect(midCycle.daysRemaining).toBe(12);

            // On End Date (2026-09-28: day 28)
            const onEnd = calculateCycleTimeline(cycle, '2026-09-28');
            expect(onEnd.isStarted).toBe(true);
            expect(onEnd.isEnded).toBe(false);
            expect(onEnd.currentWeek).toBe(4);
            expect(onEnd.progressPercent).toBe(100);
            expect(onEnd.daysRemaining).toBe(0);

            // After End Date (2026-09-29: day 29)
            const afterEnd = calculateCycleTimeline(cycle, '2026-09-29');
            expect(afterEnd.isStarted).toBe(true);
            expect(afterEnd.isEnded).toBe(true);
            expect(afterEnd.statusLabel).toBe('Ciclo completato');
            expect(afterEnd.progressPercent).toBe(100);
            expect(afterEnd.daysRemaining).toBe(0);
        });

        it('2.2 calculateCycleTimeline safely discards inverted explicit endDate and recomputes valid range', () => {
            const invertedCycle: TrainingCycle = {
                id: 'c_inv_test',
                name: 'Inverted Cycle',
                durationWeeks: 4,
                startDate: '2026-09-20',
                endDate: '2026-09-01', // Out of order!
                routines: []
            };

            const timeline = calculateCycleTimeline(invertedCycle, '2026-09-20');
            expect(timeline.startDate).toBe('2026-09-20');
            // Recomputed: 2026-09-20 + 27 days = 2026-10-17
            expect(timeline.endDate).toBe('2026-10-17');
            expect(timeline.formattedStartDate).toBe('20/09/2026');
            expect(timeline.formattedEndDate).toBe('17/10/2026');
            expect(timeline.formattedRange).toBe('dal 20/09/2026 al 17/10/2026');
        });

        it('2.3 calculateCycleSchedule distributes weeks with exact weekly date ranges', () => {
            const cycle: TrainingCycle = {
                id: 'c_sched_exact',
                name: 'Ciclo Rotazione',
                durationWeeks: 3,
                startDate: '2026-09-01',
                endDate: '2026-09-21',
                sessionsPerWeek: 3,
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 },
                    { routineId: 'r_legs', frequencyPerWeek: 1 }
                ]
            };

            const schedule = calculateCycleSchedule(cycle, mockRoutines);
            expect(schedule.weeks).toHaveLength(3);
            expect(schedule.totalSessions).toBe(9);
            expect(schedule.fullRotationsCount).toBe(3);
            expect(schedule.remainderSessions).toBe(0);

            // Week 1: 01/09 to 07/09
            expect(schedule.weeks[0].startDateStr).toBe('2026-09-01');
            expect(schedule.weeks[0].endDateStr).toBe('2026-09-07');
            expect(schedule.weeks[0].formattedRange).toBe('01/09 - 07/09');

            // Week 2: 08/09 to 14/09
            expect(schedule.weeks[1].startDateStr).toBe('2026-09-08');
            expect(schedule.weeks[1].endDateStr).toBe('2026-09-14');
            expect(schedule.weeks[1].formattedRange).toBe('08/09 - 14/09');

            // Week 3: 15/09 to 21/09
            expect(schedule.weeks[2].startDateStr).toBe('2026-09-15');
            expect(schedule.weeks[2].endDateStr).toBe('2026-09-21');
            expect(schedule.weeks[2].formattedRange).toBe('15/09 - 21/09');
        });
    });

    // =========================================================================
    // 3. CYCLEEDITOR TWO-WAY REACTIVE STATE TRANSITIONS
    // =========================================================================
});
