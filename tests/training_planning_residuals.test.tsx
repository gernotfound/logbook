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
