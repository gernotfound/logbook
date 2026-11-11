import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { renderWithAuthenticatedTestOwner, renderWithProviders, emptyUserData } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import HomeView from '../../../src/components/Home/HomeView';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import TrainingRoutines from '../../../src/components/Training/TrainingRoutines';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';
import NutritionPlanning from '../../../src/components/Nutrition/NutritionPlanning';
import SettingsView from '../../../src/components/SettingsView';

describe('Cross-module minimal data UI fail-safe', () => {
  beforeEach(async () => { await prepareUnlockedTestArchive(); });

    test('Components render gracefully when userData has minimal/empty structures', () => {


      expect(() => renderWithProviders(<HomeView onNavigate={() => {}} />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<SettingsView />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<NutritionPlanning />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithAuthenticatedTestOwner(<TrainingSession />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingRoutines />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingHistory />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingExercises />, { userData: emptyUserData })).not.toThrow();
    });

    test('NutritionPlanning without normocalorica object in nutritionPlanning renders without TypeError (Vulnerability check)', () => {
      const incompleteUserData = {
        nutritionPlanning: {
          weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 }
          // normocalorica missing!
        } as any
      };
      expect(() => renderWithProviders(<NutritionPlanning />, { userData: incompleteUserData })).not.toThrow();
    });
});
