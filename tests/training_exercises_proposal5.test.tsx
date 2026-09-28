import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import { renderWithProviders, emptyUserData } from './setup';
import type { Exercise } from '../src/types';

describe('TrainingExercises proposal 5', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('filters the real library by exercise name and muscle metadata, then restores the list', () => {
    const library: Exercise[] = [
      {
        id: 'bench',
        name: 'Panca inclinata',
        setsCount: 3,
        sets: [],
        muscles: ['chest_upper'],
        trackingType: 'weight_reps',
      },
      {
        id: 'squat',
        name: 'Squat',
        setsCount: 3,
        sets: [],
        muscles: ['quads'],
        trackingType: 'weight_reps',
      },
    ];

    renderWithProviders(<TrainingExercises />, {
      userData: { ...emptyUserData, library },
    });

    const search = screen.getByRole('searchbox', { name: 'Cerca esercizio' });
    expect(search.getAttribute('type')).toBe('text');
    expect(search.getAttribute('inputmode')).toBe('search');
    fireEvent.change(search, { target: { value: 'squat' } });

    expect(screen.getByRole('button', { name: 'Apri dettaglio di Squat' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Apri dettaglio di Panca inclinata' })).toBeNull();

    fireEvent.change(search, { target: { value: 'clavicolare' } });
    expect(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Apri dettaglio di Squat' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancella ricerca' }));
    expect(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Apri dettaglio di Squat' })).toBeDefined();
  });

  it('keeps the exercise muscle selector ordered, searchable, exclusive and interactive', () => {
    const { container } = renderWithProviders(<TrainingExercises />, {
      userData: emptyUserData,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Crea esercizio' }));

    expect(screen.getByRole('heading', { name: 'Muscoli coinvolti' })).toBeDefined();

    const primaryMode = screen.getByRole('button', { name: 'Primari' });
    const secondaryMode = screen.getByRole('button', { name: 'Secondari' });
    expect(primaryMode.getAttribute('aria-pressed')).toBe('true');
    expect(secondaryMode.getAttribute('aria-pressed')).toBe('false');

    const muscleSearch = screen.getByRole('searchbox', { name: 'Seleziona muscoli dall’elenco' });
    expect(muscleSearch.getAttribute('type')).toBe('text');
    expect(muscleSearch.getAttribute('inputmode')).toBe('search');
    expect(container.querySelector('.exercise-muscle-results')).toBeNull();
    expect(container.querySelector('details')).toBeNull();

    fireEvent.change(muscleSearch, { target: { value: 'clavicolare' } });
    const options = container.querySelectorAll('.exercise-muscle-option');
    expect(options.length).toBeGreaterThan(0);

    fireEvent.click(options[0]);
    expect(container.querySelectorAll('.exercise-muscle-tag.primary').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.exercise-muscle-tag.secondary').length).toBe(0);

    fireEvent.click(secondaryMode);
    const refreshedOptions = container.querySelectorAll('.exercise-muscle-option');
    fireEvent.click(refreshedOptions[0]);
    expect(container.querySelectorAll('.exercise-muscle-tag.primary').length).toBe(0);
    expect(container.querySelectorAll('.exercise-muscle-tag.secondary').length).toBeGreaterThan(0);

    const secondaryTag = container.querySelector('.exercise-muscle-tag.secondary') as HTMLButtonElement;
    fireEvent.click(secondaryTag);
    expect(container.querySelectorAll('.exercise-muscle-tag.primary').length).toBe(0);
    expect(container.querySelectorAll('.exercise-muscle-tag.secondary').length).toBe(0);
    expect(screen.getByText('Nessun muscolo selezionato')).toBeDefined();

    const svg = container.querySelector('.exercise-muscle-model svg') as SVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 70 94');
    expect(svg.querySelectorAll('path').length).toBe(132);

    const chestPath = svg.querySelector('path[data-muscle-path="chest-upper-left"]') as SVGPathElement;
    fireEvent.click(chestPath);
    expect(container.querySelectorAll('.exercise-muscle-tag.secondary').length).toBeGreaterThan(0);
  });

  it('opens and closes the dedicated detail view while preserving catalog action rules', () => {
    const library: Exercise[] = [
      {
        id: 'catalog',
        name: 'Esercizio catalogo',
        setsCount: 3,
        sets: [],
        muscles: ['chest_upper'],
        trackingType: 'weight_reps',
        isDefault: true,
      },
      {
        id: 'custom',
        name: 'Esercizio personale',
        setsCount: 3,
        sets: [],
        muscles: ['quads'],
        trackingType: 'time',
        isDefault: false,
      },
    ];

    renderWithProviders(<TrainingExercises />, {
      userData: { ...emptyUserData, library },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Esercizio catalogo' }));
    expect(screen.getByText('Catalogo')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Torna all’elenco' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Esercizio personale' }));
    expect(screen.getByText('Personale')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Elimina' })).toBeDefined();
  });
});
