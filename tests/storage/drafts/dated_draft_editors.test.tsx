import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import DataView from '../../../src/components/Data/DataView';
import { describe, expect, it, vi } from 'vitest';
import { useNutritionMeasurements } from '../../../src/hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../../../src/hooks/useSleepMeasurements';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { invalidateSession, storageOwner } from '../../../src/lib/sync/session';
import { deviceKey, protectedDeviceKey } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readFencedDatedDraft, readFencedDatedDraftImage, writeFencedDatedDraft } from '../../../src/lib/sync/datedDraftEpoch';
import { readDatedWriterEvidence } from '../../../src/lib/sync/datedDraftWriterIntent';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import type { DataSubTab, SyncResult } from '../../../src/types';
import { useLocalStorage } from '../../../src/hooks/useLocalStorage';
import { z } from 'zod';
import { installDatedDraftFixtures, data, day } from './datedDraftFixtures';

installDatedDraftFixtures();

describe('Measurement and sleep editor lifecycle', () => {
it('reads a new localStorage key before any write can copy the previous value over it', () => {
    localStorage.setItem('view-a', JSON.stringify('history')); localStorage.setItem('view-b', JSON.stringify('home'));
    const hook = renderHook(({ key }) => useLocalStorage(key, 'default', z.string()), { initialProps: { key: 'view-a' } });
    expect(hook.result.current[0]).toBe('history');
    hook.rerender({ key: 'view-b' }); expect(hook.result.current[0]).toBe('home');
    expect(localStorage.getItem('view-b')).toBe('"home"');
});
it('merges a partial stored draft with the latest remote source fields', async () => {
    const owner = storageOwner();
    useAppStore.setState({
        userData: data({ '2026-09-10': day('2026-09-10', { weight: 90, waist: 80 }) }),
        dataOwner: owner,
    });
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-10';
    const draftImage = writeFencedDatedDraft(name, owner, { weight: '75' });
    const ciphertext = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();

    const hook = renderHook(() => useNutritionMeasurements('2026-09-10'));
    expect(hook.result.current.weight).toBe('75');
    expect(hook.result.current.waist).toBe('80');

    act(() => useAppStore.setState({
        userData: data({ '2026-09-10': day('2026-09-10', { weight: 90, waist: 81 }) }),
        dataOwner: owner,
    }));

    expect(hook.result.current.weight).toBe('75');
    expect(hook.result.current.waist).toBe('81');
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(draftImage);
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertext);
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

it('keeps edited measurements across remote hydration, remount and date navigation', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const firstName = 'draft:measurement:2026-09-10';
    const secondName = 'draft:measurement:2026-09-11';
    const hook = renderHook(({ date }) => useNutritionMeasurements(date), { initialProps: { date: '2026-09-10' } });
    act(() => { hook.result.current.setWeight('75'); hook.result.current.setWaist('80'); });
    expect(hook.result.current.weight).toBe('75'); expect(hook.result.current.waist).toBe('80');
    const firstSealed = localStorage.getItem(protectedDeviceKey(firstName, owner));
    expect(firstSealed).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(firstName, owner))).toBeNull();
    act(() => useAppStore.setState({ userData: data({ '2026-09-10': day('2026-09-10', { weight: 90 }) }) }));
    expect(hook.result.current.weight).toBe('75');
    hook.rerender({ date: '2026-09-11' }); expect(hook.result.current.weight).toBe('');
    act(() => hook.result.current.setWeight('76'));
    hook.rerender({ date: '2026-09-10' }); expect(hook.result.current.weight).toBe('75');
    hook.unmount();
    const secondSealed = localStorage.getItem(protectedDeviceKey(secondName, owner));
    expect(secondSealed).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(secondName, owner))).toBeNull();
    const reopened = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(reopened.result.current.weight).toBe('76');
    expect(readFencedDatedDraft(secondName, owner)?.weight).toBe('76');
    expect(localStorage.getItem(protectedDeviceKey(firstName, owner))).toBe(firstSealed);
    expect(localStorage.getItem(protectedDeviceKey(secondName, owner))).toBe(secondSealed);
    reopened.unmount();
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
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 11, 23, 59, 59));
    const measurements = renderHook(() => useNutritionMeasurements());
    const sleep = renderHook(() => useSleepMeasurements());
    act(() => { measurements.result.current.setWeight('75'); sleep.result.current.setSleepHours('07:30'); });
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(measurements.result.current.targetDateStr).toBe('2026-09-12');
    expect(measurements.result.current.weight).toBe('');
    expect(sleep.result.current.selectedDate).toBe('2026-09-12');
    expect(sleep.result.current.sleepHours).toBe('');
    const name = 'draft:sleep:2026-09-11';
    const ciphertext = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(readFencedDatedDraft(name, owner)?.sleepHours).toBe('07:30');
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertext);
});
it('preserves a dirty sleep form when an unrelated meal is received', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const hook = renderHook(() => useSleepMeasurements());
    const name = 'draft:sleep:' + hook.result.current.selectedDate;
    act(() => hook.result.current.setSleepHours('07:30'));
    act(() => useAppStore.setState({ userData: data({ [hook.result.current.selectedDate]: day(hook.result.current.selectedDate, { sleepHours: '08:00', kcal: 2000 }) }) }));
    expect(hook.result.current.sleepHours).toBe('07:30');
    expect(readFencedDatedDraft(name, owner)?.sleepHours).toBe('07:30');
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    hook.unmount();
});
it('leaves the sleep historical editor accessible but closes it after measurement edit cancellation', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0));
    const historicalDay = '2026-10-04';
    useAppStore.setState({
        userData: data({ [historicalDay]: day(historicalDay, { weight: 80, sleepHours: '07:30' }) }),
        dataOwner: owner,
    });
    const Harness = () => {
        const [tab, setTab] = useState<DataSubTab>('history');
        return <DataView subTab={tab} setSubTab={setTab} />;
    };
    const view = render(<Harness />);
    await act(async () => { await import('../../../src/components/Data/DataHistory'); });
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica misurazione' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sonno' }));
    expect(screen.getByRole('heading', { name: 'Modifica sonno' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Giorno precedente' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('tab', { name: 'Misurazioni' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(view.container.querySelector('#data-panel-history')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Sonno' }));
    expect(screen.getByRole('heading', { name: 'Dati sonno' })).toBeDefined();
    const previous = screen.getByRole('button', { name: 'Giorno precedente' });
    expect(previous).toHaveProperty('disabled', false);
    fireEvent.click(previous);
    expect(screen.getByRole('heading', { name: 'Dati sonno' })).toBeDefined();
    view.unmount();
});

it('stays in the measurement editor when draft cancellation fails and navigates only after retry', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0));
    const date = '2026-10-05';
    const name = 'draft:measurement:' + date;
    useAppStore.setState({ userData: data({ [date]: day(date, { weight: 80 }) }), dataOwner: owner });

    const Harness = () => {
        const [tab, setTab] = useState<DataSubTab>('history');
        return <DataView subTab={tab} setSubTab={setTab} />;
    };
    const view = render(<Harness />);
    await act(async () => { await import('../../../src/components/Data/DataHistory'); });
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica misurazione' }));
    expect(view.container.querySelector('#data-panel-measurements')).not.toBeNull();
    const weight = view.container.querySelector('#measure-weight') as HTMLInputElement;
    fireEvent.change(weight, { target: { value: '79' } });
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('79');
    const before = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(before).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();

    const originalSetItem = vi.mocked(localStorage.setItem).getMockImplementation()!;
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
        if (key === protectedDeviceKey(name, owner)) throw new Error('quota');
        originalSetItem(key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(view.container.querySelector('#data-panel-measurements')).not.toBeNull();
    expect(view.container.querySelector('#data-panel-history')).toBeNull();
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('79');
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(before);

    vi.mocked(localStorage.setItem).mockImplementation(originalSetItem);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(view.container.querySelector('#data-panel-history')).not.toBeNull();
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    const cleared = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(cleared).toMatch(/^tlb-sealed:v1:/);
    expect(cleared).not.toBe(before);
    expect(readFencedDatedDraftImage(name, owner).raw).toContain('"values":null');
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    view.unmount();
});

