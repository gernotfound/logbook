import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { renderWithProviders } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import MuscleModel from '../../../src/components/Training/MuscleModel';

describe('Muscle map missing and corrupt inputs', () => {
  beforeEach(async () => { await prepareUnlockedTestArchive(); });

    test('MuscleModel handles unknown, null, or undefined muscle IDs safely', () => {
      expect(() => renderWithProviders(<MuscleModel selectedMuscles={[""]} />)).not.toThrow();
      expect(() => renderWithProviders(<MuscleModel selectedMuscles={["unknown_muscle_id_xyz"]} />)).not.toThrow();
      expect(() => renderWithProviders(<MuscleModel selectedMuscles={[null as any]} />)).not.toThrow();
    });
});
