import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { activateGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY, invalidateSession, storageOwner } from '../src/lib/sync/session';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { DatedDraftConflictError, readFencedDatedDraft, readFencedDatedDraftImage, writeFencedDatedDraft, UnverifiedDatedDraftEpochError } from '../src/lib/sync/datedDraftEpoch';
import { mockFirebaseAuth } from './setup';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import { UserDataSchema } from '../src/lib/schema';
import type { SyncResult } from '../src/types';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
import { requireHealthConsentWritable } from '../src/lib/healthConsent';
const data = (nutrition = {}) => UserDataSchema.parse({ profile: { height: '180', gender: 'M' }, nutrition }) as any;
const day = (date: string, fields = {}) => ({ date, kcal: 0, pro: 0, carbs: 0, fat: 0, meals: [], ...fields });
const storeItem = vi.mocked(localStorage.setItem).getMockImplementation()!;
beforeEach(() => {
    vi.mocked(localStorage.setItem).mockImplementation(storeItem);
    localStorage.clear();
    // A real owner-scoped guest draft can only be written by a live guest session.
    // Preserve this production security contract in the hook fixtures.
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'dated-drafts-fixture');
    localStorage.removeItem(GUEST_REVOCATION_KEY);
    activateGuestSession('dated-drafts-fixture');
    useAppStore.getState().resetStore();
    useAppStore.setState({ userData: data(), dataOwner: storageOwner() });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('uses the fenced store owner without rereading lifecycle ownership on rerender', () => {
    const getItem = vi.spyOn(localStorage, 'getItem');
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    getItem.mockClear();

    hook.rerender();

    const lifecycleKeys = new Set(['logbook_is_guest', 'logbook_guest_migration_sync_recovery', 'logbook_authenticated_owner']);
    expect(getItem.mock.calls.some(([key]) => lifecycleKeys.has(String(key)))).toBe(false);
});

it('fails closed instead of inferring an owner when userData is not owner-fenced', () => {
    const owner = storageOwner();
    useAppStore.setState({ dataOwner: null });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    expect(hook.result.current.weight).toBe('');
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', owner))).toBeNull();
});

it('never bypasses the health-consent write gate when persisting a dated draft', () => {
    vi.mocked(requireHealthConsentWritable).mockImplementationOnce(() => {
        throw new Error('Consent suspended');
    });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    expect(hook.result.current.weight).toBe('75');
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', storageOwner()))).toBeNull();
    expect(useAppStore.getState().saveError).toContain('solo in memoria');
});

it('quarantines an old measurement draft after reacceptance instead of restaging erased data', () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const key = deviceKey('draft:measurement:2026-09-11', owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
    const original = JSON.stringify({ weight: '75', waist: '80' });
    localStorage.setItem(key, original);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    useAppStore.setState({ userData: data(), dataOwner: owner, localPersistenceBlocked: false });

    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.weight).toBe('');
    expect(hook.result.current.waist).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().saveError).toContain('generazione di consenso');
    act(() => hook.result.current.setWeight('90'));
    expect(hook.result.current.weight).toBe('');
    expect(localStorage.getItem(key)).toBe(original);
    expect(() => writeFencedDatedDraft('draft:measurement:2026-09-11', owner, null))
        .toThrow(UnverifiedDatedDraftEpochError);
    expect(() => writeFencedDatedDraft('draft:measurement:2026-09-11', owner, { weight: '90' }))
        .toThrow(UnverifiedDatedDraftEpochError);
    expect(localStorage.getItem(key)).toBe(original);
});

it('prevents a mounted old form from publishing stale health data after a cross-tab epoch change', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const name = 'draft:measurement:2026-09-11';
    const key = deviceKey(name, owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '1');
    const original = JSON.stringify({ weight: '75' });
    localStorage.setItem(key, original);
    useAppStore.setState({ userData: data(), dataOwner: owner, localPersistenceBlocked: false });
    const beforeData = useAppStore.getState().userData;
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.weight).toBe('75');

    // No rerender yet: a stale UI event handler still holds the old field values.
    localStorage.setItem(marker, '3');
    await act(async () => { await hook.result.current.calculateAndSave(); });
    expect(useAppStore.getState().userData).toEqual(beforeData);
    expect(localStorage.getItem(key)).toBe(original);

    hook.rerender();
    expect(hook.result.current.weight).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    act(() => hook.result.current.setWeight('80'));
    expect(localStorage.getItem(key)).toBe(original);
});

