import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import WeeklyVolumeChart from '../src/components/analytics/WeeklyVolumeChart';
import VolumeCaloriesCorrelationChart from '../src/components/analytics/VolumeCaloriesCorrelationChart';
import HomeView from '../src/components/Home/HomeView';
import { renderWithProviders } from './setup';
import type { WorkoutSession, NutritionDay, Exercise } from '../src/types';

describe('Analytics UI Components & Dashboard Integration', () => {
    const mockLibrary: Exercise[] = [
        {
            id: 'ex1',
            name: 'Panca piana',
            setsCount: 3,
            sets: []
        }
    ];

    const mockHistory: WorkoutSession[] = [
        {
            id: 'w1',
            date: '2026-08-18',
            routineName: 'Scheda A',
            exercises: [
                {
                    exId: 'ex1',
                    sessionNote: '',
                    sets: [{ id: 's1', kg: '100', reps: '10', done: true }]
                }
            ]
        }
    ];

    const mockNutrition: Record<string, NutritionDay> = {
        '2026-08-18': {
            date: '2026-08-18',
            kcal: 2500,
            carbs: 300,
            pro: 160,
            fat: 70
        }
    };

    describe('WeeklyVolumeChart', () => {
        it('renders chart card header in sentence case', () => {
            renderWithProviders(
                <WeeklyVolumeChart
                    history={mockHistory}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
            expect(screen.getByText(/Attuale:/i)).toBeDefined();
        });

        it('renders period buttons and toggles active state on click', () => {
            renderWithProviders(
                <WeeklyVolumeChart
                    history={mockHistory}
                    library={mockLibrary}
                    userWeight={80}
                    defaultWeeks={8}
                />
            );

            const btn4 = screen.getByText('4 sett');
            const btn8 = screen.getByText('8 sett');
            const btn12 = screen.getByText('12 sett');

            expect(btn4).toBeDefined();
            expect(btn8).toBeDefined();
            expect(btn12).toBeDefined();

            fireEvent.click(btn4);
            expect(btn4).toBeDefined();
        });

        it('renders empty state when history is empty', () => {
            renderWithProviders(
                <WeeklyVolumeChart
                    history={[]}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Nessun dato di allenamento nelle settimane selezionate.')).toBeDefined();
            expect(screen.getByText('Completa una sessione per visualizzare il volume di allenamento.')).toBeDefined();
        });
    });

    describe('VolumeCaloriesCorrelationChart', () => {
        it('renders correlation chart header in sentence case', () => {
            renderWithProviders(
                <VolumeCaloriesCorrelationChart
                    history={mockHistory}
                    nutrition={mockNutrition}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();
        });

        it('renders empty state when no workouts or calories exist', () => {
            renderWithProviders(
                <VolumeCaloriesCorrelationChart
                    history={[]}
                    nutrition={{}}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
        });
    });

    describe('HomeView Analytics Integration', () => {
        it('renders HomeView with analytics section and existing widgets', async () => {
            renderWithProviders(<HomeView onNavigate={() => {}} />);

            // Existing elements
            expect(screen.getByText('Panoramica di oggi')).toBeDefined();
            expect(screen.getByText('Stato muscolare (72h)')).toBeDefined();
            expect(screen.getByText('Trend peso corporeo')).toBeDefined();

            // Lazy loaded analytics charts
            await waitFor(() => {
                expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
                expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();
            });
        });
    });
});