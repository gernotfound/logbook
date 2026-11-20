import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import MuscleModel from '../../../src/components/Training/MuscleModel';

describe('Muscle map missing and corrupt inputs', () => {
  beforeEach(async () => { await prepareUnlockedTestArchive(); });

  test.each([
    ['empty muscle ID', ['']],
    ['unknown muscle ID', ['unknown_muscle_id_xyz']],
    ['null muscle ID', [null]],
  ])('%s keeps the SVG unhighlighted while preserving its accessible description', (_, selectedMuscles) => {
    renderWithProviders(<MuscleModel selectedMuscles={selectedMuscles as unknown as string[]} />);
    const map = screen.getByRole('img', { name: 'Mappa dei muscoli, vista anteriore e posteriore' });
    const paths = map.querySelectorAll('path[data-muscle-path]');
    expect(paths.length).toBeGreaterThan(0);
    expect([...paths].every(path => path.getAttribute('style')?.includes('fill: var(--surface-light)'))).toBe(true);
  });

  test('a valid muscle group highlights its mapped paths', () => {
    renderWithProviders(<MuscleModel selectedMuscles={['biceps']} />);
    const map = screen.getByRole('img', { name: 'Mappa dei muscoli, vista anteriore e posteriore' });
    const biceps = map.querySelector('path[data-muscle-path="biceps-left_1"]');
    expect(biceps).not.toBeNull();
    expect(biceps?.getAttribute('style')).toContain('fill: var(--primary-color)');
  });
});