it('stamps a new measurement draft and fences it after the generation changes', () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const key = deviceKey('draft:measurement:2026-09-11', owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '3');
    useAppStore.setState({ userData: data(), dataOwner: owner, localPersistenceBlocked: false });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('77'));
    const raw = localStorage.getItem(key);
    expect(JSON.parse(raw!)).toMatchObject({
        __logbookDatedDraft: 1, owner, consentRevision: 3, values: { weight: '77' },
    });
    expect(readFencedDatedDraft('draft:measurement:2026-09-11', owner)?.weight).toBe('77');
    hook.unmount();
    localStorage.setItem(marker, '5');
    expect(() => readFencedDatedDraft('draft:measurement:2026-09-11', owner))
        .toThrow(UnverifiedDatedDraftEpochError);
    expect(localStorage.getItem(key)).toBe(raw);
});

it('rejects altered owner and revision in a stamped draft without replacing it', () => {
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const key = deviceKey('draft:measurement:2026-09-11', owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    const original = JSON.stringify({
        __logbookDatedDraft: 1, owner: 'user:foreign', consentRevision: 3,
        values: { weight: '80' },
    });
    localStorage.setItem(key, original);
    expect(() => readFencedDatedDraft('draft:measurement:2026-09-11', owner))
        .toThrow('Provenienza della bozza locale non valida');
    expect(() => writeFencedDatedDraft('draft:measurement:2026-09-11', owner, { weight: '81' }))
        .toThrow('Provenienza della bozza locale non valida');
    expect(localStorage.getItem(key)).toBe(original);
});

it('rejects stale replacement and cleanup of a dated draft in the same consent generation', () => {
    const owner = storageOwner();
    const name = 'draft:sleep:2026-09-11';
    const first = writeFencedDatedDraft(name, owner, { sleepHours: '08:00', sleepDeep: '02:00' }, null);
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(first);
    const second = writeFencedDatedDraft(name, owner, { sleepHours: '07:30', sleepDeep: '01:45' }, first);
    expect(second).not.toBe(first);

    expect(() => writeFencedDatedDraft(name, owner, { sleepHours: '06:00' }, first))
        .toThrow(DatedDraftConflictError);
    expect(() => writeFencedDatedDraft(name, owner, null, first))
        .toThrow(DatedDraftConflictError);
    expect(readFencedDatedDraftImage(name, owner)).toEqual({
        values: { sleepHours: '07:30', sleepDeep: '01:45' }, raw: second,
    });
});

it('blocks a stale mounted measurement form before edit or business dispatch, preserving the newer device record', async () => {
    const owner = storageOwner();
    const name = 'draft:measurement:2026-09-11';
    writeFencedDatedDraft(name, owner, { weight: '75' });
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const earlier = renderHook(() => useNutritionMeasurements('2026-09-11'));
    const stale = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(stale.result.current.weight).toBe('75');

    act(() => earlier.result.current.setWeight('76'));
    const currentRaw = readFencedDatedDraftImage(name, owner).raw;

    act(() => stale.result.current.setWaist('85'));
    expect(stale.result.current.waist).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().saveError).toMatch(/altra scheda/i);
    await act(async () => { await stale.result.current.calculateAndSave(); });
    expect(dispatch).not.toHaveBeenCalled();
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(currentRaw);
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('76');
    earlier.unmount();
    stale.unmount();
});

