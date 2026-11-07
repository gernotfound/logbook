import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WeeklyVolumeChart from '../src/components/analytics/WeeklyVolumeChart';
import VolumeCaloriesCorrelationChart from '../src/components/analytics/VolumeCaloriesCorrelationChart';
import {
  generateWeekIntervals,
  type computeWeeklyVolumeSeries,
  type computeVolumeCaloriesCorrelation,
} from '../src/lib/calc/analytics';

const worker = vi.hoisted(() => ({
  calculateVolumeStats: vi.fn(),
  calculateCorrelationStats: vi.fn(),
}));

vi.mock('../src/hooks/useAnalyticsWorker', () => ({
  useAnalyticsWorker: () => worker,
}));

describe('analytics chart failure isolation', () => {
  beforeEach(() => {
    worker.calculateVolumeStats.mockReset();
    worker.calculateCorrelationStats.mockReset();
  });

  it('hides the previous volume when the newly requested period fails', async () => {
    const result = {
      points: generateWeekIntervals(8, '2026-11-07').map(({ weekIndex, weekStart, weekEnd, label }, index) => ({
        weekIndex, weekStart, weekEnd, label,
        volumeKg: index === 7 ? 1200 : 0,
        volumeTon: index === 7 ? 1.2 : 0,
        workoutCount: index === 7 ? 1 : 0,
        sessionIds: index === 7 ? ['workout-a'] : [],
      })),
      stats: {
        hasData: true, totalVolumeKg: 1200, avgWeeklyVolumeKg: 150,
        currentWeekVolumeKg: 1200, previousWeekVolumeKg: 0,
        percentageChange: null, peakWeekVolumeKg: 1200,
        activeWeeksCount: 1, totalWorkouts: 1,
      },
    } satisfies ReturnType<typeof computeWeeklyVolumeSeries>;
    worker.calculateVolumeStats
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('Worker and fallback failed'));
    render(<WeeklyVolumeChart />);
    await screen.findByText(/Attuale:/);
    fireEvent.click(screen.getByRole('button', { name: '4 sett' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Impossibile aggiornare');
    expect(screen.queryByText(/Attuale:/)).toBeNull();
    expect(screen.queryByRole('img', { name: /Volume settimanale/ })).toBeNull();
  });

  it('hides the previous correlation and coefficient when a later period fails', async () => {
    const volumes = [0, 0, 0, 0, 0, 1200, 1600, 2000];
    const calories = [0, 0, 0, 0, 0, 1900, 2100, 2100];
    const insight = 'Associazione positiva forte osservata nelle settimane disponibili. Non indica un rapporto di causa-effetto.';
    const result = {
      points: generateWeekIntervals(8, '2026-11-07').map(({ weekIndex, weekStart, weekEnd, label }, index) => {
        const volumeKg = volumes[index] ?? 0;
        const avgDailyKcal = calories[index] ?? 0;
        return {
          weekIndex, weekStart, weekEnd, label,
          volumeKg, volumeTon: volumeKg / 1000, avgDailyKcal,
          loggedNutritionDays: avgDailyKcal > 0 ? 1 : 0,
          workoutCount: volumeKg > 0 ? 1 : 0,
        };
      }),
      stats: {
        hasData: true, correlationCoefficient: 0.87, correlationInsight: insight,
        avgWeeklyVolumeKg: 600, avgDailyKcal: 2033, validDataPointsCount: 3,
      },
    } satisfies ReturnType<typeof computeVolumeCaloriesCorrelation>;
    worker.calculateCorrelationStats
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('Worker and fallback failed'));
    render(<VolumeCaloriesCorrelationChart />);
    await screen.findByText(/Associazione positiva forte osservata/);
    expect(screen.getByText('r = +0.87')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '4 sett' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Impossibile aggiornare'));
    expect(screen.queryByText(/Associazione positiva forte osservata/)).toBeNull();
    expect(screen.queryByText(/r =/)).toBeNull();
    expect(screen.queryByRole('img', { name: /Volume e calorie/ })).toBeNull();
  });
});
