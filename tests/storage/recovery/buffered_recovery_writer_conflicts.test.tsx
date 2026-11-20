import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot } from '../../../src/lib/sync/bufferedDraftEpoch';
import { createBufferedWriterIntentName, readBufferedWriterEvidence, writeBufferedWriterIntent } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { captureSession } from '../../../src/lib/sync/session';
import { requiredUpdateRecoveryRegistry } from '../../../src/lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { field, editor, initialGetItem, initialSetItem } from './bufferedRecoveryFixtures';

describe.each(['input', 'textarea'] as const)('concurrent same-workout %s drafts', kind => {
    const workoutId = 'same-workout';
    const draftName = `draft:buffered:${kind}:${workoutId}:stable-draft`;
    const mount = (update: (value: string) => void, value = '') => render(
        <BufferedWorkoutScope.Provider value={workoutId}>
            {field(kind, update, value)}
        </BufferedWorkoutScope.Provider>
    );
    const edited = (view: ReturnType<typeof render>) =>
        view.container.querySelector(kind === 'input' ? 'input' : 'textarea') as HTMLInputElement | HTMLTextAreaElement;

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        useAppStore.setState({
            localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', saveError: null,
        });
        const owner = captureSession().owner;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });

    it('rejects a new independent buffered witness before business flush or required-update capture', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const onChange = vi.fn();
        const view = mount(onChange);
        fireEvent.change(edited(view), { target: { value: 'Current input' } });
        const original = readBufferedDraftSnapshot(draftName, owner).raw;
        const sealedKey = protectedDeviceKey(draftName, owner);
        const originalCiphertext = localStorage.getItem(sealedKey);
        expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
        const contender = createBufferedWriterIntentName();
        writeBufferedWriterIntent(contender, owner, draftName, 'Competing private copy', null, '3');
        const competingKey = protectedDeviceKey(contender, owner);
        const competingCiphertext = localStorage.getItem(competingKey);
        expect(competingCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(2);
        expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow(AggregateError);
        fireEvent.blur(edited(view));
        expect(onChange).not.toHaveBeenCalled();
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(original);
        expect(localStorage.getItem(sealedKey)).toBe(originalCiphertext);
        expect(localStorage.getItem(competingKey)).toBe(competingCiphertext);
        expect(readBufferedWriterEvidence(owner, draftName).map(copy => copy.value).sort())
            .toEqual(['Competing private copy', 'Current input']);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        view.unmount();
    });

    it('rejects a second stale editor before overwriting a newer draft in the same consent revision', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const key = deviceKey(draftName, owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const first = mount(firstCallback);
        const second = mount(secondCallback);
        fireEvent.change(edited(first), { target: { value: 'First author private value' } });
        const original = readBufferedDraftSnapshot(draftName, owner).raw;
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(original!)).toMatchObject({
            __logbookBufferedDraft: 1, owner, name: draftName,
            consentRevision: 3, value: 'First author private value',
        });
        fireEvent.change(edited(second), { target: { value: 'Stale author conflicting value' } });
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(original);
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(localStorage.getItem(key)).toBeNull();
        const witnesses = readBufferedWriterEvidence(owner, draftName);
        expect(witnesses.map(witness => witness.value).sort()).toEqual([
            'First author private value', 'Stale author conflicting value',
        ]);
        expect(witnesses.every(witness => localStorage.getItem(protectedDeviceKey(witness.name, owner))?.startsWith('tlb-sealed:v1:'))).toBe(true);
        expect(witnesses.every(witness => localStorage.getItem(deviceKey(witness.name, owner)) === null)).toBe(true);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        fireEvent.blur(edited(second));
        expect(secondCallback).not.toHaveBeenCalled();
        expect(firstCallback).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
        first.unmount();
        second.unmount();
    });

    it('preserves the newer copy when an old parent acknowledges a previously flushed value', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const key = deviceKey(draftName, owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const olderCallback = vi.fn();
        const newerCallback = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const oldView = mount(olderCallback);
        fireEvent.change(edited(oldView), { target: { value: 'Old value' } });
        fireEvent.blur(edited(oldView));
        expect(olderCallback).toHaveBeenCalledExactlyOnceWith('Old value');

        // A second tab loads exactly the first tab's durable draft, edits it,
        // then the first tab receives a delayed acknowledgement for OLD data.
        const newView = mount(newerCallback);
        fireEvent.change(edited(newView), { target: { value: 'Newer value' } });
        const newerRaw = readBufferedDraftSnapshot(draftName, owner).raw;
        const newerCiphertext = localStorage.getItem(sealedKey);
        expect(newerCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(newerRaw!)).toMatchObject({ value: 'Newer value' });
        oldView.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, olderCallback, 'Old value')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(newerRaw);
        expect(localStorage.getItem(sealedKey)).toBe(newerCiphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        expect(newerCallback).not.toHaveBeenCalled();
        oldView.unmount();
        newView.unmount();
    });

    it('allows one editor to revise its own saved draft repeatedly and clear only on acknowledgement', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const key = deviceKey(draftName, owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const update = vi.fn();
        const view = mount(update);
        fireEvent.change(edited(view), { target: { value: 'A' } });
        const firstCiphertext = localStorage.getItem(sealedKey);
        expect(firstCiphertext).toMatch(/^tlb-sealed:v1:/);
        fireEvent.change(edited(view), { target: { value: 'B' } });
        const raw = readBufferedDraftSnapshot(draftName, owner).raw;
        const secondCiphertext = localStorage.getItem(sealedKey);
        expect(secondCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(secondCiphertext).not.toBe(firstCiphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(raw!)).toMatchObject({ value: 'B' });
        fireEvent.blur(edited(view));
        expect(update).toHaveBeenCalledExactlyOnceWith('B');
        view.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, update, 'B')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(0);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });
});
