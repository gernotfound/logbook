import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import WeeklyVolumeChart from '../src/components/analytics/WeeklyVolumeChart';
import VolumeCaloriesCorrelationChart from '../src/components/analytics/VolumeCaloriesCorrelationChart';
import { renderWithProviders } from './setup';
import { getLocalDateString } from '../src/lib/utils/date';
import type { WorkoutSession, NutritionDay, Exercise } from '../src/types';

describe('Challenger 1: UI & Chart Component Stress Testing', () => {

    const mockLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca piana', setsCount: 3, sets: [] },
        { id: 'ex_squat', name: 'Squat', equipmentWeight: 20, setsCount: 3, sets: [] }
    ];

    it('renders WeeklyVolumeChart with 500 workouts across 24 weeks seamlessly without lag or crash', async () => {
        const history: WorkoutSession[] = [];
        const baseDate = new Date(2026, 7, 20, 12).getTime();

        for (let i = 0; i < 500; i++) {
            const dateStr = getLocalDateString(baseDate - (i * 12 * 60 * 60 * 1000));
            history.push({
                id: 'w_' + i,
                date: dateStr,
                exercises: [{
                    exId: 'ex_bench',
                    sets: [{ id: 's_' + i, kg: '100', reps: '10' }]
                }]
            });
        }

        renderWithProviders(
            <WeeklyVolumeChart
                history={history}
                library={mockLibrary}
                userWeight={80}
                defaultWeeks={24}
            />
        );

        expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
        expect(await screen.findByText(/Attuale:/i)).toBeDefined();
        expect(await screen.findByText(/Media:/i)).toBeDefined();
    });

    it('handles interactive period toggling across 4, 8, 12, and 24 weeks without error', () => {
        const history: WorkoutSession[] = [{
            id: 'w1',
            date: '2026-08-18',
            exercises: [{ exId: 'ex_bench', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
        }];

        renderWithProviders(
            <WeeklyVolumeChart
                history={history}
                library={mockLibrary}
                userWeight={80}
                defaultWeeks={8}
            />
        );

        const btn4 = screen.getByText('4 sett');
        const btn8 = screen.getByText('8 sett');
        const btn12 = screen.getByText('12 sett');
        const btn24 = screen.getByText('24 sett');

        fireEvent.click(btn4);
        expect(btn4.style.background).toBe('var(--primary-color)');

        fireEvent.click(btn12);
        expect(btn12.style.background).toBe('var(--primary-color)');

        fireEvent.click(btn24);
        expect(btn24.style.background).toBe('var(--primary-color)');

        fireEvent.click(btn8);
        expect(btn8.style.background).toBe('var(--primary-color)');
    });

    it('renders VolumeCaloriesCorrelationChart empty and non-empty states correctly', async () => {
        const { unmount } = renderWithProviders(
            <VolumeCaloriesCorrelationChart
                history={[]}
                nutrition={{}}
                library={mockLibrary}
                userWeight={80}
            />
        );

        expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();
        expect(screen.getByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
        unmount();

        const history: WorkoutSession[] = [
            { id: 'w1', date: '2026-08-04', exercises: [{ exId: 'ex_bench', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
            { id: 'w2', date: '2026-08-11', exercises: [{ exId: 'ex_bench', sets: [{ id: 's2', kg: '200', reps: '10' }] }] },
            { id: 'w3', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sets: [{ id: 's3', kg: '300', reps: '10' }] }] }
        ];

        const nutrition: Record<string, NutritionDay> = {
            '2026-08-04': { date: '2026-08-04', kcal: 2000, carbs: 0, pro: 0, fat: 0 },
            '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 0, pro: 0, fat: 0 },
            '2026-08-18': { date: '2026-08-18', kcal: 3000, carbs: 0, pro: 0, fat: 0 }
        };

        renderWithProviders(
            <VolumeCaloriesCorrelationChart
                history={history}
                nutrition={nutrition}
                library={mockLibrary}
                userWeight={80}
            />
        );

        expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();
        expect(await screen.findByText(/r = \+1\.00/i)).toBeDefined();
        expect(await screen.findByText(/Forte correlazione positiva/i)).toBeDefined();
    });
});