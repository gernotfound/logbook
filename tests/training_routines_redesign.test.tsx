import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';

const library = [
    {
        id: 'bench',
        name: 'Panca piana',
        muscles: ['chest'],
        secondaryMuscles: ['triceps'],
        trackingType: 'weight_reps',
        sets: [],
    },
    {
        id: 'squat',
        name: 'Squat',
        muscles: ['quads'],
        secondaryMuscles: ['glutes'],
        trackingType: 'weight_reps',
        sets: [],
    },
] as any;

const routines = [
    {
        id: 'upper-a',
        name: 'Upper body A',
        exercises: [{ exId: 'bench', setsCount: 3, minReps: 8, maxReps: 10 }],
    },
    {
        id: 'lower-a',
        name: 'Lower body A',
        exercises: [{ exId: 'squat', setsCount: 4, minReps: 6, maxReps: 8 }],
    },
] as any;

describe('Schede redesign', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('filters only by routine name and keeps one inline card expanded at a time', () => {
        const { container } = renderWithProviders(<TrainingRoutines />, {
            userData: { ...emptyUserData, routines, library } as any,
        });

        expect(screen.getByRole('heading', { name: 'Schede' })).toBeTruthy();
        const search = screen.getByRole('searchbox', { name: 'Cerca scheda per nome' });

        fireEvent.change(search, { target: { value: 'upper' } });
        expect(screen.getByText('Upper body A')).toBeTruthy();
        expect(screen.queryByText('Lower body A')).toBeNull();

        fireEvent.change(search, { target: { value: '' } });

        const upperToggle = screen.getByRole('button', { name: 'Apri scheda Upper body A' });
        const lowerToggle = screen.getByRole('button', { name: 'Apri scheda Lower body A' });

        fireEvent.click(upperToggle);
        expect(screen.getByText('Panca piana')).toBeTruthy();
        expect(screen.getByText('3 × 8–10')).toBeTruthy();
        expect(container.querySelectorAll('.routine-library-card.is-expanded')).toHaveLength(1);

        fireEvent.click(lowerToggle);
        expect(screen.queryByText('Panca piana')).toBeNull();
        expect(screen.getByText('Squat')).toBeTruthy();
        expect(container.querySelectorAll('.routine-library-card.is-expanded')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Chiudi scheda Lower body A' }));
        expect(container.querySelectorAll('.routine-library-card.is-expanded')).toHaveLength(0);
    });

    it('keeps the contextual menu separate from expansion and exposes muscles in a collapsed disclosure', () => {
        const { container } = renderWithProviders(<TrainingRoutines />, {
            userData: { ...emptyUserData, routines, library } as any,
        });

        const card = screen.getByText('Upper body A').closest('.routine-library-card');
        fireEvent.click(screen.getByRole('button', { name: 'Azioni per Upper body A' }));

        expect(screen.getByRole('menuitem', { name: 'Modifica' })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: 'Duplica' })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: 'Elimina' })).toBeTruthy();
        expect(card?.classList.contains('is-expanded')).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Apri scheda Upper body A' }));

        const details = container.querySelector('.routine-muscle-details') as HTMLDetailsElement;
        expect(details).toBeTruthy();
        expect(details.open).toBe(false);
        expect(container.querySelector('.routine-muscle-map .muscle-legend')).toBeNull();

        fireEvent.click(screen.getByText('Muscoli coinvolti'));
        expect(details.open).toBe(true);
        expect(details.textContent).toContain('Primari:');
        expect(details.textContent).toContain('Secondari:');
    });

    it('adds an exercise from the whole result row and keeps per-set technique configuration aligned with set count', () => {
        const { container } = renderWithProviders(<TrainingRoutines />, {
            userData: { ...emptyUserData, routines: [], library } as any,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Crea scheda' }));

        const exerciseSearch = screen.getByRole('combobox');
        fireEvent.change(exerciseSearch, { target: { value: 'Panca' } });

        const option = screen.getByRole('option');
        fireEvent.click(option);

        expect(screen.getByText('1. Panca piana')).toBeTruthy();

        fireEvent.click(screen.getByText('Tecnica e progressione'));
        expect(container.querySelectorAll('.routine-technique-set')).toHaveLength(3);

        fireEvent.change(screen.getByLabelText('Tecnica serie 2'), { target: { value: 'cluster' } });
        expect((screen.getByLabelText('Tecnica serie 2') as HTMLSelectElement).value).toBe('cluster');

        fireEvent.change(screen.getByLabelText('Serie:'), { target: { value: '5' } });
        expect(container.querySelectorAll('.routine-technique-set')).toHaveLength(5);
        expect((screen.getByLabelText('Tecnica serie 2') as HTMLSelectElement).value).toBe('cluster');
        expect(screen.getByLabelText('Segmenti serie 2')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Serie:'), { target: { value: '3' } });
        expect(container.querySelectorAll('.routine-technique-set')).toHaveLength(3);
        expect((screen.getByLabelText('Tecnica serie 2') as HTMLSelectElement).value).toBe('cluster');
    });
});
