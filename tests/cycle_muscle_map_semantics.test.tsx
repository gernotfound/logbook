import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MuscleModel from '../src/components/Training/MuscleModel';
import { CycleMuscleMap } from '../src/components/Training/planning/CycleMuscleMap';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import { calculateCycleVolume } from '../src/lib/calc/planning';
import { GROUP_MAP } from '../src/lib/constants/muscles';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../src/types';

const routines: WorkoutRoutine[] = [
    { id: 'push', name: 'Spinta', exercises: [{ exId: 'bench', setsCount: 4 }] },
    { id: 'empty', name: 'Scheda vuota', exercises: [] },
];
const library: Exercise[] = [
    { id: 'bench', name: 'Panca', muscles: ['chest_upper'], setsCount: 4, sets: [] },
];
const cycle: TrainingCycle = {
    id: 'cycle-highlight',
    name: 'Ciclo senza priorità muscolari',
    durationWeeks: 4,
    sessionsPerWeek: 1,
    routines: [{ routineId: 'push', frequencyPerWeek: 1 }],
};

describe('CycleMuscleMap anatomical summary', () => {
    it('labels calculated training highlights without claiming they are cycle strategy priorities', () => {
        const calculated = calculateCycleVolume(cycle, routines, library);
        expect(calculated.highlightedMuscles).toEqual(['chest_upper']);
        const { container } = render(
            <CycleMuscleMap title="Mappa muscolare del ciclo" highlightedMuscles={calculated.highlightedMuscles} />,
        );
        const legend = container.querySelector<HTMLElement>('.cycle-muscle-map .muscle-legend')!;
        expect(legend.textContent).toContain('Muscoli evidenziati dalle schede: Fascio clavicolare (petto alto)');
        expect(legend.textContent).not.toContain('Primari:');

        const svg = screen.getByRole('img', { name: 'Mappa dei muscoli, vista anteriore e posteriore' });
        expect(svg.getAttribute('aria-describedby')).toBe(legend.id);
        const pathId = GROUP_MAP.chest_upper[0];
        const highlightedPath = container.querySelector<SVGPathElement>(`[data-muscle-path="${pathId}"]`);
        expect(highlightedPath?.style.fill).toBe('var(--primary-color)');
    });

    it('preserves the original primary/secondary legend for other MuscleModel consumers', () => {
        const { container } = render(
            <MuscleModel selectedMuscles={['quads']} secondaryMuscles={['calves']} />,
        );
        const legend = container.querySelector<HTMLElement>('.muscle-legend')!;
        expect(legend.textContent).toContain('Primari: Quadricipiti');
        expect(legend.textContent).toContain('Secondari: Polpacci');
    });

    it('changes the empty guidance after a routine is selected without falsely instructing to add one', () => {
        render(<CycleEditor routines={routines} library={library} onSave={vi.fn()} onCancel={vi.fn()} />);
        const section = screen.getByRole('region', { name: 'Mappa muscolare del ciclo' });
        expect(section.textContent).toContain('Aggiungi una scheda al ciclo');
        expect(section.textContent).toContain('Nessun muscolo evidenziato.');

        const search = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
        fireEvent.change(search, { target: { value: 'empty' } });
        expect(section.textContent).toContain('Nessun muscolo evidenziato per le schede selezionate.');
        expect(section.textContent).not.toContain('Aggiungi una scheda al ciclo');
    });
});
