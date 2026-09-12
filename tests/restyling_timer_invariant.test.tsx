import React from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { renderWithProviders } from './setup';

describe('Restyling workout timer invariants', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('keeps exactly three controls visible across start, pause, reset and stop states', () => {
    renderWithProviders(<WorkoutTimer />);

    const assertThreeControls = () => {
      expect(screen.getAllByRole('button').length).toBe(3);
      expect(screen.getByRole('button', { name: /^riavvia recupero$/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^ferma recupero$/i })).toBeTruthy();
    };

    assertThreeControls();
    fireEvent.click(screen.getByRole('button', { name: /^avvia recupero$/i }));

    assertThreeControls();
    expect(screen.getByRole('button', { name: /^pausa recupero$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^pausa recupero$/i }));

    assertThreeControls();
    expect(screen.getByRole('button', { name: /^avvia recupero$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^riavvia recupero$/i }));
    assertThreeControls();
    expect(screen.getByRole('button', { name: /^pausa recupero$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^ferma recupero$/i }));
    assertThreeControls();
    expect(screen.getByRole('button', { name: /^avvia recupero$/i })).toBeTruthy();
  });

  test('uses the dedicated workout timer markup', () => {
    const { container } = renderWithProviders(<WorkoutTimer />);
    expect(container.querySelector('.workout-rest-timer')).not.toBeNull();
    expect(container.querySelector('.workout-rest-timer__display')?.textContent).toBe('00:00');
  });
});
