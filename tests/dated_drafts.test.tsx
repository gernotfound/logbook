import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { invalidateSession, storageOwner } from '../src/lib/sync/session';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import { UserDataSchema } from '../src/lib/schema';
import type { SyncResult } from '../src/types';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
const data = (nutrition = {}) => UserDataSchema.parse({ profile: { height: '180', gender: 'M' }, nutrition }) as any;
const day = (date: string, fields = {}) => ({ date, kcal: 0, pro: 0, carbs: 0, fat: 0, meals: [], ...fields });
const storeItem = vi.mocked(localStorage.setItem).getMockImplementation()!;
beforeEach(() => { vi.mocked(localStorage.setItem).mockImplementation(storeItem); localStorage.clear(); useAppStore.getState().resetStore(); useAppStore.setState({ userData: data() }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('reads a new localStorage key before any write can copy the previous value over it', () => {
    localStorage.setItem('view-a', JSON.stringify('history')); localStorage.setItem('view-b', JSON.stringify('home'));
    const hook = renderHook(({ key }) => useLocalStorage(key, 'default'), { initialProps: { key: 'view-a' } });
    expect(hook.result.current[0]).toBe('history');
    hook.rerender({ key: 'view-b' }); expect(hook.result.current[0]).toBe('home');
    expect(localStorage.getItem('view-b')).toBe('"home"');
});
it('keeps edited measurements across remote hydration, remount and date navigation', () => {
    const hook = renderHook(({ date }) => useNutritionMeasurements(date), { initialProps: { date: '2026-09-10' } });
    act(() => { hook.result.current.setWeight('75'); hook.result.current.setWaist('80'); });
    expect(hook.result.current.weight).toBe('75'); expect(hook.result.current.waist).toBe('80');
    act(() => useAppStore.setState({ userData: data({ '2026-09-10': day('2026-09-10', { weight: 90 }) }) }));
    expect(hook.result.current.weight).toBe('75');
    hook.rerender({ date: '2026-09-11' }); expect(hook.result.current.weight).toBe('');
    act(() => hook.result.current.setWeight('76'));
    hook.rerender({ date: '2026-09-10' }); expect(hook.result.current.weight).toBe('75');
    hook.unmount();
    const reopened = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(reopened.result.current.weight).toBe('76');
});
it('does not attach legacy drafts or another owner draft to a new session', () => {
    localStorage.setItem('draft_measurement', JSON.stringify({ weight: '99' }));
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.weight).toBe('');
    act(() => hook.result.current.setWeight('75'));
    const oldSetter = hook.result.current.setWeight;
    act(() => { localStorage.setItem('logbook_is_guest', 'true'); invalidateSession(); });
    hook.rerender(); expect(hook.result.current.weight).toBe('');
    act(() => oldSetter('88'));
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', 'guest'))).toBeNull();
    expect(localStorage.getItem('draft_measurement')).toContain('99');
});
it('rolls the implicit day at local midnight while preserving yesterday drafts', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 11, 23, 59, 59));
    const measurements = renderHook(() => useNutritionMeasurements());
    const sleep = renderHook(() => useSleepMeasurements());
    act(() => { measurements.result.current.setWeight('75'); sleep.result.current.setSleepHours('07:30'); });
    act(() => vi.advanceTimersByTime(1100));
    expect(measurements.result.current.targetDateStr).toBe('2026-09-12');
    expect(measurements.result.current.weight).toBe('');
    expect(sleep.result.current.selectedDate).toBe('2026-09-12');
    expect(sleep.result.current.sleepHours).toBe('');
    expect(localStorage.getItem(deviceKey('draft:sleep:2026-09-11'))).toContain('07:30');
});
it('preserves a dirty sleep form when an unrelated meal is received', () => {
    const hook = renderHook(() => useSleepMeasurements());
    act(() => hook.result.current.setSleepHours('07:30'));
    act(() => useAppStore.setState({ userData: data({ [hook.result.current.selectedDate]: day(hook.result.current.selectedDate, { sleepHours: '08:00', kcal: 2000 }) }) }));
    expect(hook.result.current.sleepHours).toBe('07:30');
});
it('keeps the in-memory draft and blocks strict reload when storage writes fail', () => {
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => hook.result.current.setWeight('75'));
    expect(hook.result.current.weight).toBe('75');
    expect(useAppStore.getState().saveError).toContain('solo in memoria');
    expect(() => draftRegistry.flushAll({ strict: true })).toThrow('bozze');
});
it('rejects invalid and nonfinite numbers without saving or deleting the draft', async () => {
    const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation');
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    for (const value of ['Infinity', '75kg', '-1']) {
        act(() => hook.result.current.setWeight(value));
        await act(async () => { await hook.result.current.calculateAndSave(); });
        expect(hook.result.current.weight).toBe(value);
    }
    expect(dispatch).not.toHaveBeenCalled();
});
it('does not execute deletion after the account changes while confirmation is open', async () => {
    let answer!: (value: boolean) => void;
    vi.spyOn(useDialogStore.getState(), 'showConfirm').mockReturnValue(new Promise(resolve => { answer = resolve; }));
    const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation');
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    const task = hook.result.current.handleDeleteMeasurement('2026-09-11');
    act(() => { invalidateSession(); answer(true); });
    await act(async () => { await task; });
    expect(dispatch).not.toHaveBeenCalled();
});
it('retains a newer edit and rejects double submission while a save is pending', async () => {
    let finish!: () => void;
    const pending = new Promise<SyncResult>(resolve => { finish = () => resolve({ ok: true, status: 'synced' }); });
    const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation').mockReturnValue(pending);
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    const first = hook.result.current.calculateAndSave();
    await hook.result.current.calculateAndSave();
    act(() => hook.result.current.setWeight('76'));
    await act(async () => { finish(); await first; });
    expect(dispatch).toHaveBeenCalledTimes(1); expect(hook.result.current.weight).toBe('76');
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', storageOwner()))).toContain('76');
});
