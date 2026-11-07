import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WeeklyVolumeChart from '../src/components/analytics/WeeklyVolumeChart';
import VolumeCaloriesCorrelationChart from '../src/components/analytics/VolumeCaloriesCorrelationChart';

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
    worker.calculateVolumeStats
      .mockResolvedValueOnce({
        points: [{ label: 'Week A', weekStart: '2026-11-02', weekEnd: '2026-11-08', volumeKg: 1200, workoutCount: 1 }],
        stats: { hasData: true, currentWeekVolumeKg: 1200, avgWeeklyVolumeKg: 1200, percentageChange: null },
      })
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
    worker.calculateCorrelationStats
      .mockResolvedValueOnce({
        points: [{ label: 'Week A', weekStart: '2026-11-02', weekEnd: '2026-11-08', volumeKg: 1200, avgDailyKcal: 2100, loggedNutritionDays: 7, workoutCount: 1 }],
        stats: { hasData: true, correlationCoefficient: 0.8, correlationInsight: 'Associazione osservata', avgWeeklyVolumeKg: 1200, avgDailyKcal: 2100, validDataPointsCount: 1 },
      })
      .mockRejectedValueOnce(new Error('Worker and fallback failed'));
    render(<VolumeCaloriesCorrelationChart />);
    await screen.findByText(/Associazione osservata/);
    fireEvent.click(screen.getByRole('button', { name: '4 sett' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Impossibile aggiornare'));
    expect(screen.queryByText(/Associazione osservata/)).toBeNull();
    expect(screen.queryByText(/r =/)).toBeNull();
    expect(screen.queryByRole('img', { name: /Volume e calorie/ })).toBeNull();
  });
});
