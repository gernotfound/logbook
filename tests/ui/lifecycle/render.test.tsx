import React from 'react';
import { useAppStore } from '../../../src/store/useAppStore';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner, renderWithProviders, emptyUserData } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import type { Exercise, WorkoutSession } from '../../../src/types';

import App from '../../../src/App';
import HomeView from '../../../src/components/Home/HomeView';
import TrainingView from '../../../src/components/Training/TrainingView';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import TrainingRoutines from '../../../src/components/Training/TrainingRoutines';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';
import NutritionView from '../../../src/components/Nutrition/NutritionView';
import NutritionMeals from '../../../src/components/Nutrition/NutritionMeals';
import NutritionPlanning from '../../../src/components/Nutrition/NutritionPlanning';
import CustomFoodForm from '../../../src/components/Nutrition/CustomFoodForm';
import DataView from '../../../src/components/Data/DataView';
import SettingsView from '../../../src/components/SettingsView';
import WorkoutTimer from '../../../src/components/Training/WorkoutTimer';
import MuscleModel from '../../../src/components/Training/MuscleModel';

describe('Render Test Suite - Zero Crash Verification', () => {
  beforeEach(async () => {
    await prepareUnlockedTestArchive();
    useAppStore.setState({ localPersistenceBlocked: false, compatibilityStatus: 'ok', syncHealth: 'synced' });
  });

  test('renders the app navigation when the test account owner is ready', async () => {
    renderWithAuthenticatedTestOwner(<App />);
    expect(await screen.findByRole('navigation', { name: 'Navigazione principale' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  });

  test('renders HomeView without crashing', () => {
    const onNavigateMock = vi.fn();
    const { container } = renderWithProviders(<HomeView onNavigate={onNavigateMock} />);
    expect(container.querySelector('#view-home')).not.toBeNull();
    expect(screen.getByText(/TheLogBook/i)).toBeDefined();
  });

  test('renders TrainingView with session subtab', () => {
    const setSubTabMock = vi.fn();
    renderWithProviders(<TrainingView subTab="session" setSubTab={setSubTabMock} />);
    expect(screen.getByRole('tab', { name: 'Sessione' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Sessione' })).toBeDefined();
  });

  test('renders TrainingView with routines subtab', async () => {
    const setSubTabMock = vi.fn();
    renderWithProviders(<TrainingView subTab="routines" setSubTab={setSubTabMock} />);
    expect(screen.getByRole('tab', { name: 'Schede' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('button', { name: /Crea scheda/i })).toBeDefined();
  });

  test('renders TrainingView with history subtab', async () => {
    const setSubTabMock = vi.fn();
    renderWithProviders(<TrainingView subTab="history" setSubTab={setSubTabMock} />);
    expect(screen.getByRole('tab', { name: 'Storico' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText(/Storico Allenamenti/i)).toBeDefined();
  });

  test('renders TrainingView with exercises subtab', async () => {
    const setSubTabMock = vi.fn();
    renderWithProviders(<TrainingView subTab="exercises" setSubTab={setSubTabMock} />);
    expect(screen.getByRole('tab', { name: 'Esercizi' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('button', { name: /Crea esercizio/i })).toBeDefined();
  });

  test('renders TrainingSession with no active workout', () => {
    const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />);
    expect(container.textContent).toContain('Scegli dall’archivio');
  });

  test('renders TrainingSession with active workout', () => {
    const activeWorkout: WorkoutSession = {
      id: 'w_test_1',
      routineId: 'r1',
      routineName: 'Scheda A - Upper',
      date: '2026-07-26',
      globalStartTime: Date.now(),
      exercises: [{
        id: 'session-ex1',
        exId: 'ex1',
        sets: [{ id: 's1', kg: '80', reps: '10' }],
        sessionNote: 'Note per test',
      }],
    };
    const library: Exercise[] = [{
      id: 'ex1',
      name: 'Panca Piana',
      setsCount: 1,
      sets: [{ weight: '80', reps: '10', done: false }],
    }];
    const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
      localWorkout: activeWorkout,
      userData: { ...emptyUserData, activeWorkout, library },
    });
    expect(container.textContent).toContain('Scheda A - Upper');
    expect(container.textContent).toContain('Panca Piana');
  });

  test('renders TrainingRoutines without crashing', () => {
    renderWithProviders(<TrainingRoutines />);
    expect(screen.getByRole('button', { name: 'Crea scheda' })).toBeDefined();
  });

  test('renders TrainingHistory / HistoryView without crashing', () => {
    renderWithProviders(<TrainingHistory />);
    expect(screen.getByText(/Storico Allenamenti/i)).toBeDefined();
  });

  test('renders TrainingExercises without crashing', () => {
    renderWithProviders(<TrainingExercises />);
    expect(screen.getByRole('button', { name: /Crea esercizio/i })).toBeDefined();
  });

  test('renders NutritionView with meals subtab', () => {
    const setSubTabMock = vi.fn();
    renderWithProviders(<NutritionView subTab="meals" setSubTab={setSubTabMock} />);
    expect(screen.getByRole('tab', { name: 'Pasti' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Pasti' })).not.toBeNull();
  });

  test('renders NutritionMeals without crashing', () => {
    renderWithProviders(<NutritionMeals />);
    expect(screen.getByText(/Cerca Alimento/i)).toBeDefined();
  });

  test('renders NutritionPlanning without crashing', () => {
    renderWithProviders(<NutritionPlanning />);
    expect(screen.getByText(/Pianificazione Macro/i)).toBeDefined();
  });
  test('renders CustomFoodForm without crashing', () => {
    const cfData = { name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' };
    const setCfDataMock = vi.fn();
    const saveCustomFoodMock = vi.fn();
    const setShowCustomModalMock = vi.fn();
    renderWithProviders(
      <CustomFoodForm
        cfData={cfData}
        setCfData={setCfDataMock}
        saveCustomFood={saveCustomFoodMock}
        showCustomModal={true}
        setShowCustomModal={setShowCustomModalMock}
      />
    );
    expect(screen.getByRole('textbox', { name: /Nome alimento/i })).toBeDefined();
  });

  test('renders SettingsView without crashing', () => {
    renderWithProviders(<SettingsView />);
    expect(screen.getByRole('button', { name: /Account e accesso/i })).toBeDefined();
  });

  test('renders DataView without crashing', () => {
    renderWithProviders(<DataView />);
    expect(screen.getByText(/Nuova misurazione/i)).toBeDefined();
  });

  test('renders WorkoutTimer without crashing', () => {
    renderWithProviders(<WorkoutTimer />);
    expect(screen.getByLabelText('Tempo di recupero').textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  test('renders MuscleModel without crashing', () => {
    renderWithProviders(<MuscleModel selectedMuscles={['chest']} />);
    expect(screen.getByRole('img', { name: 'Mappa dei muscoli, vista anteriore e posteriore' })).toBeDefined();
  });

});
