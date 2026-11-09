import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CycleVolumeAccordion } from '../src/components/Training/planning/CycleVolumeAccordion';
import { calculateCycleMacroVolume } from '../src/components/Training/planning/cycleMacroVolume';
import type { Exercise, TrainingCycle, WorkoutRoutine } from '../src/types';

describe('CycleVolumeAccordion', () => {
    it('uses the visible button text as its accessible name and toggles its content', () => {
        render(<CycleVolumeAccordion items={[{ key: 'chest', label: 'Petto', sets: 4 }]} />);
        const button = screen.getByRole('button', { name: 'Volume settimanale per macroarea' });
        expect(button.getAttribute('aria-label')).toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Petto')).toBeNull();

        fireEvent.click(button);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('Petto')).toBeDefined();

        fireEvent.click(button);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Petto')).toBeNull();
    });

    it('shows the explicit empty state for an initially expanded accordion', () => {
        render(<CycleVolumeAccordion items={[]} defaultOpen />);
        expect(screen.getByRole('button', { name: 'Volume settimanale per macroarea' }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('Nessun volume disponibile per le schede del ciclo.')).toBeDefined();
        expect(document.querySelectorAll('.planning-volume-row')).toHaveLength(0);
    });

    it('formats actual fractional weekly sets in Italian while preserving proportional bar widths', () => {
        const cycle: TrainingCycle = {
            id: 'cycle', name: 'Ciclo', durationWeeks: 4, sessionsPerWeek: 3,
            routines: [
                { routineId: 'push', frequencyPerWeek: 1 },
                { routineId: 'pull', frequencyPerWeek: 1 },
            ],
        };
        const routines: WorkoutRoutine[] = [
            { id: 'push', name: 'Spinta', exercises: [{ exId: 'press', setsCount: 1 }] },
            { id: 'pull', name: 'Trazione', exercises: [{ exId: 'row', setsCount: 2 }] },
        ];
        const library: Exercise[] = [
            { id: 'press', name: 'Panca', muscles: ['chest'], setsCount: 1, sets: [] },
            { id: 'row', name: 'Rematore', muscles: ['lats'], setsCount: 2, sets: [] },
        ];
        const items = calculateCycleMacroVolume(cycle, routines, library);
        expect(items.map(item => [item.label, item.sets])).toEqual([['Dorso', 3], ['Petto', 1.5]]);

        render(<CycleVolumeAccordion items={items} defaultOpen />);
        const chest = screen.getByText('Petto').closest('.planning-volume-row');
        const back = screen.getByText('Dorso').closest('.planning-volume-row');
        expect(chest?.lastElementChild?.textContent).toBe('1,5');
        expect(back?.lastElementChild?.textContent).toBe('3');
        expect(chest?.querySelector('.planning-volume-track > span')?.getAttribute('style')).toContain('width: 50%');
        expect(back?.querySelector('.planning-volume-track > span')?.getAttribute('style')).toContain('width: 100%');
    });

    it('updates the displayed values when the active cycle changes without mutating input', () => {
        const first = [{ key: 'chest', label: 'Petto', sets: 2 }];
        const second = [{ key: 'chest', label: 'Petto', sets: 2.5 }];
        const { rerender } = render(<CycleVolumeAccordion items={first} defaultOpen />);
        expect(screen.getByText('2')).toBeDefined();

        rerender(<CycleVolumeAccordion items={second} defaultOpen />);
        expect(screen.getByText('2,5')).toBeDefined();
        expect(first[0].sets).toBe(2);
    });
});
