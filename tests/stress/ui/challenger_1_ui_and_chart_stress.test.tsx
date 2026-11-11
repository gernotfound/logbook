import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Chart as ChartJS } from 'chart.js';
import WeeklyVolumeChart from '../../../src/components/analytics/WeeklyVolumeChart';
import VolumeCaloriesCorrelationChart from '../../../src/components/analytics/VolumeCaloriesCorrelationChart';
import { renderWithProviders } from '../../setup';
import { getLocalDateString } from '../../../src/lib/utils/date';
import type { WorkoutSession, NutritionDay, Exercise } from '../../../src/types';

describe('Challenger 1: UI & Chart Component Stress Testing', () => {

    const mockLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca piana', setsCount: 3, sets: [] },
        { id: 'ex_squat', name: 'Squat', equipmentWeight: 20, setsCount: 3, sets: [] }
    ];

    it('renders WeeklyVolumeChart with 500 workouts across 24 weeks without errors', async () => {
        const history: WorkoutSession[] = [];
        const anchor = new Date();
        anchor.setHours(12, 0, 0, 0);

        for (let i = 0; i < 500; i++) {
            const date = new Date(anchor);
            date.setDate(date.getDate() - (i % (23 * 7)));
            const dateStr = getLocalDateString(date);
            history.push({
                id: 'w_' + i,
                date: dateStr,
                exercises: [{
                    exId: 'ex_bench',
                    sessionNote: '',
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
        const canvas = await screen.findByRole('img', { name: /Volume settimanale/i });
        await waitFor(() => expect(ChartJS.getChart(canvas as HTMLCanvasElement)?.data.labels).toHaveLength(24));
        const values = ChartJS.getChart(canvas as HTMLCanvasElement)!.data.datasets[0].data;
        expect(values.map(value => Number(value)).reduce((sum, value) => sum + value, 0)).toBe(500000);
    });

    it('recalculates chart buckets and totals across 4, 8, 12, and 24 weeks', async () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        const sixWeeksAgo = new Date(today);
        sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
        const history: WorkoutSession[] = [
            { id: 'w1', date: getLocalDateString(today), exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
            { id: 'w2', date: getLocalDateString(sixWeeksAgo), exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '200', reps: '10' }] }] }
        ];

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
        const expectChart = async (weeks: number, totalKg: number) => {
            await waitFor(() => {
                const canvas = screen.getByRole('img', { name: /Volume settimanale/i }) as HTMLCanvasElement;
                const chart = ChartJS.getChart(canvas);
                expect(chart?.data.labels).toHaveLength(weeks);
                const total = chart!.data.datasets[0].data.map(value => Number(value)).reduce((sum, value) => sum + value, 0);
                expect(total).toBe(totalKg);
            });
        };

        await expectChart(8, 3000);
        fireEvent.click(btn4);
        expect(btn4.getAttribute('aria-pressed')).toBe('true');
        expect(btn8.getAttribute('aria-pressed')).toBe('false');
        await expectChart(4, 1000);

        fireEvent.click(btn12);
        expect(btn12.getAttribute('aria-pressed')).toBe('true');
        expect(btn4.getAttribute('aria-pressed')).toBe('false');
        await expectChart(12, 3000);

        fireEvent.click(btn24);
        expect(btn24.getAttribute('aria-pressed')).toBe('true');
        expect(btn12.getAttribute('aria-pressed')).toBe('false');
        await expectChart(24, 3000);

        fireEvent.click(btn8);
        expect(btn8.getAttribute('aria-pressed')).toBe('true');
        expect(btn24.getAttribute('aria-pressed')).toBe('false');
        await expectChart(8, 3000);
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
        expect(await screen.findByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
        unmount();

        const referenceDate = new Date();
        referenceDate.setHours(12, 0, 0, 0);
        const weeklyDate = (weeksAgo: number) => {
            const date = new Date(referenceDate);
            date.setDate(date.getDate() - (weeksAgo * 7));
            return getLocalDateString(date.getTime());
        };
        const date3 = weeklyDate(3);
        const date2 = weeklyDate(2);
        const date1 = weeklyDate(1);

        const history: WorkoutSession[] = [
            { id: 'w1', date: date3, exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
            { id: 'w2', date: date2, exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '200', reps: '10' }] }] },
            { id: 'w3', date: date1, exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '300', reps: '10' }] }] }
        ];

        const nutrition: Record<string, NutritionDay> = {
            [date3]: { date: date3, kcal: 2000, carbs: 0, pro: 0, fat: 0 },
            [date2]: { date: date2, kcal: 2500, carbs: 0, pro: 0, fat: 0 },
            [date1]: { date: date1, kcal: 3000, carbs: 0, pro: 0, fat: 0 }
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
        expect(await screen.findByText(/Associazione positiva forte/i)).toBeDefined();
    });
});
