import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CycleEditor } from '../../src/components/Training/planning/CycleEditor';
import { CycleStrategyFields } from '../../src/components/Training/planning/CycleStrategyFields';
import type { TrainingCycle, WorkoutRoutine } from '../../src/types';

const routines: WorkoutRoutine[] = [{ id: 'routine-1', name: 'Scheda A', exercises: [] }];

const strategyProps = {
    intent: '' as const,
    progressionFocus: '' as const,
    primaryMuscles: [] as string[],
    secondaryMuscles: [] as string[],
    onIntentChange: vi.fn(),
    onProgressionFocusChange: vi.fn(),
    onAddMuscle: vi.fn(),
    onRemoveMuscle: vi.fn(),
};

describe('CycleStrategyFields muscle search keyboard and focus', () => {
    it('selects the filtered muscle with arrows and Enter without submitting the parent cycle form', () => {
        const onSave = vi.fn();
        render(<CycleEditor routines={routines} onSave={onSave} onCancel={vi.fn()} />);
        const search = screen.getByRole('combobox', { name: 'Cerca focus primario' }) as HTMLInputElement;

        act(() => search.focus());
        fireEvent.change(search, { target: { value: 'polpaccio destro' } });
        expect(search.getAttribute('aria-expanded')).toBe('true');
        expect(search.getAttribute('aria-activedescendant')).toBeNull();

        expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false);
        const active = screen.getByRole('option', { name: 'Polpaccio destro' });
        expect(active.getAttribute('aria-selected')).toBe('true');
        expect(active.getAttribute('tabindex')).toBe('-1');
        expect(search.getAttribute('aria-activedescendant')).toBe(active.id);
        expect(document.activeElement).toBe(search);

        expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
        expect(screen.getByRole('button', { name: 'Rimuovi Polpaccio destro dal focus primario' })).toBeDefined();
        expect(search.value).toBe('');
        expect(search.getAttribute('aria-expanded')).toBe('false');
        expect(search.getAttribute('aria-controls')).toBeNull();
        expect(search.getAttribute('aria-activedescendant')).toBeNull();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('wraps both arrow directions, closes on Escape, and prevents Enter submitting even without an active option', () => {
        render(<CycleStrategyFields {...strategyProps} />);
        const search = screen.getByRole('combobox', { name: 'Cerca focus primario' });
        act(() => (search as HTMLInputElement).focus());
        fireEvent.change(search, { target: { value: 'abduttore' } });

        fireEvent.keyDown(search, { key: 'ArrowUp' });
        const lastOption = screen.getAllByRole('option').at(-1)!;
        expect(lastOption.getAttribute('aria-selected')).toBe('true');

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        const firstOption = screen.getAllByRole('option')[0];
        expect(firstOption.getAttribute('aria-selected')).toBe('true');
        expect(search.getAttribute('aria-activedescendant')).toBe(firstOption.id);

        fireEvent.keyDown(search, { key: 'Escape' });
        expect(search.getAttribute('aria-expanded')).toBe('false');
        expect(search.getAttribute('aria-activedescendant')).toBeNull();
        expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
        expect(strategyProps.onAddMuscle).not.toHaveBeenCalled();

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(search.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    });

    it('moves a muscle from primary to secondary and saves only the final priority', async () => {
        const onSave = vi.fn((_cycle: TrainingCycle) => {});
        const { container } = render(<CycleEditor routines={routines} onSave={onSave} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Nome ciclo'), { target: { value: 'Ciclo' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' }), { target: { value: 'routine-1' } });

        const primary = screen.getByRole('combobox', { name: 'Cerca focus primario' });
        fireEvent.change(primary, { target: { value: 'polpaccio destro' } });
        fireEvent.keyDown(primary, { key: 'ArrowDown' });
        fireEvent.keyDown(primary, { key: 'Enter' });
        expect(screen.getByRole('button', { name: 'Rimuovi Polpaccio destro dal focus primario' })).toBeDefined();

        const secondary = screen.getByRole('combobox', { name: 'Cerca focus secondario' });
        fireEvent.change(secondary, { target: { value: 'polpaccio destro' } });
        fireEvent.keyDown(secondary, { key: 'ArrowDown' });
        fireEvent.keyDown(secondary, { key: 'Enter' });
        expect(screen.queryByRole('button', { name: 'Rimuovi Polpaccio destro dal focus primario' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Rimuovi Polpaccio destro dal focus secondario' })).toBeDefined();

        fireEvent.submit(container.querySelector('form')!);
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
        expect(onSave.mock.calls[0][0].strategy).toEqual({ secondaryMuscles: ['calves_right'] });
    });

    it('does not select an option removed by a parent update', () => {
        const onAddMuscle = vi.fn();
        const { rerender } = render(<CycleStrategyFields {...strategyProps} onAddMuscle={onAddMuscle} />);
        const search = screen.getByRole('combobox', { name: 'Cerca focus primario' });
        fireEvent.change(search, { target: { value: 'polpaccio destro' } });
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(search.getAttribute('aria-activedescendant')).not.toBeNull();

        rerender(<CycleStrategyFields {...strategyProps} primaryMuscles={['calves_right']} onAddMuscle={onAddMuscle} />);
        expect(search.getAttribute('aria-activedescendant')).toBeNull();
        expect(screen.queryByRole('option', { name: 'Polpaccio destro' })).toBeNull();
        expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
        expect(onAddMuscle).not.toHaveBeenCalled();
    });

    it('keeps unique listbox, input and heading IDs across component instances', () => {
        render(
            <>
                <CycleStrategyFields {...strategyProps} />
                <CycleStrategyFields {...strategyProps} />
            </>,
        );
        const primaries = screen.getAllByRole('combobox', { name: 'Cerca focus primario' });
        expect(primaries).toHaveLength(2);
        const headings = screen.getAllByRole('heading', { name: 'Obiettivo' });
        expect(headings[0].id).not.toBe(headings[1].id);

        act(() => (primaries[0] as HTMLInputElement).focus());
        const firstList = primaries[0].getAttribute('aria-controls');
        expect(firstList).toBeTruthy();
        expect(document.getElementById(firstList!)?.getAttribute('role')).toBe('listbox');

        act(() => (primaries[1] as HTMLInputElement).focus());
        const secondList = primaries[1].getAttribute('aria-controls');
        expect(secondList).toBeTruthy();
        expect(firstList).not.toBe(secondList);
        expect(document.getElementById(secondList!)?.getAttribute('role')).toBe('listbox');
        expect(primaries[0].id).not.toBe(primaries[1].id);
    });
});
