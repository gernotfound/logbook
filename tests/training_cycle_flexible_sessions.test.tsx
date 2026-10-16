import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrainingSessionSetup } from '../src/components/Training/TrainingSessionSetup';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { useAppStore } from '../src/store/useAppStore';
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

function setup(historyCount: number, currentCycle = cycle) {
    const history = Array.from({ length: historyCount }, (_, index) =>
        ({ id: `completed-${index}`, cycleId: currentCycle.id }) as WorkoutSession
    );
    useAppStore.setState({
        userData: {
            library: [], routines, history,
            trainingCycles: [currentCycle], activeCycleId: currentCycle.id,
        } as UserData,
    });
    vi.mocked(useWorkoutSession).mockReturnValue({
        routines, history, startWorkout, startFreeWorkout,
    } as unknown as ReturnType<typeof useWorkoutSession>);
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

describe('flexible training cycles', () => {
    it('permits choosing any planned routine after only one of four suggested weekly sessions', () => {
        setup(1);
        render(<TrainingSessionSetup />);
        expect(screen.getByText('Scheda suggerita · Rotazione flessibile')).toBeDefined();
        expect(screen.getByText(/Seduta 2 di 8/)).toBeDefined();
        fireEvent.change(screen.getByRole('combobox', { name: 'Seleziona scheda della rotazione' }), {
            target: { value: 'second' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Avvia Scheda B' }));
        expect(startWorkout).toHaveBeenCalledWith('second', {
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