it('keeps the in-memory draft and blocks strict reload when storage writes fail', async () => {
    await prepareUnlockedTestArchive(storageOwner());
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => hook.result.current.setWeight('75'));
    expect(hook.result.current.weight).toBe('75');
    expect(useAppStore.getState().saveError).toContain('solo in memoria');
    expect(() => draftRegistry.flushAll({ strict: true })).toThrow('bozze');
});
it('rejects invalid and nonfinite numbers without saving or deleting the draft', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation');
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    const name = 'draft:measurement:2026-09-11';
    const key = deviceKey(name, owner);
    const sealedKey = protectedDeviceKey(name, owner);
    for (const value of ['Infinity', '75kg', '-1']) {
        act(() => hook.result.current.setWeight(value));
        const before = readFencedDatedDraftImage(name, owner);
        const evidence = readDatedWriterEvidence(owner, name);
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        expect(before.values?.weight).toBe(value);
        expect(evidence.some(writer => writer.values.weight === value)).toBe(true);

        await act(async () => { await hook.result.current.calculateAndSave(); });
        expect(hook.result.current.weight).toBe(value);
        expect(readFencedDatedDraftImage(name, owner)).toEqual(before);
        expect(readDatedWriterEvidence(owner, name)).toEqual(evidence);
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(localStorage.getItem(key)).toBeNull();
    }
    expect(dispatch).not.toHaveBeenCalled();
    hook.unmount();
    const reopened = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(reopened.result.current.weight).toBe('-1');
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('-1');
    reopened.unmount();
});
it('clears the matching measurement draft after deletion without touching the rest of the day', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    useAppStore.setState({
        userData: data({
            '2026-09-11': day('2026-09-11', { weight: 80, waist: 85, sleepHours: '07:30', kcal: 2100 }),
        }),
    });
    vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWaist('84'));
    const before = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(before).toMatch(/^tlb-sealed:v1:/);
    expect(readFencedDatedDraft(name, owner)?.waist).toBe('84');
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();

    await act(async () => { await hook.result.current.handleDeleteMeasurement('2026-09-11'); });

    const deletedDraft = readFencedDatedDraftImage(name, owner);
    expect(deletedDraft.values).toBeNull();
    expect(deletedDraft.raw).toContain('"values":null');
    const tombstone = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(tombstone).toMatch(/^tlb-sealed:v1:/);
    expect(tombstone).not.toBe(before);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
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
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
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
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('76');
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
});
it('records optional US Navy provenance without manual BF entry', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const weightOnlyName = 'draft:measurement:2026-09-11';
    const derivedName = 'draft:measurement:2026-09-12';
    const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation')
        .mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);

    const weightOnly = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => weightOnly.result.current.setWeight('80'));
    await act(async () => { await weightOnly.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'nutrition-day.patch',
        date: '2026-09-11',
        patch: expect.objectContaining({ bf: undefined, bfProvenance: undefined }),
    }));
    expect(readFencedDatedDraftImage(weightOnlyName, owner).raw).toContain('"values":null');
    expect(localStorage.getItem(protectedDeviceKey(weightOnlyName, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(weightOnlyName, owner))).toBeNull();
    weightOnly.unmount();

    dispatch.mockClear();
    const derived = renderHook(() => useNutritionMeasurements('2026-09-12'));
    act(() => {
        derived.result.current.setWeight('80');
        derived.result.current.setWaist('85');
        derived.result.current.setNeck('40');
    });
    await act(async () => { await derived.result.current.calculateAndSave(undefined, true); });
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
    expect(readFencedDatedDraftImage(derivedName, owner).raw).toContain('"values":null');
    expect(localStorage.getItem(protectedDeviceKey(derivedName, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(derivedName, owner))).toBeNull();
    derived.unmount();
});


it('does not sort measurement history while its section is inactive, and restores it on demand', () => {
    const records = {
        '2026-09-12': day('2026-09-12', { weight: '82' }),
        '2026-09-13': day('2026-09-13', { weight: '83' }),
    };
    useAppStore.setState({ userData: data(records), dataOwner: storageOwner() });
    const hook = renderHook(({ visible }) => useNutritionMeasurements('2026-09-11', visible), {
        initialProps: { visible: false },
    });
    expect(hook.result.current.measurementsHistory).toEqual([]);
    hook.rerender({ visible: true });
    expect(hook.result.current.measurementsHistory.map(item => item.date)).toEqual(['2026-09-13', '2026-09-12']);
    hook.rerender({ visible: false });
    expect(hook.result.current.measurementsHistory).toEqual([]);
});
});