it('advances the observed image after consecutive edits and clears only its own committed draft', async () => {
    const owner = storageOwner();
    const name = 'draft:measurement:2026-09-11';
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    const first = readFencedDatedDraftImage(name, owner).raw;
    act(() => hook.result.current.setWeight('76'));
    const second = readFencedDatedDraftImage(name, owner).raw;
    expect(second).not.toBe(first);
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);

    await act(async () => { await hook.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
});

it('reads a new localStorage key before any write can copy the previous value over it', () => {
    localStorage.setItem('view-a', JSON.stringify('history')); localStorage.setItem('view-b', JSON.stringify('home'));
    const hook = renderHook(({ key }) => useLocalStorage(key, 'default'), { initialProps: { key: 'view-a' } });
    expect(hook.result.current[0]).toBe('history');
    hook.rerender({ key: 'view-b' }); expect(hook.result.current[0]).toBe('home');
    expect(localStorage.getItem('view-b')).toBe('"home"');
});
it('merges a partial stored draft with the latest remote source fields', () => {
    const owner = storageOwner();
    useAppStore.setState({
        userData: data({ '2026-09-10': day('2026-09-10', { weight: 90, waist: 80 }) }),
        dataOwner: owner,
    });
    localStorage.setItem(deviceKey('draft:measurement:2026-09-10', owner), JSON.stringify({ weight: '75' }));

    const hook = renderHook(() => useNutritionMeasurements('2026-09-10'));
    expect(hook.result.current.weight).toBe('75');
    expect(hook.result.current.waist).toBe('80');

    act(() => useAppStore.setState({
        userData: data({ '2026-09-10': day('2026-09-10', { weight: 90, waist: 81 }) }),
        dataOwner: owner,
    }));

    expect(hook.result.current.weight).toBe('75');
    expect(hook.result.current.waist).toBe('81');
});

it('keeps the default measurement time stable across unrelated rerenders', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 10, 15, 0));
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.measureTime).toBe('10:15');

    act(() => {
        vi.setSystemTime(new Date(2026, 8, 11, 10, 45, 0));
        useAppStore.setState({ userData: data({ '2026-09-11': day('2026-09-11', { kcal: 100 }) }), dataOwner: storageOwner() });
    });

    expect(hook.result.current.measureTime).toBe('10:15');
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
    // Start from a distinct owner; the shared suite normally uses an active guest.
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    useAppStore.setState({ userData: data(), dataOwner: 'user:previous-owner' });
    localStorage.setItem('draft_measurement', JSON.stringify({ weight: '99' }));
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.weight).toBe('');
    act(() => hook.result.current.setWeight('75'));
    const oldSetter = hook.result.current.setWeight;
    act(() => {
        localStorage.setItem('logbook_is_guest', 'true');
        invalidateSession();
        useAppStore.setState({ userData: data(), dataOwner: 'guest' });
    });
    hook.rerender(); expect(hook.result.current.weight).toBe('');
    act(() => oldSetter('88'));
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', 'guest'))).toBeNull();
    expect(localStorage.getItem('draft_measurement')).toContain('99');
});
it('rolls the implicit day at local midnight while preserving yesterday drafts', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 11, 23, 59, 59));
    const measurements = renderHook(() => useNutritionMeasurements());
    const sleep = renderHook(() => useSleepMeasurements());
    act(() => { measurements.result.current.setWeight('75'); sleep.result.current.setSleepHours('07:30'); });
    await act(async () => { vi.advanceTimersByTime(1100); });
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
it('clears the matching measurement draft after deletion without touching the rest of the day', async () => {
    useAppStore.setState({
        userData: data({
            '2026-09-11': day('2026-09-11', { weight: 80, waist: 85, sleepHours: '07:30', kcal: 2100 }),
        }),
    });
    vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWaist('84'));
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', storageOwner()))).toContain('84');

    await act(async () => { await hook.result.current.handleDeleteMeasurement('2026-09-11'); });

    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', storageOwner()))).toBeNull();
    const persisted = useAppStore.getState().userData?.nutrition?.['2026-09-11'];
    expect(persisted?.weight).toBeUndefined();
    expect(persisted?.waist).toBeUndefined();
    expect(persisted?.sleepHours).toBe('07:30');
    expect(persisted?.kcal).toBe(2100);
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
it('records body-fat provenance for manual and derived measurements', async () => {
    const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation')
        .mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);

    const manual = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => {
        manual.result.current.setWeight('80');
        manual.result.current.setManualBf('14.2');
    });
    await act(async () => { await manual.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'nutrition-day.patch',
        date: '2026-09-11',
        patch: expect.objectContaining({
            bf: 14.2,
            bfProvenance: { method: 'manual' },
        }),
    }));
    manual.unmount();

    dispatch.mockClear();
    const derived = renderHook(() => useNutritionMeasurements('2026-09-12'));
    act(() => {
        derived.result.current.setWeight('80');
        derived.result.current.setWaist('85');
        derived.result.current.setNeck('40');
    });
    await act(async () => { await derived.result.current.calculateAndSave(); });

    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'nutrition-day.patch',
        date: '2026-09-12',
        patch: expect.objectContaining({
            bfProvenance: expect.objectContaining({
                method: 'us_navy',
                inputs: expect.objectContaining({ heightCm: 180, waistCm: 85, neckCm: 40, gender: 'M' }),
            }),
        }),
    }));
});

