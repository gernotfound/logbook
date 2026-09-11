import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const worker = vi.hoisted(() => ({ post: vi.fn(), terminate: vi.fn(), fallback: vi.fn(() => ({ points: [], stats: {} })), instance: null as any }));
vi.mock('../src/workers/analytics.worker?worker', () => ({ default: class {
    postMessage = worker.post; terminate = worker.terminate; onerror: any; onmessage: any;
    constructor() { worker.instance = this; }
} }));
vi.mock('../src/lib/calc/analytics', async importOriginal => ({ ...await importOriginal<object>(), computeWeeklyVolumeSeries: worker.fallback }));
import { useAnalyticsWorker } from '../src/hooks/useAnalyticsWorker';
beforeEach(() => { worker.post.mockReset(); worker.terminate.mockClear(); worker.fallback.mockClear(); });
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
    act(() => worker.instance.onerror(new Error('crash')));
    expect(await result).toEqual({ points: [], stats: {} }); expect(worker.fallback).toHaveBeenCalledTimes(1);
});
