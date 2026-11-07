import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VolumeCaloriesCorrelationStats, WeeklyVolumeStats } from '../src/lib/calc/analytics';

const worker = vi.hoisted(() => {
    // Fixtures must satisfy the same result contract consumed by the charts.
    const volumeResult = {
        points: [],
        stats: {
            totalVolumeKg: 0,
            avgWeeklyVolumeKg: 0,
            currentWeekVolumeKg: 0,
            previousWeekVolumeKg: 0,
            percentageChange: null,
            peakWeekVolumeKg: 0,
            hasData: false,
            activeWeeksCount: 0,
            totalWorkouts: 0,
        } satisfies WeeklyVolumeStats,
    };
    const correlationResult = {
        points: [],
        stats: {
            hasData: false,
            correlationCoefficient: null,
            correlationInsight: 'Dati insufficienti nelle settimane selezionate.',
            avgWeeklyVolumeKg: 0,
            avgDailyKcal: 0,
            validDataPointsCount: 0,
        } satisfies VolumeCaloriesCorrelationStats,
    };
    return {
        post: vi.fn(),
        terminate: vi.fn(),
        fallback: vi.fn(() => volumeResult),
        cooperative: vi.fn(async () => volumeResult),
        correlation: vi.fn(() => correlationResult),
        cooperativeCorrelation: vi.fn(async () => correlationResult),
        volumeResult,
        correlationResult,
        instance: null as any,
    };
});
vi.mock('../src/workers/analytics.worker?worker', () => ({ default: class {
    postMessage = worker.post; terminate = worker.terminate; onerror: any; onmessage: any;
    constructor() { worker.instance = this; }
} }));
vi.mock('../src/lib/calc/analytics', async importOriginal => ({ ...await importOriginal<object>(), computeWeeklyVolumeSeries: worker.fallback, computeWeeklyVolumeSeriesCooperative: worker.cooperative, computeVolumeCaloriesCorrelation: worker.correlation, computeVolumeCaloriesCorrelationCooperative: worker.cooperativeCorrelation }));
import { useAnalyticsWorker } from '../src/hooks/useAnalyticsWorker';
beforeEach(() => { worker.post.mockReset(); worker.terminate.mockClear(); worker.fallback.mockClear(); worker.cooperative.mockClear(); worker.correlation.mockClear(); worker.cooperativeCorrelation.mockClear(); worker.instance = null; });
it('cancels an outstanding task on unmount without computing the synchronous fallback', async () => {
    const hook = renderHook(() => useAnalyticsWorker());
    const result = hook.result.current.calculateVolumeStats([], [], 80, 8).catch(error => error);
    hook.unmount();
    expect(await result).toBeInstanceOf(Error); expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.fallback).not.toHaveBeenCalled();
    await expect(hook.result.current.calculateVolumeStats([], [], 80, 8)).rejects.toThrow('annullato');
});
it('uses the fallback for a real worker failure while the view is still mounted', async () => {
    const hook = renderHook(() => useAnalyticsWorker());
    const result = hook.result.current.calculateVolumeStats([], [], 80, 8);
    await act(async () => { worker.instance.onerror(new Error('crash')); });
    expect(await result).toEqual(worker.volumeResult); expect(worker.fallback).toHaveBeenCalledTimes(1);
});

it('uses a production-shaped correlation fallback after a worker task error', async () => {
    const hook = renderHook(() => useAnalyticsWorker());
    const result = hook.result.current.calculateCorrelationStats([], {}, [], 80, 8);
    const request = worker.post.mock.lastCall?.[0];
    expect(request).toMatchObject({ type: 'CALCULATE_CORRELATION_STATS' });

    await act(async () => {
        worker.instance.onmessage({ data: { id: request.id, type: 'ERROR', error: 'correlation worker failure' } });
    });

    expect(await result).toEqual(worker.correlationResult);
    expect(worker.correlation).toHaveBeenCalledTimes(1);
    expect(worker.fallback).not.toHaveBeenCalled();
    hook.unmount();
});

it('does not resolve an old cooperative fallback after the view is reactivated', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    worker.cooperative.mockImplementationOnce(async () => {
        await gate;
        return worker.volumeResult;
    });
    const hook = renderHook(({ enabled }) => useAnalyticsWorker(enabled), { initialProps: { enabled: true } });
    const history = Array.from({ length: 513 }, (_, i) => ({ id: String(i), date: '2026-08-20', exercises: [] }));
    const prior = hook.result.current.calculateVolumeStats(history, [], 80, 8).then(
        () => 'unexpected success',
        (error: Error) => error.message,
    );
    await act(async () => { worker.instance.onerror(new Error('crash')); });
    expect(worker.cooperative).toHaveBeenCalledTimes(1);
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    await act(async () => { release(); await gate; });
    expect(await prior).toContain('annullato');
    hook.unmount();
});

