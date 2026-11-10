import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateCycleSchedule, calculateCycleTimeline, calculateCycleVolume, getNextScheduledRoutine } from '../src/lib/calc/planning';
import { calculateCycleMacroVolume } from '../src/components/Training/planning/cycleMacroVolume';
import { CycleCard } from '../src/components/Training/planning/CycleCard';
import { RoutineCard } from '../src/components/Training/routines/RoutineCard';
import { GlobalTimer } from '../src/components/Training/ActiveWorkoutSession';
import * as clockGuard from '../src/lib/workoutClockGuard';
import { useAppStore } from '../src/store/useAppStore';
import type { Exercise, TrainingCycle, WorkoutRoutine, WorkoutSession } from '../src/types';

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
        expect(calculateCycleVolume(cycle, historicalZero, library).totalSetsPerWeek).toBe(0);
        expect(calculateCycleVolume(cycle, historicalBlank, library).muscleVolumes).toEqual([]);
        expect(calculateCycleMacroVolume(cycle, historicalZero, library)).toEqual([]);
        expect(calculateCycleMacroVolume(cycle, historicalBlank, library)).toEqual([]);
        expect(calculateCycleVolume(cycle, routines, library).totalSetsPerWeek).toBe(12);
        expect(calculateCycleMacroVolume(cycle, routines, library)[0]?.sets).toBe(12);
    });

    it('shows invalid routine set counts without inventing three series', () => {
        render(<RoutineCard
            routine={{ id: 'invalid-count', name: 'Scheda da correggere', exercises: [{ exId: 'bench', setsCount: 0 }] }}
            isExpanded library={library}
            onToggleExpand={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()}
        />);
        expect(screen.getByText('Serie da correggere')).toBeDefined();
        expect(screen.queryByText('3 serie')).toBeNull();
    });

    it('builds the inactive-cycle schedule only after its preview is opened', () => {
        render(<CycleCard cycle={cycle} isActive={false} routines={routines}
            onSetActive={vi.fn()} onDeactivate={vi.fn()} onEdit={vi.fn()}
            onDuplicate={vi.fn()} onDelete={vi.fn()} />);
        expect(screen.queryByText('Settimana 1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Ciclo storico/ }));
        expect(screen.queryByText('Settimana 1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Anteprima della rotazione flessibile.*chiusa/i }));
        expect(screen.getByText('Settimana 1')).toBeDefined();
    });

    it('serializes activation and disables all cycle mutations until persistence settles', async () => {
        let finish!: () => void;
        const onSetActive = vi.fn()
            .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
            .mockResolvedValue(undefined);
        const onEdit = vi.fn();
        const onDuplicate = vi.fn();
        const onDelete = vi.fn();
        const { container } = render(<CycleCard cycle={cycle} isActive={false} routines={routines}
            onSetActive={onSetActive} onDeactivate={vi.fn()} onEdit={onEdit}
            onDuplicate={onDuplicate} onDelete={onDelete} />);

        fireEvent.click(screen.getByRole('button', { name: /Ciclo storico/ }));
        const activate = screen.getByRole('button', { name: 'Imposta come ciclo attivo' });
        fireEvent.click(activate);
        fireEvent.click(activate);
        expect(onSetActive).toHaveBeenCalledTimes(1);
        expect((activate as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Modifica' }) as HTMLButtonElement).disabled).toBe(true);
        expect(container.querySelector('.planning-cycle-item')?.getAttribute('aria-busy')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        for (const action of ['Modifica', 'Duplica', 'Elimina']) {
            expect((screen.getByRole('menuitem', { name: action }) as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(screen.getByRole('menuitem', { name: action }));
        }
        expect(onEdit).not.toHaveBeenCalled();
        expect(onDuplicate).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();

        await act(async () => { finish(); });
        expect((activate as HTMLButtonElement).disabled).toBe(false);
        expect(container.querySelector('.planning-cycle-item')?.getAttribute('aria-busy')).toBe('false');
        fireEvent.click(activate);
        expect(onSetActive).toHaveBeenCalledTimes(2);
    });

    it('keeps the delete dialog exclusive and unlocks cycle actions after rejection', async () => {
        let rejectDelete!: (error: Error) => void;
        const onDelete = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectDelete = reject; }))
            .mockResolvedValue(undefined);
        const onDuplicate = vi.fn();
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<CycleCard cycle={cycle} isActive={false} routines={routines}
            onSetActive={vi.fn()} onDeactivate={vi.fn()} onEdit={vi.fn()}
            onDuplicate={onDuplicate} onDelete={onDelete} />);

        const menu = screen.getByRole('button', { name: 'Opzioni' });
        fireEvent.click(menu);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        fireEvent.click(menu);
        expect((screen.getByRole('menuitem', { name: 'Elimina' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('menuitem', { name: 'Duplica' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplica' }));
        expect(onDelete).toHaveBeenCalledOnce();
        expect(onDuplicate).not.toHaveBeenCalled();

        await act(async () => { rejectDelete(new Error('write failed')); });
        expect(log).toHaveBeenCalledOnce();
        expect((screen.getByRole('menuitem', { name: 'Elimina' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        expect(onDelete).toHaveBeenCalledTimes(2);
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
        expect(screen.getByRole('button', { name: /Anteprima della rotazione flessibile, parametri da correggere, chiusa/i })).toBeDefined();
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

describe('training planning derived-value safeguards', () => {
    it('rejects an overlong explicit end date consistently across timeline, schedule and suggestion', () => {
        const malformed: TrainingCycle = {
            ...cycle, startDate: '2026-01-01', endDate: '2030-01-01',
        };
        const original = structuredClone(malformed);

        const timeline = calculateCycleTimeline(malformed, '2026-06-01');
        expect(timeline).toMatchObject({
            totalWeeks: 0, currentWeek: 0, progressPercent: 0,
            isStarted: false, isEnded: false,
            statusLabel: 'Parametri del ciclo da correggere',
        });
        expect(timeline.formattedRange).toContain('non valido');
        expect(calculateCycleSchedule(malformed, routines)).toMatchObject({
            weeks: [], totalSessions: 0, summaryText: 'Parametri del ciclo da correggere',
        });
        expect(getNextScheduledRoutine(malformed, routines, [])).toBeNull();
        expect(malformed).toEqual(original);
    });

    it('ignores a finite but invalid calendar timestamp when selecting the last performed routine', () => {
        const planned: WorkoutRoutine[] = [
            { id: 'a', name: 'A', exercises: [] },
            { id: 'b', name: 'B', exercises: [] },
            { id: 'c', name: 'C', exercises: [] },
        ];
        const active: TrainingCycle = {
            ...cycle,
            routines: planned.map(item => ({ routineId: item.id, frequencyPerWeek: 1 })),
        };
        const history: WorkoutSession[] = [
            { id: 'old-a', cycleId: active.id, routineId: 'a', date: '2026-10-01', exercises: [] },
            { id: 'bad-b', cycleId: active.id, routineId: 'b', date: '2026-10-02',
                globalEndTime: 1e100, exercises: [] },
            { id: 'latest-c', cycleId: active.id, routineId: 'c', date: '2026-10-03', exercises: [] },
        ];

        expect(getNextScheduledRoutine(active, planned, history)?.nextRoutineId).toBe('a');
        const updated = [...history];
        updated[1] = {
            ...updated[1],
            globalStartTime: new Date('2026-10-04T10:00:00Z').getTime(),
        };
        expect(getNextScheduledRoutine(active, planned, updated)?.nextRoutineId).toBe('c');
        expect(history[1].globalEndTime).toBe(1e100);
    });

    it('rejects weekly set estimates above safe integer precision in both volume consumers', () => {
        const hugeRoutine: WorkoutRoutine[] = [{
            id: 'r', name: 'Scheda grande',
            exercises: [{ exId: 'bench', setsCount: Number.MAX_SAFE_INTEGER }],
        }];
        const highFrequency: TrainingCycle = {
            ...cycle, sessionsPerWeek: 14,
        };

        expect(calculateCycleVolume(highFrequency, hugeRoutine, library).muscleVolumes).toEqual([]);
        expect(calculateCycleVolume(highFrequency, hugeRoutine, library).totalSetsPerWeek).toBe(0);
        expect(calculateCycleMacroVolume(highFrequency, hugeRoutine, library)).toEqual([]);

        const twoExercises: WorkoutRoutine[] = [{
            ...hugeRoutine[0],
            exercises: [
                { exId: 'bench', setsCount: Number.MAX_SAFE_INTEGER },
                { exId: 'bench', setsCount: Number.MAX_SAFE_INTEGER },
            ],
        }];
        const oncePerWeek: TrainingCycle = { ...cycle, sessionsPerWeek: 1 };
        expect(calculateCycleVolume(oncePerWeek, twoExercises, library).muscleVolumes).toEqual([]);
        expect(calculateCycleMacroVolume(oncePerWeek, twoExercises, library)).toEqual([]);
    });

    it('preserves valid fractional estimates when routines share a weekly session', () => {
        const split: TrainingCycle = {
            ...cycle, sessionsPerWeek: 1,
            routines: [
                { routineId: 'a', frequencyPerWeek: 1 },
                { routineId: 'b', frequencyPerWeek: 1 },
            ],
        };
        const splitRoutines: WorkoutRoutine[] = [
            { id: 'a', name: 'A', exercises: [{ exId: 'bench', setsCount: 3 }] },
            { id: 'b', name: 'B', exercises: [{ exId: 'bench', setsCount: 3 }] },
        ];

        expect(calculateCycleVolume(split, splitRoutines, library).totalSetsPerWeek).toBe(3);
        expect(calculateCycleMacroVolume(split, splitRoutines, library)).toEqual([
            { key: 'chest', label: 'Petto', sets: 3 },
        ]);
    });
});

describe('large cycle volume rounding', () => {
    it.each([
        { setsCount: Number.MAX_SAFE_INTEGER, otherFrequency: 0, expected: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER },
        { setsCount: Number.MAX_SAFE_INTEGER, otherFrequency: 1, expected: 4503599627370495.5, total: 4503599627370496 },
        { setsCount: 1801439850948199, otherFrequency: 1, expected: 900719925474099.5, total: 900719925474100 },
        { setsCount: 5, otherFrequency: 3, expected: 1.3, total: 1 },
    ])('preserves the representable weekly estimate: %j', ({ setsCount, otherFrequency, expected, total }) => {
        const planned: TrainingCycle = {
            ...cycle, sessionsPerWeek: 1,
            routines: [
                { routineId: 'r', frequencyPerWeek: 1 },
                ...(otherFrequency ? [{ routineId: 'rest', frequencyPerWeek: otherFrequency }] : []),
            ],
        };
        const sourceRoutines: WorkoutRoutine[] = [
            { id: 'r', name: 'A', exercises: [{ exId: 'bench', setsCount }] },
            { id: 'rest', name: 'Riposo', exercises: [] },
        ];
        const original = structuredClone({ planned, sourceRoutines, library });

        const volume = calculateCycleVolume(planned, sourceRoutines, library);
        expect(volume.totalSetsPerWeek).toBe(total);
        expect(volume.muscleVolumes).toHaveLength(1);
        expect(volume.muscleVolumes[0].sets).toBe(expected);
        expect(calculateCycleMacroVolume(planned, sourceRoutines, library)).toEqual([
            { key: 'chest', label: 'Petto', sets: expected },
        ]);
        expect({ planned, sourceRoutines, library }).toEqual(original);
    });
});
