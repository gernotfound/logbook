import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HistoryWorkoutCard } from '../../../src/components/Training/history/HistoryWorkoutCard';
import type { WorkoutSession } from '../../../src/types';

const workout: WorkoutSession = {
    id: 'history-row',
    date: '2026-11-20',
    routineName: 'Forza',
    exercises: [{
        exId: 'bench',
        sessionNote: '',
        sets: [{ id: 'first', kg: '40', reps: '8' }],
    }],
    manualDurationStr: '00:35:00',
};

afterEach(() => {
    cleanup();
});

describe('history workout card actions', () => {
    it('keeps the entire row openable and hides edit when the caller cannot edit', () => {
        const onOpen = vi.fn();
        const onDelete = vi.fn();
        render(<HistoryWorkoutCard workout={workout} onOpen={onOpen} onDeleteWorkout={onDelete} />);

        const details = screen.getByRole('button', { name: 'Apri il dettaglio di Forza' });
        expect(details.textContent).toContain('35 min');
        expect(details.textContent).toContain('1 esercizio');
        fireEvent.click(details);
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(workout);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        expect(screen.queryByRole('menuitem', { name: 'Modifica allenamento' })).toBeNull();
        expect(screen.getByRole('menuitem', { name: 'Elimina allenamento' })).toBeDefined();
    });

    it('keeps report, edit and delete bound to the selected workout', () => {
        const onOpen = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        render(<HistoryWorkoutCard workout={workout} onOpen={onOpen} onEditWorkout={onEdit} onDeleteWorkout={onDelete} />);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Vedi report' }));
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(workout);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica allenamento' }));
        expect(onEdit).toHaveBeenCalledExactlyOnceWith(workout);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        expect(onDelete).toHaveBeenCalledExactlyOnceWith('history-row');
    });

    it('does not expose deletion without a valid workout ID', () => {
        render(<HistoryWorkoutCard workout={{ ...workout, id: undefined, globalStartTime: Number.MAX_VALUE }}
            onOpen={vi.fn()} onDeleteWorkout={vi.fn()} />);
        expect(screen.getByText(/Orario n\.d\./)).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        expect(screen.queryByRole('menuitem', { name: 'Elimina allenamento' })).toBeNull();
    });
});
