import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrainingSessionSetup } from '../src/components/Training/TrainingSessionSetup';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { useAppStore } from '../src/store/useAppStore';
import { getNextScheduledRoutine } from '../src/lib/calc/planning';
import type { TrainingCycle, UserData, WorkoutRoutine, WorkoutSession } from '../src/types';

vi.mock('../src/hooks/useWorkoutSession', () => ({ useWorkoutSession: vi.fn() }));

const routines: WorkoutRoutine[] = [
    { id: 'first', name: 'Scheda A', exercises: [] },
    { id: 'second', name: 'Scheda B', exercises: [] },
];

const cycle: TrainingCycle = {
    id: 'flexible-cycle', name: 'Ciclo flessibile', durationWeeks: 2, sessionsPerWeek: 4,
    routines: [{ routineId: 'first', frequencyPerWeek: 2 }, { routineId: 'second', frequencyPerWeek: 2 }],
};

const startWorkout = vi.fn();
const startFreeWorkout = vi.fn();

function setup(
    historyCount: number,
    currentCycle = cycle,
    currentRoutines = routines,
    storedHistory?: WorkoutSession[],
) {
    const history = storedHistory ?? Array.from({ length: historyCount }, (_, index) =>
        ({ id: `completed-${index}`, cycleId: currentCycle.id }) as WorkoutSession
    );
    useAppStore.setState({
        userData: {
            library: [], routines: currentRoutines, history,
            trainingCycles: [currentCycle], activeCycleId: currentCycle.id,
        } as UserData,
    });
    vi.mocked(useWorkoutSession).mockReturnValue({
        routines: currentRoutines, history, startWorkout, startFreeWorkout,
    } as unknown as ReturnType<typeof useWorkoutSession>);
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

describe('flexible training cycles', () => {
    it('suggests the successor of the last performed routine, with no weekly reset or forced sequence', () => {
        const fourRoutines: WorkoutRoutine[] = [
            ...routines,
            { id: 'third', name: 'Scheda C', exercises: [] },
            { id: 'fourth', name: 'Scheda D', exercises: [] },
        ];
        const fourCycle: TrainingCycle = {
            ...cycle, routines: fourRoutines.map(routine => ({ routineId: routine.id, frequencyPerWeek: 1 })),
        };
        const completed = (routineId: string, date: string, id = routineId): WorkoutSession => ({
            id, cycleId: fourCycle.id, routineId, date, exercises: [],
        });
        const weekOneAC = [
            completed('first', '2026-10-01'),
            completed('third', '2026-10-02'),
        ];
        expect(getNextScheduledRoutine(fourCycle, fourRoutines, weekOneAC)?.nextRoutineId).toBe('fourth');

        // A B on one week -> C D A B on the next, with no compulsory recovery.
        const firstWeekAB = [
            completed('first', '2026-10-01'),
            completed('second', '2026-10-02'),
        ];
        const weekTwo: WorkoutSession[] = [...firstWeekAB];
        for (const [index, routineId] of ['third', 'fourth', 'first', 'second'].entries()) {
            expect(getNextScheduledRoutine(fourCycle, fourRoutines, weekTwo)?.nextRoutineId).toBe(routineId);
            weekTwo.push(completed(routineId, `2026-10-${String(index + 8).padStart(2, '0')}`, `week2-${index}`));
        }
        // A C B D also finishes the four available choices with no prescribed order.
        const reorderedWeek = [
            completed('first', '2026-10-01'),
            completed('third', '2026-10-02'),
            completed('second', '2026-10-03'),
            completed('fourth', '2026-10-04'),
        ];
        expect(getNextScheduledRoutine(fourCycle, fourRoutines, reorderedWeek)?.nextRoutineId).toBe('first');
        expect(getNextScheduledRoutine(fourCycle, fourRoutines, reorderedWeek)?.completedCount).toBe(4);

        // Even with D suggested after A C, manually choosing A must remain possible.
        setup(0, fourCycle, fourRoutines, weekOneAC);
        render(<TrainingSessionSetup />);
        expect(screen.getByRole('heading', { name: 'Scheda D' })).toBeDefined();
        fireEvent.change(screen.getByRole('combobox', { name: 'Seleziona scheda della rotazione' }), {
            target: { value: 'first' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Avvia Scheda A' }));
        expect(startWorkout).toHaveBeenCalledWith('first', {
            cycleId: fourCycle.id, cycleName: fourCycle.name,
        });
        const afterRestartA = [...weekOneAC, completed('first', '2026-10-08', 'restart-a')];
        expect(getNextScheduledRoutine(fourCycle, fourRoutines, afterRestartA)?.nextRoutineId).toBe('second');

        // The history array itself need not be in chronological order.
        const unsorted = [completed('third', '2026-10-12'), completed('first', '2026-10-10')];
        expect(getNextScheduledRoutine(fourCycle, fourRoutines, unsorted)?.nextRoutineId).toBe('fourth');
        expect(getNextScheduledRoutine(fourCycle, fourRoutines, [
            completed('first', '2026-10-10', 'legacy-first'),
            { id: 'unrelated-cycle', routineId: 'fourth', cycleId: 'other', date: '2026-10-15', exercises: [] },
        ])?.nextRoutineId).toBe('second');
    });

    it('permits choosing any planned routine after only one of four suggested weekly sessions', () => {
        setup(1);
        render(<TrainingSessionSetup />);
        expect(screen.getByText('Scheda suggerita · Rotazione flessibile')).toBeDefined();
        expect(screen.getByText(/Seduta 2 di 8/)).toBeDefined();
        fireEvent.change(screen.getByRole('combobox', { name: 'Seleziona scheda della rotazione' }), {
            target: { value: 'first' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Avvia Scheda A' }));
        expect(startWorkout).toHaveBeenCalledWith('first', {
            cycleId: cycle.id, cycleName: cycle.name,
        });
    });

    it('shows an invalid-date warning but still allows a manual in-cycle workout', () => {
        setup(0, { ...cycle, startDate: 'not-a-date' });
        render(<TrainingSessionSetup />);
        expect(screen.getByText('Parametri del ciclo da correggere')).toBeDefined();
        expect(screen.queryByText('Scheda suggerita · Rotazione flessibile')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Avvia Scheda A' }));
        expect(startWorkout).toHaveBeenCalledWith('first', {
            cycleId: cycle.id, cycleName: cycle.name,
        });
    });

    it('stops suggesting session 9 of 8 but still starts an optional routine within the cycle', () => {
        setup(8);
        render(<TrainingSessionSetup />);
        expect(screen.getByText('Obiettivo indicativo raggiunto')).toBeDefined();
        expect(screen.queryByText(/Seduta 9 di 8/)).toBeNull();
        expect(screen.getByText(/Puoi continuare ad allenarti/)).toBeDefined();
        fireEvent.change(screen.getByRole('combobox', { name: 'Seleziona scheda del ciclo' }), {
            target: { value: 'second' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Avvia Scheda B' }));
        expect(startWorkout).toHaveBeenCalledWith('second', {
            cycleId: cycle.id, cycleName: cycle.name,
        });
        expect(screen.getByRole('button', { name: 'Allenamento libero' })).toBeDefined();
    });

    it('ends automatic suggestions when the calendar period ends, even after only one optional session', () => {
        setup(1, { ...cycle, startDate: '2020-01-01' });
        render(<TrainingSessionSetup />);
        expect(screen.getByText('Periodo del ciclo concluso')).toBeDefined();
        expect(screen.queryByText('Scheda suggerita · Rotazione flessibile')).toBeNull();
        expect(screen.queryByText(/Seduta 2 di 8/)).toBeNull();
        fireEvent.change(screen.getByRole('combobox', { name: 'Seleziona scheda del ciclo' }), {
            target: { value: 'second' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Avvia Scheda B' }));
        expect(startWorkout).toHaveBeenCalledWith('second', {
            cycleId: cycle.id, cycleName: cycle.name,
        });
    });

    it('labels timeline progress as elapsed time rather than completed training sessions', () => {
        setup(1, { ...cycle, startDate: '2020-01-01' });
        render(<TrainingPlanning />);
        expect(screen.getByText('Periodo concluso')).toBeDefined();
        expect(screen.getByText('100% del periodo trascorso')).toBeDefined();
        expect(screen.getByRole('progressbar', { name: 'Avanzamento del periodo del ciclo' })).toBeDefined();
        expect(screen.queryByText('100% completato')).toBeNull();
        expect(screen.queryByText('Scheda suggerita nella rotazione')).toBeNull();
    });

    it('skips deleted routines in suggestions without removing their stored cycle references', () => {
        const withMissing = {
            ...cycle, routines: [
                { routineId: 'deleted', frequencyPerWeek: 1 },
                { routineId: 'first', frequencyPerWeek: 1 },
                { routineId: 'second', frequencyPerWeek: 1 },
            ],
        };
        const first = getNextScheduledRoutine(withMissing, routines, []);
        expect(first?.nextRoutineId).toBe('first');
        expect(first?.totalSessions).toBe(8);
        expect(first?.totalRoutinesInCycle).toBe(2);
        const afterFirst = getNextScheduledRoutine(withMissing, routines, [
            { id: 'w1', cycleId: withMissing.id } as WorkoutSession,
        ]);
        expect(afterFirst?.nextRoutineId).toBe('second');
        expect(withMissing.routines[0]?.routineId).toBe('deleted');

        setup(0, withMissing);
        render(<TrainingSessionSetup />);
        expect(screen.getByRole('heading', { name: 'Scheda A' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Avvia Scheda A/ })).toBeDefined();
    });

    it('reports the absence of any usable cycle routine while preserving archive access', () => {
        setup(0, { ...cycle, routines: [{ routineId: 'deleted', frequencyPerWeek: 1 }] });
        render(<TrainingSessionSetup />);
        expect(screen.getByText(/non contiene schede disponibili/)).toBeDefined();
        expect(screen.getByText('Scheda A').closest('button')).not.toBeNull();
    });

    it('marks deleted cycle routines as unavailable in planning without erasing the saved cycle', () => {
        setup(0, { ...cycle, routines: [
            { routineId: 'deleted', frequencyPerWeek: 1 }, { routineId: 'first', frequencyPerWeek: 1 },
        ] });
        render(<TrainingPlanning />);
        expect(screen.getByText(/scheda del ciclo non è più disponibile/)).toBeDefined();
        expect(screen.getByText('Scheda non disponibile')).toBeDefined();
        expect(useAppStore.getState().userData?.trainingCycles?.[0]?.routines[0]?.routineId).toBe('deleted');
    });

    it('does not display Infinity or misleading zero as the planned total for invalid historical cycles', () => {
        setup(0, { ...cycle, sessionsPerWeek: Number.POSITIVE_INFINITY });
        render(<TrainingPlanning />);
        expect(screen.getByText('—')).toBeDefined();
        expect(screen.getByText(/Parametri del ciclo da correggere: le sedute previste/)).toBeDefined();
        expect(screen.queryByText('Infinity')).toBeNull();
    });

    it('keeps an optional finite target without requiring all sessions to be performed', () => {
        setup(1);
        render(<TrainingPlanning />);
        expect(screen.getByText('8')).toBeDefined();
        expect(screen.getByText('Sedute previste')).toBeDefined();
        expect(screen.getByText('Sedute / sett. (stima)')).toBeDefined();
    });
});
