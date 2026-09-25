import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import HomeView from './HomeView';
import { renderWithProviders } from '../../tests/setup';
import type { WorkoutSession, NutritionDay, Exercise } from '../types';

describe('HomeView Analytics Dashboard Integration Suite (src/views/HomeView.analytics.test.tsx)', () => {
    const mockLibrary: Exercise[] = [
        {
            id: 'ex_bench',
            name: 'Panca piana',
            muscles: ['petto'],
            trackingType: 'weight_reps',
            setsCount: 3,
            sets: []
        },
        {
            id: 'ex_squat',
            name: 'Squat con bilanciere',
            muscles: ['quadricipiti'],
            trackingType: 'weight_reps',
            setsCount: 3,
            sets: []
        }
    ];

    const mockHistory: WorkoutSession[] = [
        {
            id: 'w1',
            date: '2026-08-04',
            routineName: 'Scheda A - Upper',
            exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10', done: true }] }]
        },
        {
            id: 'w2',
            date: '2026-08-11',
            routineName: 'Scheda A - Upper',
            exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '20', done: true }] }]
        },
        {
            id: 'w3',
            date: '2026-08-18',
            routineName: 'Scheda A - Upper',
            exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '100', reps: '30', done: true }] }]
        },
        {
            id: 'w4',
            date: '2026-08-25',
            routineName: 'Scheda A - Upper',
            exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's4', kg: '100', reps: '40', done: true }] }]
        }
    ];

    const mockNutrition: Record<string, NutritionDay> = {
        '2026-08-04': { date: '2026-08-04', kcal: 2000, carbs: 250, pro: 150, fat: 60 },
        '2026-08-11': { date: '2026-08-11', kcal: 2400, carbs: 300, pro: 160, fat: 65 },
        '2026-08-18': { date: '2026-08-18', kcal: 2800, carbs: 340, pro: 175, fat: 75 },
        '2026-08-25': { date: '2026-08-25', kcal: 3200, carbs: 380, pro: 190, fat: 85 }
    };

    const mockUserData = {
        profile: { name: 'Test User', weight: 80, bodyFat: 14 },
        library: mockLibrary,
        routines: [],
        history: mockHistory,
        nutrition: mockNutrition,
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {
            weight: 80,
            normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
        }
    };

    // Timeout increased to 15000ms: Chart.js rendering within JSDom is extremely CPU-bound.
    // Under full CI parallelization, React layout effect and canvas painting exceed the 5000ms limit.
    it('renders WeeklyVolumeChart card within HomeView with sentence case header', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: mockUserData
        });

        const header = await screen.findByText('Volume di allenamento settimanale', {}, { timeout: 10000 });
        expect(header).toBeDefined();
    }, 15000);

    it('renders VolumeCaloriesCorrelationChart card within HomeView with sentence case header', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: mockUserData
        });

        const header = await screen.findByText('Correlazione volume vs calorie', {}, { timeout: 10000 });
        expect(header).toBeDefined();
    });

    it('renders period selection buttons in WeeklyVolumeChart and toggles period selection', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: mockUserData
        });

        await screen.findByText('Volume di allenamento settimanale', {}, { timeout: 10000 });
        const weeklyCard = document.getElementById('weekly-volume-chart-card');
        expect(weeklyCard).toBeDefined();

        const btn4 = weeklyCard?.querySelector('button:nth-child(1)');
        expect(btn4).toBeDefined();
        if (btn4) {
            fireEvent.click(btn4);
            expect(btn4.textContent).toBe('4 sett');
        }

        const btn12 = weeklyCard?.querySelector('button:nth-child(3)');
        expect(btn12).toBeDefined();
        if (btn12) {
            fireEvent.click(btn12);
            expect(btn12.textContent).toBe('12 sett');
        }
    });

    it('renders period selection buttons in VolumeCaloriesCorrelationChart and toggles period selection', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: mockUserData
        });

        await screen.findByText('Correlazione volume vs calorie', {}, { timeout: 10000 });
        const corrCard = document.getElementById('volume-calories-correlation-card');
        expect(corrCard).toBeDefined();

        const btn24 = corrCard?.querySelector('button:nth-child(4)');
        expect(btn24).toBeDefined();
        if (btn24) {
            fireEvent.click(btn24);
            expect(btn24.textContent).toBe('24 sett');
        }
    });

    it('displays empty state fallback in Italian sentence case when history is empty', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: {
                ...mockUserData,
                history: []
            }
        });

        const emptyTitle = await screen.findByText('Nessun dato di allenamento nelle settimane selezionate.', {}, { timeout: 10000 });
        expect(emptyTitle).toBeDefined();
        const emptyDesc = await screen.findByText('Completa una sessione per visualizzare il volume di allenamento.', {}, { timeout: 10000 });
        expect(emptyDesc).toBeDefined();
    });

    it('displays empty state fallback in Italian sentence case when nutrition is empty', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: {
                ...mockUserData,
                nutrition: {}
            }
        });

        const emptyTitle = await screen.findByText('Dati insufficienti per calcolare la correlazione.', {}, { timeout: 10000 });
        expect(emptyTitle).toBeDefined();
        const emptyDesc = await screen.findByText('Registra allenamenti e pasti per visualizzare la relazione tra apporto energetico e carichi.', {}, { timeout: 10000 });
        expect(emptyDesc).toBeDefined();
    });

    it('renders correlation insight text in Italian sentence case for progressive overload data', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: mockUserData
        });

        const insight = await screen.findByText(/Associazione positiva forte/i, {}, { timeout: 10000 });
        expect(insight).toBeDefined();
    });

    it('maintains non-interference with existing HomeView widgets and dashboard cards', async () => {
        renderWithProviders(<HomeView onNavigate={() => {}} />, {
            userData: mockUserData
        });

        expect(await screen.findByText('Biometria', {}, { timeout: 10000 })).toBeDefined();
        expect(await screen.findByText('Massa grassa', {}, { timeout: 10000 })).toBeDefined();
        expect(await screen.findByText(/Streak/i, {}, { timeout: 10000 })).toBeDefined();
        expect(await screen.findByText(/Sessioni/i, {}, { timeout: 10000 })).toBeDefined();
        expect(await screen.findByText('Trend peso corporeo', {}, { timeout: 10000 })).toBeDefined();
    });
});
