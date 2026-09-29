import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import { calculateCycleMacroVolume } from '../src/components/Training/planning/cycleMacroVolume';
import type { Exercise, WorkoutRoutine } from '../src/types';

const routines: WorkoutRoutine[] = [
    {
        id: 'upper',
        name: 'Upper body',
        exercises: [{ exId: 'bench', setsCount: 4 }]
    },
    {
        id: 'lower',
        name: 'Lower body',
        exercises: [{ exId: 'squat', setsCount: 4 }]
    }
];

const library: Exercise[] = [
    { id: 'bench', name: 'Panca piana', muscles: ['chest-upper', 'chest-lower'] },
    { id: 'squat', name: 'Squat', muscles: ['quads', 'glutes'] }
];

describe('Pianificazione redesign', () => {
    it('trova una scheda anche cercando un esercizio e aggiunge l’intera scheda', () => {
        render(
            <CycleEditor
                routines={routines}
                library={library}
                onSave={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
        fireEvent.focus(search);
        fireEvent.change(search, { target: { value: 'squat' } });

        const result = screen.getByRole('option', { name: /Lower body/i });
        expect(result.textContent).toContain('Squat');
        fireEvent.click(result);

        expect(screen.getByText('Lower body')).toBeDefined();
        expect(screen.queryByText('Squat', { selector: '.planning-sequence-name strong' })).toBeNull();
    });

    it('espone chiaramente lo stato ON/OFF della rotazione flessibile', () => {
        render(
            <CycleEditor
                routines={routines}
                library={library}
                onSave={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
        fireEvent.change(search, { target: { value: 'upper' } });

        const toggle = screen.getByRole('button', { name: /Rotazione flessibile.*OFF/i });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: /Rotazione flessibile.*ON/i }).getAttribute('aria-expanded')).toBe('true');
    });

    it('chiude l’editor con Chiudi senza salvare', () => {
        const onCancel = vi.fn();
        render(
            <CycleEditor
                routines={routines}
                library={library}
                onSave={vi.fn()}
                onCancel={onCancel}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('calcola il volume per macroarea senza contare due volte due porzioni dello stesso esercizio', () => {
        const result = calculateCycleMacroVolume({
            id: 'cycle',
            name: 'Test',
            durationWeeks: 4,
            sessionsPerWeek: 1,
            routines: [{ routineId: 'upper', frequencyPerWeek: 1 }]
        }, routines, library);

        expect(result.find(item => item.key === 'chest')?.sets).toBe(4);
    });
});
