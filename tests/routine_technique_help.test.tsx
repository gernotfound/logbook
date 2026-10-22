import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.unmock('../src/store/useDialogStore');

import { RoutineExerciseItem } from '../src/components/Training/routines/RoutineExerciseItem';
import { useDialogStore } from '../src/store/useDialogStore';
import type { RoutineExercise } from '../src/types';

const noop = vi.fn();

function renderItem(exercise: RoutineExercise = { exId: 'bench', setsCount: 1 }) {
    return render(
        <RoutineExerciseItem
            exercise={exercise}
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

        fireEvent.click(screen.getByText('Tecnica e progressione'));
        fireEvent.click(screen.getByRole('button', { name: 'Spiega: Esecuzione da mantenere' }));

        const dialog = useDialogStore.getState();
        expect(dialog.isOpen).toBe(true);
        expect(dialog.title).toBe('Esecuzione da mantenere');
        expect(dialog.message).toContain('ROM');
        expect(dialog.message).toContain('confrontare le prestazioni');
    });

    it('routes form edits through typed callbacks without transforming the stored routine fields', () => {
        render(
            <RoutineExerciseItem
                exercise={{
                    exId: 'bench', setsCount: '4', minReps: 6, maxReps: 10,
                    technicalStandard: 'Fermo 1 s',
                    progressionContract: { role: 'primary', metric: 'performance' },
                    setPlans: [{ technique: 'cluster', segmentCount: 3, restSeconds: 20 }],
                }}
                index={2}
                totalExercises={4}
                onMove={noop}
                onRemove={noop}
                onUpdateSetsCount={noop}
                onUpdateReps={noop}
                onUpdateSetPlan={noop}
                onUpdateSetPlanField={noop}
                onUpdateExerciseMetadata={noop}
            />,
        );

        expect((screen.getByLabelText('Serie:') as HTMLInputElement).value).toBe('4');
        expect((screen.getByLabelText('Ripetizioni minime') as HTMLInputElement).value).toBe('6');
        expect((screen.getByLabelText('Ripetizioni massime') as HTMLInputElement).value).toBe('10');
        fireEvent.change(screen.getByLabelText('Serie:'), { target: { value: '5' } });
        expect(noop).toHaveBeenCalledWith(2, '5');

        fireEvent.click(screen.getByText('Tecnica e progressione'));
        expect((screen.getByLabelText('Tecnica serie 1') as HTMLSelectElement).value).toBe('cluster');
        expect((screen.getByLabelText('Segmenti serie 1') as HTMLInputElement).value).toBe('3');
        fireEvent.change(screen.getByLabelText('Segmenti serie 1'), { target: { value: '4' } });
        expect(noop).toHaveBeenCalledWith(2, 0, 'segmentCount', '4');
        fireEvent.change(screen.getByLabelText('Esecuzione da mantenere'), { target: { value: 'ROM pieno' } });
        expect(noop).toHaveBeenCalledWith(2, 'technicalStandard', 'ROM pieno');
    });

    it('keeps per-set techniques inside the Tecnica panel and lays multiple techniques out as ordered cards', () => {
        const view = renderItem({
            exId: 'bench',
            setsCount: 5,
            setPlans: [
                { technique: 'dropset' },
                { technique: 'rest_pause', restSeconds: 20 },
                { technique: 'cluster', restSeconds: 15, segmentCount: 3 },
                { technique: 'rep_match', restSeconds: 20, target: { type: 'reps', reps: 10 } },
                { technique: 'diminishing', restSeconds: 20, target: { type: 'reps', reps: 8 } },
            ],
        });

        const summary = screen.getByText('Tecnica e progressione').closest('summary');
        const details = summary?.parentElement;
        expect(details?.textContent).not.toContain('Tecnica per serie:');
        expect(details?.textContent).toContain('Esecuzione da mantenere');
        expect(details?.textContent).toContain('Ruolo nella scheda');
        expect(details?.textContent).toContain('Cosa vuoi migliorare');
        expect(screen.queryByRole('button', { name: 'Spiega: Tecnica per serie' })).toBeNull();
        expect(details?.textContent).not.toContain('Contesto');
        expect(details?.textContent).not.toContain('Regola di successo');
        expect(details?.textContent).not.toContain('Regola di cambio');
        expect(details?.textContent).not.toContain('Prossima azione');
        expect(details?.textContent).not.toContain('Riferimento storico (avanzato)');

        fireEvent.click(screen.getByText('Tecnica e progressione'));
        expect(view.container.querySelectorAll('.routine-technique-set')).toHaveLength(5);
        expect(screen.getByLabelText('Tecnica serie 5')).toBeTruthy();
        expect(screen.getByLabelText('Recupero serie 2')).toBeTruthy();
        expect(screen.getByLabelText('Segmenti serie 3')).toBeTruthy();
        expect(screen.getByLabelText('Target ripetizioni serie 4')).toBeTruthy();
    });
});