it('ignores errors delivered by a previous terminated worker after reactivation', async () => {
    const hook = renderHook(({ enabled }) => useAnalyticsWorker(enabled), { initialProps: { enabled: true } });
    const oldWorker = worker.instance;
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    const currentWorker = worker.instance;
    const alreadyTerminated = worker.terminate.mock.calls.length;
    await act(async () => { oldWorker.onerror(new Error('stale worker error')); });
    expect(worker.terminate).toHaveBeenCalledTimes(alreadyTerminated);
    const pending = hook.result.current.calculateVolumeStats([], [], 80, 8);
    const id = worker.post.mock.calls[worker.post.mock.calls.length - 1][0].id;
    await act(async () => {
        currentWorker.onmessage({ data: { id, type: 'SUCCESS', result: worker.volumeResult } });
    });
    expect(await pending).toEqual(worker.volumeResult);
    expect(worker.fallback).not.toHaveBeenCalled();
    hook.unmount();
});

afterEach(() => { vi.useRealTimers(); });

it('terminates a stalled worker and resolves all pending tasks through one fallback each', async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useAnalyticsWorker());
    const first = hook.result.current.calculateVolumeStats([], [], 80, 8);
    const second = hook.result.current.calculateVolumeStats([], [], 80, 12);

    expect(worker.post).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(8000); });

    expect(await first).toEqual(worker.volumeResult);
    expect(await second).toEqual(worker.volumeResult);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.fallback).toHaveBeenCalledTimes(2);

    expect(await hook.result.current.calculateVolumeStats([], [], 80, 4)).toEqual(worker.volumeResult);
    expect(worker.post).toHaveBeenCalledTimes(2);
    expect(worker.fallback).toHaveBeenCalledTimes(3);
    hook.unmount();
});

it('does not run workers for hidden tabs and restarts safely on reactivation', async () => {
    const hook = renderHook(({ enabled }) => useAnalyticsWorker(enabled), { initialProps: { enabled: false } });
    await expect(hook.result.current.calculateVolumeStats([], [], 80, 8)).rejects.toThrow('annullato');
    expect(worker.post).not.toHaveBeenCalled();

    hook.rerender({ enabled: true });
    const pending = hook.result.current.calculateVolumeStats([], [], 80, 8).catch(error => error);
    expect(worker.post).toHaveBeenCalledTimes(1);
    hook.rerender({ enabled: false });
    expect(await pending).toBeInstanceOf(Error);
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    hook.rerender({ enabled: true });
    const second = hook.result.current.calculateVolumeStats([], [], 80, 8);
    await act(async () => {
        worker.instance.onmessage({
            data: {
                id: worker.post.mock.calls[worker.post.mock.calls.length - 1][0].id,
                type: 'SUCCESS',
                result: worker.volumeResult,
            },
        });
    });
    expect(await second).toEqual(worker.volumeResult);
    hook.unmount();
});

it('does not post another task to an analytics worker after it crashes', async () => {
    const hook = renderHook(() => useAnalyticsWorker());
    const first = hook.result.current.calculateVolumeStats([], [], 80, 8);
    await act(async () => { worker.instance.onerror(new Error('crash')); });
    expect(await first).toEqual(worker.volumeResult);
    const count = worker.post.mock.calls.length;
    expect(await hook.result.current.calculateVolumeStats([], [], 80, 12)).toEqual(worker.volumeResult);
    expect(worker.post).toHaveBeenCalledTimes(count);
    expect(worker.fallback).toHaveBeenCalledTimes(2);
    hook.unmount();
});

it('selects cooperative fallback for a large archive after worker failure', async () => {
    const largeHistory = Array.from({ length: 12_000 }, (_, i) => ({ id: `archive_${i}`, date: '2026-08-20', exercises: [] }));
    const hook = renderHook(() => useAnalyticsWorker());
    const result = hook.result.current.calculateVolumeStats(largeHistory, [], 80, 52);
    await act(async () => { worker.instance.onerror(new Error('crash')); });
    expect(await result).toEqual(worker.volumeResult);
    expect(worker.cooperative).toHaveBeenCalledTimes(1);
    expect(worker.fallback).not.toHaveBeenCalled();
    hook.unmount();
});
