import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';

import App from '../src/App';
import HomeView from '../src/components/Home/HomeView';
import TrainingView from '../src/components/Training/TrainingView';
import TrainingSession from '../src/components/Training/TrainingSession';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import NutritionView from '../src/components/Nutrition/NutritionView';
import NutritionMeals from '../src/components/Nutrition/NutritionMeals';
import NutritionPlanning from '../src/components/Nutrition/NutritionPlanning';
import NutritionMeasurements from '../src/components/Nutrition/NutritionMeasurements';
import CustomFoodModal from '../src/components/Nutrition/CustomFoodModal';
import DataView from '../src/components/Data/DataView';
import SettingsView from '../src/components/SettingsView';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import MuscleModel from '../src/components/Training/MuscleModel';

describe('Render Test Suite - Zero Crash Verification', () => {

  test('renders full App without crashing when authenticated', async () => {
    const { container } = renderWithProviders(<App />);
    expect(container).toBeDefined();
    const navElement = await screen.findByRole('navigation');
    expect(navElement).toBeDefined();
  });

  test('renders HomeView without crashing', () => {
    const onNavigateMock = vi.fn();
    const { container } = renderWithProviders(<HomeView onNavigate={onNavigateMock} />);
    expect(container.querySelector('#view-home')).not.toBeNull();
    expect(screen.getByText(/Panoramica di Oggi/i)).toBeDefined();
  });

  test('renders TrainingView with session subtab', () => {
    const setSubTabMock = vi.fn();
    const { container } = renderWithProviders(
      <TrainingView subTab="session" setSubTab={setSubTabMock} />
    );
    expect(container).toBeDefined();
    expect(screen.getAllByText(/Sessione/i).length).toBeGreaterThan(0);
  });

  test('renders TrainingView with routines subtab', () => {
    const setSubTabMock = vi.fn();
    const { container } = renderWithProviders(
      <TrainingView subTab="routines" setSubTab={setSubTabMock} />
    );
    expect(container).toBeDefined();
  });

  test('renders TrainingView with history subtab', () => {
    const setSubTabMock = vi.fn();
    const { container } = renderWithProviders(
      <TrainingView subTab="history" setSubTab={setSubTabMock} />
    );
    expect(container).toBeDefined();
  });

  test('renders TrainingView with exercises subtab', () => {
    const setSubTabMock = vi.fn();
    const { container } = renderWithProviders(
      <TrainingView subTab="exercises" setSubTab={setSubTabMock} />
    );
    expect(container).toBeDefined();
  });

  test('renders TrainingSession with no active workout', () => {
    const { container } = renderWithProviders(<TrainingSession />);
    expect(container.textContent).toContain('Avvia nuova sessione');
  });

  test('renders TrainingSession with active workout', () => {
    const activeWorkout = {
      id: 'w_test_1',
      routineId: 'r1',
      routineName: 'Scheda A - Upper',
      date: '2026-07-26',
      globalStartTime: Date.now(),
      exercises: [
        {
          exId: 'ex1',
          sets: [{ id: 's1', kg: '80', reps: '10' }],
          sessionNote: 'Note per test'
        }
      ]
    };
    const { container } = renderWithProviders(<TrainingSession />, {
      localWorkout: activeWorkout,
      userData: { 
        ...emptyUserData, 
        activeWorkout,
        library: [{ id: 'ex1', name: 'Panca Piana' }] 
      } as any
    });
    expect(container.textContent).toContain('Scheda A - Upper');
    expect(container.textContent).toContain('Panca Piana');
  });

  test('renders TrainingRoutines without crashing', () => {
    const { container } = renderWithProviders(<TrainingRoutines />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Crea Nuova Scheda/i)).toBeDefined();
  });

  test('renders TrainingHistory / HistoryView without crashing', () => {
    const { container } = renderWithProviders(<TrainingHistory />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Storico Allenamenti/i)).toBeDefined();
  });

  test('renders TrainingExercises without crashing', () => {
    const { container } = renderWithProviders(<TrainingExercises />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Nuovo Esercizio/i)).toBeDefined();
  });

  test('renders NutritionView with meals subtab', () => {
    const setSubTabMock = vi.fn();
    const { container } = renderWithProviders(
      <NutritionView subTab="meals" setSubTab={setSubTabMock} />
    );
    expect(container).toBeDefined();
  });

  test('renders NutritionMeals without crashing', () => {
    const { container } = renderWithProviders(<NutritionMeals />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Cerca Alimento/i)).toBeDefined();
  });

  test('renders NutritionPlanning without crashing', () => {
    const { container } = renderWithProviders(<NutritionPlanning />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Target Calorico/i)).toBeDefined();
  });

  test('renders NutritionMeasurements without crashing', () => {
    const { container } = renderWithProviders(<NutritionMeasurements />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Nuova Misurazione/i)).toBeDefined();
  });

  test('renders CustomFoodModal without crashing', () => {
    const cfData = { name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' };
    const setCfDataMock = vi.fn();
    const saveCustomFoodMock = vi.fn();
    const setShowCustomModalMock = vi.fn();
    const { container } = renderWithProviders(
      <CustomFoodModal
        cfData={cfData}
        setCfData={setCfDataMock}
        saveCustomFood={saveCustomFoodMock}
        showCustomModal={true}
        setShowCustomModal={setShowCustomModalMock}
      />
    );
    expect(container).toBeDefined();
    expect(screen.getByPlaceholderText(/Nome alimento/i)).toBeDefined();
  });

  test('renders SettingsView without crashing', () => {
    const { container } = renderWithProviders(<SettingsView />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Account Google/i)).toBeDefined();
  });

  test('renders DataView without crashing', () => {
    const { container } = renderWithProviders(<DataView />);
    expect(container).toBeDefined();
    expect(screen.getByText(/Nuova Misurazione/i)).toBeDefined();
  });

  test('renders WorkoutTimer without crashing', () => {
    const { container } = renderWithProviders(
      <WorkoutTimer globalStartTime={Date.now() - 60000} />
    );
    expect(container.textContent).toMatch(/\d{2}:\d{2}/);
  });

  test('renders MuscleModel without crashing', () => {
    const { container } = renderWithProviders(<MuscleModel targetMuscle="petto" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

});
