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

    it('keeps per-set techniques inside the Tecnica panel and removes retired controls', () => {
        renderItem();

        const summary = screen.getByText('Tecnica').closest('summary');
        const details = summary?.parentElement;
        expect(details?.textContent).toContain('Tecnica per serie:');
        expect(details?.textContent).toContain('Esecuzione da mantenere');
        expect(details?.textContent).toContain('Ruolo nella scheda');
        expect(details?.textContent).toContain('Cosa vuoi migliorare');
        expect(details?.textContent).not.toContain('Contesto');
        expect(details?.textContent).not.toContain('Target');
        expect(details?.textContent).not.toContain('Regola di successo');
        expect(details?.textContent).not.toContain('Regola di cambio');
        expect(details?.textContent).not.toContain('Prossima azione');
        expect(details?.textContent).not.toContain('Riferimento storico (avanzato)');

        fireEvent.click(screen.getByText('Tecnica'));
        expect(screen.getByLabelText('Tecnica serie 1')).toBeTruthy();
    });
});
