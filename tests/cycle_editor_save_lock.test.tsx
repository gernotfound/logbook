import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import { useDialogStore } from '../src/store/useDialogStore';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

const routines: WorkoutRoutine[] = [
    { id: 'push', name: 'Spinta', exercises: [] },
    { id: 'pull', name: 'Trazione', exercises: [] },
];

const initialCycle: TrainingCycle = {
    id: 'cycle-save',
    name: 'Ciclo di prova',
    startDate: '2026-11-01',
    endDate: '2026-11-28',
    durationWeeks: 4,
    sessionsPerWeek: 2,
    routines: [{ routineId: 'push', frequencyPerWeek: 1 }],
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('CycleEditor durable save boundaries', () => {
    it('prevents late edits, cancellation and repeated submissions while persistence is pending', async () => {
        let completeSave!: () => void;
        const onSave = vi.fn((_cycle: TrainingCycle) => new Promise<void>(resolve => { completeSave = resolve; }));
        const onCancel = vi.fn();
        const { container } = render(
            <CycleEditor initialCycle={initialCycle} routines={routines} onSave={onSave} onCancel={onCancel} />,
        );
        const form = container.querySelector<HTMLFormElement>('#cycle-editor-form')!;
        const nameInput = container.querySelector<HTMLInputElement>('#cycle-name')!;
        const close = container.querySelector<HTMLButtonElement>('.planning-close-button')!;
        const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

        fireEvent.change(nameInput, { target: { value: 'Nome già inviato' } });
        fireEvent.submit(form);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0]?.[0]?.name).toBe('Nome già inviato');
        expect(form.hasAttribute('inert')).toBe(true);
        expect(form.getAttribute('aria-busy')).toBe('true');
        expect(close.disabled).toBe(true);
        expect(submit.disabled).toBe(true);
        expect(submit.textContent).toBe('Salvataggio in corso…');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('Salvataggio del ciclo');

        fireEvent.submit(form);
        fireEvent.click(close);
        fireEvent.click(form.querySelector<HTMLButtonElement>('.planning-editor-actions button[type="button"]')!);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();

        await act(async () => { completeSave(); });
        expect(form.hasAttribute('inert')).toBe(false);
        expect(form.getAttribute('aria-busy')).toBe('false');
        expect(close.disabled).toBe(false);
        expect(submit.disabled).toBe(false);
        expect(submit.textContent).toBe('Salva modifiche');
        expect(nameInput.value).toBe('Nome già inviato');
    });

    it('unlocks a failed save, reports the error and preserves edits for retry', async () => {
        let rejectSave!: (error: Error) => void;
        const onSave = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }))
            .mockResolvedValue(undefined);
        const alert = vi.fn().mockResolvedValue(undefined);
        const priorAlert = useDialogStore.getState().showAlert;
        useDialogStore.setState({ showAlert: alert });
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const { container } = render(
                <CycleEditor initialCycle={initialCycle} routines={routines} onSave={onSave} onCancel={vi.fn()} />,
            );
            const form = container.querySelector<HTMLFormElement>('#cycle-editor-form')!;
            const nameInput = container.querySelector<HTMLInputElement>('#cycle-name')!;
            fireEvent.change(nameInput, { target: { value: 'Modifiche da conservare' } });
            fireEvent.submit(form);
            expect(form.hasAttribute('inert')).toBe(true);

            await act(async () => { rejectSave(new Error('write not durable')); });
            expect(log).toHaveBeenCalledOnce();
            expect(alert).toHaveBeenCalledWith(expect.stringContaining('Salvataggio del ciclo non riuscito'));
            expect(form.hasAttribute('inert')).toBe(false);
            expect(nameInput.value).toBe('Modifiche da conservare');

            fireEvent.submit(form);
            await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
            expect(onSave.mock.calls[1]?.[0]?.name).toBe('Modifiche da conservare');
        } finally {
            useDialogStore.setState({ showAlert: priorAlert });
        }
    });
});
