import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

    const emptyViews = [
      {
        name: 'Home',
        render: () => renderWithProviders(<HomeView onNavigate={() => {}} />, { userData: emptyUserData }),
        assertVisible: () => expect(document.querySelector('#view-home')).not.toBeNull(),
      },
      {
        name: 'Impostazioni',
        render: () => renderWithProviders(<SettingsView />, { userData: emptyUserData }),
        assertVisible: () => expect(document.querySelector('#view-settings')).not.toBeNull(),
      },
      {
        name: 'Pianificazione nutrizionale',
        render: () => renderWithProviders(<NutritionPlanning />, { userData: emptyUserData }),
        assertVisible: () => expect(screen.getByRole('button', { name: 'Salva pianificazione' })).not.toBeNull(),
      },
      {
        name: 'Sessione allenamento',
        render: () => renderWithAuthenticatedTestOwner(<TrainingSession />, { userData: emptyUserData }),
        assertVisible: () => expect(screen.getByRole('button', { name: 'Allenamento libero' })).not.toBeNull(),
      },
      {
        name: 'Schede allenamento',
        render: () => renderWithProviders(<TrainingRoutines />, { userData: emptyUserData }),
        assertVisible: () => expect(screen.getByText('Nessuna scheda creata.')).not.toBeNull(),
      },
      {
        name: 'Storico allenamenti',
        render: () => renderWithProviders(<TrainingHistory />, { userData: emptyUserData }),
        assertVisible: () => expect(screen.getByRole('heading', { name: 'Storico allenamenti' })).not.toBeNull(),
      },
      {
        name: 'Libreria esercizi',
        render: () => renderWithProviders(<TrainingExercises />, { userData: emptyUserData }),
        assertVisible: () => expect(screen.getByRole('heading', { name: 'Esercizi' })).not.toBeNull(),
      },
    ];

    test.each(emptyViews)('$name mostra un contenuto osservabile con dati vuoti', ({ render, assertVisible }) => {
      const view = render();
      expect(view.container.firstChild).not.toBeNull();
      assertVisible();
    });

    test('pianificazione senza normocalorica mantiene i controlli per il TDEE', () => {
      const incompleteUserData = {
        ...emptyUserData,
        nutritionPlanning: {
          weight: 80,
          avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
        },
      };
      renderWithProviders(<NutritionPlanning />, { userData: incompleteUserData });
      expect(screen.getByRole('heading', { name: /TDEE \(normocalorica\)/ })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Salva pianificazione' })).toBeDefined();
    });

});
