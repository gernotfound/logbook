import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateCycleSchedule, calculateCycleTimeline, calculateCycleVolume, getNextScheduledRoutine } from '../src/lib/calc/planning';
import { calculateCycleMacroVolume } from '../src/components/Training/planning/cycleMacroVolume';
import { CycleCard } from '../src/components/Training/planning/CycleCard';
import { GlobalTimer } from '../src/components/Training/ActiveWorkoutSession';
import * as clockGuard from '../src/lib/workoutClockGuard';
import { useAppStore } from '../src/store/useAppStore';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../src/types';

const library: Exercise[] = [{ id: 'bench', name: 'Panca', muscles: ['chest'], setsCount: 4, sets: [] }];
const routines: WorkoutRoutine[] = [{ id: 'r', name: 'Scheda', exercises: [{ exId: 'bench', setsCount: 4 }] }];
const cycle: TrainingCycle = {
    id: 'legacy', name: 'Ciclo storico', durationWeeks: 4, sessionsPerWeek: 3,
    routines: [{ routineId: 'r', frequencyPerWeek: 1 }],
};

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('training planning residual regressions', () => {
    it('does not reinterpret a negative historical duration as one week', () => {
        for (const durationWeeks of [-1, -100, Number.MAX_VALUE]) {
            const malformed = { ...cycle, durationWeeks };
            expect(calculateCycleSchedule(malformed, routines).weeks).toEqual([]);
            expect(calculateCycleTimeline(malformed).statusLabel).toBe('Parametri del ciclo da correggere');
            expect(getNextScheduledRoutine(malformed, routines, [])).toBeNull();
        }
    });

    it('rejects malformed historical start dates rather than assuming they mean today', () => {
        for (const startDate of ['not-a-date', '2026-13-42']) {
            const malformed = { ...cycle, startDate };
            const timeline = calculateCycleTimeline(malformed, '2026-10-16');
            expect(timeline.isStarted).toBe(false);
            expect(timeline.statusLabel).toBe('Parametri del ciclo da correggere');
            expect(timeline.progressPercent).toBe(0);
            expect(malformed.startDate).toBe(startDate);
        }
    });

    it('uses actual cycle end date for full or partial weeks and keeps target consistent', () => {
        const shortened = {
            ...cycle, durationWeeks: 4, sessionsPerWeek: 4,
            startDate: '2026-10-01', endDate: '2026-10-10',
        };
        const schedule = calculateCycleSchedule(shortened, routines);
        expect(schedule.weeks).toHaveLength(2);
        expect(schedule.totalSessions).toBe(8);
        expect(schedule.weeks[0].startDateStr).toBe('2026-10-01');
        expect(schedule.weeks[0].endDateStr).toBe('2026-10-07');
        expect(schedule.weeks[1].startDateStr).toBe('2026-10-08');
        expect(schedule.weeks[1].endDateStr).toBe('2026-10-10');
        expect(calculateCycleSchedule(shortened, routines, false).totalSessions).toBe(8);
        expect(getNextScheduledRoutine(shortened, routines, [])?.totalSessions).toBe(8);
        expect(calculateCycleTimeline(shortened, '2026-10-11').isEnded).toBe(true);

        const extended = { ...shortened, durationWeeks: 2, endDate: '2026-10-25' };
        const extendedSchedule = calculateCycleSchedule(extended, routines);
        expect(extendedSchedule.weeks).toHaveLength(4);
        expect(extendedSchedule.totalSessions).toBe(16);
        expect(extendedSchedule.weeks[3].endDateStr).toBe('2026-10-25');
        expect(getNextScheduledRoutine(extended, routines, [])?.totalSessions).toBe(16);
        expect(extended.durationWeeks).toBe(2);

        const absurd = { ...shortened, endDate: '2030-10-10' };
        expect(calculateCycleSchedule(absurd, routines).weeks).toEqual([]);
        expect(calculateCycleSchedule(absurd, routines).summaryText).toBe('Parametri del ciclo da correggere');
        expect(getNextScheduledRoutine(absurd, routines, [])).toBeNull();
    });

    it('does not redistribute a deleted routine\'s frequency or volume to surviving routines', () => {
        const missing = {
            ...cycle, sessionsPerWeek: undefined, routines: [
                { routineId: 'deleted', frequencyPerWeek: 3 }, { routineId: 'r', frequencyPerWeek: 1 },
            ],
        };
        const volume = calculateCycleVolume(missing, routines, library);
        const macro = calculateCycleMacroVolume(missing, routines, library);
        expect(calculateCycleSchedule(missing, routines).sessionsPerWeek).toBe(4);
        expect(getNextScheduledRoutine(missing, routines, [])?.totalSessions).toBe(16);
        expect(volume.totalWorkoutsPerWeek).toBe(4);
        expect(volume.totalSetsPerWeek).toBe(4);
        expect(macro.find(item => item.key === 'chest')?.sets).toBe(4);

        const weighted = { ...missing, sessionsPerWeek: 8 };
        expect(calculateCycleVolume(weighted, routines, library).totalWorkoutsPerWeek).toBe(8);
        expect(calculateCycleVolume(weighted, routines, library).totalSetsPerWeek).toBe(8);
        expect(calculateCycleMacroVolume(weighted, routines, library).find(item => item.key === 'chest')?.sets).toBe(8);
        expect(missing.routines[0].routineId).toBe('deleted');
    });

    it('computes the same summary without constructing all week entries', () => {
        const full = calculateCycleSchedule(cycle, routines);
        const closed = calculateCycleSchedule(cycle, routines, false);
        expect(full.weeks).toHaveLength(4);
        expect(closed.weeks).toEqual([]);
        expect(closed.totalSessions).toBe(full.totalSessions);
        expect(closed.summaryText).toBe(full.summaryText);
    });

    it('does not calculate non-finite or negative historical set volumes', () => {
        for (const sessionsPerWeek of [Number.POSITIVE_INFINITY, Number.MAX_VALUE, -3, 0]) {
            const malformed = { ...cycle, sessionsPerWeek };
            expect(calculateCycleVolume(malformed, routines, library).totalSetsPerWeek).toBe(0);
            expect(calculateCycleMacroVolume(malformed, routines, library)).toEqual([]);
        }
        const malformedFrequency = { ...cycle, routines: [{ routineId: 'r', frequencyPerWeek: -20 }] };
        expect(calculateCycleVolume(malformedFrequency, routines, library).muscleVolumes).toEqual([]);
        expect(calculateCycleMacroVolume(malformedFrequency, routines, library)).toEqual([]);

        for (const setsCount of [Number.MAX_VALUE, Number.POSITIVE_INFINITY, -5]) {
            const historicRoutines = [{ ...routines[0], exercises: [{ exId: 'bench', setsCount }] }];
            expect(calculateCycleVolume(cycle, historicRoutines, library).muscleVolumes).toEqual([]);
            expect(calculateCycleMacroVolume(cycle, historicRoutines, library)).toEqual([]);
        }
        const historicalZero = [{ ...routines[0], exercises: [{ exId: 'bench', setsCount: 0 }] }];
        const historicalBlank = [{ ...routines[0], exercises: [{ exId: 'bench', setsCount: '' }] }];
        expect(calculateCycleVolume(cycle, historicalZero, library).totalSetsPerWeek).toBe(9);
        expect(calculateCycleMacroVolume(cycle, historicalBlank, library)[0]?.sets).toBe(9);
        expect(calculateCycleVolume(cycle, routines, library).totalSetsPerWeek).toBe(12);
        expect(calculateCycleMacroVolume(cycle, routines, library)[0]?.sets).toBe(12);
    });

    it('builds the inactive-cycle schedule only after its preview is opened', () => {
        render(<CycleCard cycle={cycle} isActive={false} routines={routines}
            onSetActive={vi.fn()} onDeactivate={vi.fn()} onEdit={vi.fn()}
            onDuplicate={vi.fn()} onDelete={vi.fn()} />);
        expect(screen.queryByText('Settimana 1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Ciclo storico/ }));
        expect(screen.queryByText('Settimana 1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Rotazione flessibile/ }));
        expect(screen.getByText('Settimana 1')).toBeDefined();
    });

    it('labels legacy invalid cycle cards without displaying raw Infinity or fabricated frequencies', () => {
        render(<CycleCard
            cycle={{ ...cycle, durationWeeks: Number.POSITIVE_INFINITY, sessionsPerWeek: Number.POSITIVE_INFINITY }}
            isActive={false} routines={routines}
            onSetActive={vi.fn()} onDeactivate={vi.fn()} onEdit={vi.fn()}
            onDuplicate={vi.fn()} onDelete={vi.fn()}
        />);
        expect(screen.queryByText(/Infinity/)).toBeNull();
        expect(screen.getByText(/— settimane · — sedute/)).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: /Ciclo storico/ }));
        expect(screen.getByText('Parametri del ciclo da correggere.')).toBeDefined();
        expect(screen.getByRole('button', { name: /Rotazione flessibile, parametri da correggere/ })).toBeDefined();
    });

    it('surfaces a persistent clock anomaly only once across timer ticks and resume', () => {
        vi.useFakeTimers();
        const errorSpy = vi.spyOn(useAppStore.getState(), 'setSaveError');
        vi.spyOn(clockGuard, 'sampleWorkoutClock').mockReturnValue({ elapsedMs: 120_000, anomalous: true });
        vi.spyOn(clockGuard, 'resumeWorkoutClock').mockReturnValue({ anomalous: true });
        render(<GlobalTimer workoutId="clock-legacy" startTime={1000} />);
        act(() => {
            vi.advanceTimersByTime(4000);
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert').textContent).toContain('Orologio del dispositivo');
    });
});
