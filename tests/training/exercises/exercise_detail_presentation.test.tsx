import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ExerciseDetail } from '../../../src/components/Training/exercises/ExerciseDetail';
import type { Exercise } from '../../../src/types';

afterEach(cleanup);

const baseExercise: Exercise = {
    id: 'archive-exercise',
    name: 'Squat con bilanciere',
    trackingType: 'weight_reps',
    muscles: ['quads_right'],
    secondaryMuscles: ['glutes'],
    setsCount: 3,
    sets: [],
};

function showDetail(exercise: Exercise, routineCount = 1) {
    const onBack = vi.fn();
    const onEditItem = vi.fn();
    const onDuplicate = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    const view = render(<ExerciseDetail
        exercise={exercise} routineCount={routineCount} onBack={onBack}
        onEditItem={onEditItem} onDuplicate={onDuplicate} onDelete={onDelete}
    />);
    return { ...view, onBack, onEditItem, onDuplicate, onDelete };
}

describe('exercise detail presentation', () => {
    it('keeps the active exercise metadata and action payloads after extracting the detail', () => {
        const { onBack, onEditItem, onDuplicate } = showDetail(baseExercise);
        const detail = screen.getByRole('region', { name: 'Dettaglio esercizio' });
        expect(within(detail).getByText('1 scheda')).toBeDefined();
        expect(within(detail).getByText('Peso e ripetizioni')).toBeDefined();
        expect(within(detail).getByText('Nessuna nota.')).toBeDefined();

        fireEvent.click(within(detail).getByRole('button', { name: 'Modifica' }));
        expect(onEditItem).toHaveBeenCalledExactlyOnceWith(baseExercise);
        fireEvent.click(within(detail).getByRole('button', { name: 'Duplica' }));
        expect(onDuplicate).toHaveBeenCalledExactlyOnceWith(baseExercise);
        fireEvent.click(within(detail).getByRole('button', { name: 'Torna all’elenco' }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('does not expose delete for catalog items and updates usage after a routines change', () => {
        const catalogExercise = { ...baseExercise, isDefault: true, trackingType: 'time' as const };
        const view = showDetail(catalogExercise, 2);
        expect(screen.getByText('2 schede')).toBeDefined();
        expect(screen.getByText('Tempo')).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();

        view.rerender(<ExerciseDetail exercise={catalogExercise} routineCount={0}
            onBack={view.onBack} onEditItem={view.onEditItem}
            onDuplicate={view.onDuplicate} onDelete={view.onDelete} />);
        expect(screen.getByText('0 schede')).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();
        expect(view.onDelete).not.toHaveBeenCalled();
    });
});
