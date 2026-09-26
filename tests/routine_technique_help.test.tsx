import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.unmock('../src/store/useDialogStore');

import { RoutineExerciseItem } from '../src/components/Training/routines/RoutineExerciseItem';
import { useDialogStore } from '../src/store/useDialogStore';

const noop = vi.fn();

function renderItem() {
    render(
        <RoutineExerciseItem
            exercise={{ exId: 'bench', setsCount: 1 }}
            index={0}
            totalExercises={1}
            libDef={{
                id: 'bench',
                name: 'Panca test',
                setsCount: 1,
                sets: [],
                trackingType: 'weight_reps',
            }}
            onMove={noop}
            onRemove={noop}
            onUpdateSetsCount={noop}
            onUpdateReps={noop}
            onUpdateSetPlan={noop}
            onUpdateSetPlanField={noop}
            onUpdateExerciseMetadata={noop}
        />,
    );
}

afterEach(() => {
    if (useDialogStore.getState().isOpen) useDialogStore.getState().onConfirm();
    vi.clearAllMocks();
});

describe('routine technique help', () => {
    it('opens contextual help from the question-mark control beside a technical field', () => {
        renderItem();

        fireEvent.click(screen.getByText('Tecnica'));
        fireEvent.click(screen.getByRole('button', { name: 'Spiega: Esecuzione da mantenere' }));

        const dialog = useDialogStore.getState();
        expect(dialog.isOpen).toBe(true);
        expect(dialog.title).toBe('Esecuzione da mantenere');
        expect(dialog.message).toContain('ROM');
        expect(dialog.message).toContain('confrontare le prestazioni');
    });

    it('explains that descriptive progression rules are not automatic actions', () => {
        renderItem();

        fireEvent.click(screen.getByText('Tecnica'));
        fireEvent.click(screen.getByRole('button', { name: 'Spiega: Regola di successo' }));

        const dialog = useDialogStore.getState();
        expect(dialog.title).toBe('Regola di successo');
        expect(dialog.message).toContain('non la esegue automaticamente');
    });
});
