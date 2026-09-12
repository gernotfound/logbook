import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { renderWithProviders } from './setup';

describe('WorkoutTimer UI invariants', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('keeps three primary control slots visible', () => {
    renderWithProviders(<WorkoutTimer />);

    expect(screen.getByRole('button', { name: 'Avvia recupero' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Riavvia recupero' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ferma recupero' })).toBeDefined();
  });

  test('replaces play with pause without hiding reset or stop', () => {
    renderWithProviders(<WorkoutTimer />);

    fireEvent.click(screen.getByRole('button', { name: 'Avvia recupero' }));

    expect(screen.getByRole('button', { name: 'Pausa recupero' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Riavvia recupero' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ferma recupero' })).toBeDefined();
  });
});
