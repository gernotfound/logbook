import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CycleRoutinesList } from '../../../src/components/Training/planning/CycleRoutinesList';
import { CycleEditor } from '../../../src/components/Training/planning/CycleEditor';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../../../src/types';

const routines: WorkoutRoutine[] = [
    { id: 'push', name: 'Spinta', exercises: [{ exId: 'bench', setsCount: 3 }] },
    { id: 'pull', name: 'Trazione', exercises: [{ exId: 'lat', setsCount: 4 }] },
    { id: 'legs', name: 'Gambe', exercises: [{ exId: 'squat', setsCount: 4 }] },
];
const library: Exercise[] = [
    { id: 'bench', name: 'Panca piana', muscles: ['chest'], sets: [], setsCount: 3 },
    { id: 'lat', name: 'Lat machine', muscles: ['lats'], sets: [], setsCount: 4 },
    { id: 'squat', name: 'Squat', muscles: ['quads'], sets: [], setsCount: 4 },
];

describe('CycleRoutinesList combobox and sequence', () => {
    it('navigates filtered exercise suggestions with arrow keys and adds with Enter without submitting the cycle', () => {
        const onSave = vi.fn((_cycle: TrainingCycle) => {});
        render(<CycleEditor routines={routines} library={library} onSave={onSave} onCancel={vi.fn()} />);
        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' }) as HTMLInputElement;

        act(() => search.focus());
        fireEvent.change(search, { target: { value: 'machine' } });
        expect(screen.getByRole('listbox', { name: 'Risultati schede' })).toBeDefined();
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(search.getAttribute('aria-activedescendant')).toBeNull();

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        const option = screen.getByRole('option', { name: /Trazione/i });
        expect(option.getAttribute('aria-selected')).toBe('true');
        expect(option.getAttribute('tabindex')).toBe('-1');
        expect(search.getAttribute('aria-activedescendant')).toBe(option.id);
        expect(document.activeElement).toBe(search);

        fireEvent.keyDown(search, { key: 'Enter' });
        expect(screen.getByText('Sequenza rotazione schede (1)')).toBeDefined();
        expect(screen.getByText('Trazione', { selector: '.planning-sequence-name strong' })).toBeDefined();
        expect(search.value).toBe('');
        expect(search.getAttribute('aria-expanded')).toBe('false');
        expect(search.getAttribute('aria-activedescendant')).toBeNull();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('wraps through results in both directions, Escape closes them and Enter cannot submit when closed', () => {
        const onAdd = vi.fn();
        render(
            <CycleRoutinesList cycleRoutines={[]} routines={routines}
                onAdd={onAdd} onMove={vi.fn()} onRemove={vi.fn()} />,
        );
        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
        fireEvent.focus(search);
        fireEvent.keyDown(search, { key: 'ArrowUp' });
        expect(screen.getByRole('option', { name: /Gambe/i }).getAttribute('aria-selected')).toBe('true');

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        const first = screen.getByRole('option', { name: /Spinta/i });
        expect(first.getAttribute('aria-selected')).toBe('true');
        expect(search.getAttribute('aria-activedescendant')).toBe(first.id);

        fireEvent.keyDown(search, { key: 'Escape' });
        expect(search.getAttribute('aria-expanded')).toBe('false');
        expect(search.getAttribute('aria-controls')).toBeNull();
        expect(search.getAttribute('aria-activedescendant')).toBeNull();
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onAdd).not.toHaveBeenCalled();

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(search.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('option', { name: /Spinta/i }).getAttribute('aria-selected')).toBe('true');
    });

    it('does not clear a search or dispatch an addition when typing an already selected routine ID', () => {
        const onAdd = vi.fn();
        const selected = [{ routineId: 'push', frequencyPerWeek: 1 }];
        const { rerender } = render(
            <CycleRoutinesList cycleRoutines={selected} routines={routines}
                onAdd={onAdd} onMove={vi.fn()} onRemove={vi.fn()} />,
        );
        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' }) as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'push' } });
        expect(onAdd).not.toHaveBeenCalled();
        expect(search.value).toBe('push');
        expect(screen.getByText('Nessuna scheda contiene questa ricerca.')).toBeDefined();

        rerender(
            <CycleRoutinesList cycleRoutines={[...selected, { routineId: 'pull', frequencyPerWeek: 1 }, { routineId: 'legs', frequencyPerWeek: 1 }]}
                routines={routines} onAdd={onAdd} onMove={vi.fn()} onRemove={vi.fn()} />,
        );
        expect(screen.getByText('Tutte le schede disponibili sono già nella sequenza.')).toBeDefined();
        expect(onAdd).not.toHaveBeenCalled();
        expect(search.value).toBe('push');
    });

    it('avoids stale keyboard selection when the candidate disappears from parent props', () => {
        const onAdd = vi.fn();
        const props = { routines, onAdd, onMove: vi.fn(), onRemove: vi.fn() };
        const { rerender } = render(<CycleRoutinesList {...props} cycleRoutines={[]} />);
        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
        fireEvent.focus(search);
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(search.getAttribute('aria-activedescendant')).not.toBeNull();
        rerender(<CycleRoutinesList {...props} cycleRoutines={[{ routineId: 'push', frequencyPerWeek: 1 }]} />);
        expect(search.getAttribute('aria-activedescendant')).toBeNull();
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onAdd).not.toHaveBeenCalled();
    });

    it('preserves exact-ID quick add for available routines', () => {
        const onAdd = vi.fn();
        render(
            <CycleRoutinesList cycleRoutines={[]} routines={routines}
                onAdd={onAdd} onMove={vi.fn()} onRemove={vi.fn()} />,
        );
        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' }) as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'pull' } });
        expect(onAdd).toHaveBeenCalledOnce();
        expect(onAdd).toHaveBeenCalledWith('pull');
        expect(search.value).toBe('');
        expect(search.getAttribute('aria-expanded')).toBe('false');
    });
});
