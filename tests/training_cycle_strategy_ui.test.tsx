import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import { CycleStrategySummary } from '../src/components/Training/planning/CycleStrategySummary';
import { useDialogStore } from '../src/store/useDialogStore';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

const routines: WorkoutRoutine[] = [{
    id: 'routine-1',
    name: 'Scheda A',
    exercises: [],
}];

function fillBaseCycle() {
    fireEvent.change(screen.getByLabelText('Nome ciclo'), { target: { value: 'Ciclo strategia' } });
    fireEvent.change(
        screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' }),
        { target: { value: 'routine-1' } },
    );
}

describe('training cycle strategy UI', () => {
    it('requires an explicit intent for a new cycle and a focus for development', async () => {
        const showAlert = useDialogStore.getState().showAlert as ReturnType<typeof vi.fn>;
        showAlert.mockClear();
        const onSave = vi.fn();
        const { container } = render(
            <CycleEditor routines={routines} onSave={onSave} onCancel={vi.fn()} />
        );

        fillBaseCycle();
        fireEvent.submit(container.querySelector('form')!);
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith("Seleziona l'obiettivo del ciclo."));
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Sviluppo' }));
        fireEvent.submit(container.querySelector('form')!);
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Seleziona cosa vuoi far progredire principalmente.'));
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
        fireEvent.submit(container.querySelector('form')!);
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].strategy).toEqual({
            intent: 'development',
            progressionFocus: 'volume',
        });
    });

    it('creates a development/performance cycle with primary and secondary muscle priorities', async () => {
        const onSave = vi.fn();
        const { container } = render(
            <CycleEditor routines={routines} onSave={onSave} onCancel={vi.fn()} />
        );

        fillBaseCycle();
        fireEvent.click(screen.getByRole('button', { name: 'Sviluppo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Performance' }));
        fireEvent.change(
            screen.getByRole('combobox', { name: 'Aggiungi focus primario' }),
            { target: { value: 'quads' } },
        );
        fireEvent.change(
            screen.getByRole('combobox', { name: 'Aggiungi focus secondario' }),
            { target: { value: 'triceps' } },
        );
        fireEvent.submit(container.querySelector('form')!);

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].strategy).toEqual({
            intent: 'development',
            progressionFocus: 'performance',
            primaryMuscles: ['quads'],
            secondaryMuscles: ['triceps'],
        });
        expect(screen.getByRole('group', { name: 'Intento del ciclo' })).toBeDefined();
        expect(screen.getByRole('group', { name: 'Focus principale della progressione' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Rimuovi Quadricipiti dal focus primario/i })).toBeDefined();
    });

    it('changes an existing development cycle from performance to volume', async () => {
        const onSave = vi.fn();
        const initialCycle: TrainingCycle = {
            id: 'cycle-edit',
            name: 'Ciclo edit',
            durationWeeks: 6,
            routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }],
            strategy: { intent: 'development', progressionFocus: 'performance' },
        };
        const { container } = render(
            <CycleEditor initialCycle={initialCycle} routines={routines} onSave={onSave} onCancel={vi.fn()} />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
        fireEvent.submit(container.querySelector('form')!);

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].strategy).toEqual({
            intent: 'development',
            progressionFocus: 'volume',
        });
    });
    it.each([
        ['Mantenimento', 'maintenance'],
        ['Deload', 'deload'],
    ] as const)('creates %s without requiring a progression focus or priorities', async (label, intent) => {
        const onSave = vi.fn();
        const { container } = render(
            <CycleEditor routines={routines} onSave={onSave} onCancel={vi.fn()} />
        );

        fillBaseCycle();
        fireEvent.click(screen.getByRole('button', { name: label }));
        fireEvent.submit(container.querySelector('form')!);

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].strategy).toEqual({ intent });
    });

    it('keeps a legacy cycle without strategy editable and labels it as unspecified', async () => {
        const onSave = vi.fn();
        const legacyCycle: TrainingCycle = {
            id: 'legacy',
            name: 'Legacy',
            durationWeeks: 4,
            routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }],
        };
        const { container } = render(
            <>
                <CycleStrategySummary strategy={legacyCycle.strategy} />
                <CycleEditor initialCycle={legacyCycle} routines={routines} onSave={onSave} onCancel={vi.fn()} />
            </>
        );

        expect(screen.getByText('Obiettivo non specificato')).toBeDefined();
        fireEvent.submit(container.querySelector('form')!);
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].strategy).toBeUndefined();
    });
    it('explains historical behavior and applies a semantic change only to future session snapshots', async () => {
        const onSave = vi.fn();
        const usedCycle: TrainingCycle = {
            id: 'used-cycle',
            name: 'Ciclo usato',
            durationWeeks: 6,
            routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }],
            strategy: { intent: 'development', progressionFocus: 'performance' },
        };
        const { container } = render(
            <CycleEditor
                initialCycle={usedCycle}
                routines={routines}
                hasRecordedSessions
                onSave={onSave}
                onCancel={vi.fn()}
            />
        );

        expect(screen.getByRole('note').textContent).toMatch(/sessioni future/i);
        fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
        fireEvent.submit(container.querySelector('form')!);

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].strategy?.progressionFocus).toBe('volume');
    });

    it('renders structured strategy context in a concise summary', () => {
        render(
            <CycleStrategySummary strategy={{
                intent: 'development',
                progressionFocus: 'volume',
                primaryMuscles: ['quads'],
                secondaryMuscles: ['triceps'],
            }} />
        );

        expect(screen.getByText('Sviluppo · Focus volume')).toBeDefined();
        expect(screen.getByText(/Primario:/).parentElement?.textContent).toContain('Quadricipiti');
        expect(screen.getByText(/Secondario:/).parentElement?.textContent).toContain('Tricipiti');
    });
});
