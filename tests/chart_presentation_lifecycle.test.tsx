import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const tasks = vi.hoisted(() => ({ volume: vi.fn(), correlation: vi.fn() }));
vi.mock('../src/hooks/useAnalyticsWorker', () => ({ useAnalyticsWorker: () => ({ calculateVolumeStats: tasks.volume, calculateCorrelationStats: tasks.correlation }) }));
import WeeklyVolumeChart from '../src/components/analytics/WeeklyVolumeChart';
import VolumeCaloriesCorrelationChart from '../src/components/analytics/VolumeCaloriesCorrelationChart';

function deferred() {
    let resolve!: (value: any) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const empty = { points: [], stats: { hasData: false, percentageChange: null, correlationCoefficient: null, correlationInsight: '' } };
beforeEach(() => { tasks.volume.mockReset(); tasks.correlation.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('Chart presentation lifecycle', () => {
    it('ignores cancelled render results in StrictMode and accepts the current result', async () => {
        const volumeOld = deferred(); const volumeCurrent = deferred();
        const correlationOld = deferred(); const correlationCurrent = deferred();
        tasks.volume.mockReturnValueOnce(volumeOld.promise).mockReturnValue(volumeCurrent.promise);
        tasks.correlation.mockReturnValueOnce(correlationOld.promise).mockReturnValue(correlationCurrent.promise);
        const errors = vi.spyOn(console, 'error');
        render(<StrictMode><WeeklyVolumeChart /><VolumeCaloriesCorrelationChart /></StrictMode>);
        await act(async () => {
            volumeOld.reject(new Error('Worker terminated on unmount'));
            correlationOld.reject(new Error('Worker terminated on unmount'));
            volumeCurrent.resolve(empty); correlationCurrent.resolve(empty);
        });
        expect(errors).not.toHaveBeenCalled();
        expect(screen.queryByRole('status')).toBeNull();
        expect(tasks.volume).toHaveBeenCalledTimes(2);
        expect(tasks.correlation).toHaveBeenCalledTimes(2);
    });
    it('still reports a failure of the visible chart instead of hiding it', async () => {
        const result = deferred(); tasks.volume.mockReturnValue(result.promise);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<WeeklyVolumeChart />);
        const error = new Error('Invalid calculation result');
        await act(async () => result.reject(error));
        expect(errors).toHaveBeenCalledExactlyOnceWith('Errore calcolo grafico volume:', error);
        expect(screen.queryByRole('status')).toBeNull();
    });
});
