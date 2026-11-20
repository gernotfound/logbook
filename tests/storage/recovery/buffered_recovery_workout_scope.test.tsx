import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { captureSession } from '../../../src/lib/sync/session';
import { useAppStore } from '../../../src/store/useAppStore';
import { field, editor } from './bufferedRecoveryFixtures';

describe.each(['input', 'textarea'] as const)('workout-scoped buffered %s recovery', kind => {
    const firstId = 'workout-first';
    const secondId = 'workout-second';
    const name = (workoutId: string) => `draft:buffered:${kind}:${workoutId}:stable-draft`;
    const scoped = (workoutId: string, onChange: (value: string) => void, value = '') => (
        <BufferedWorkoutScope.Provider key={workoutId} value={workoutId}>
            {field(kind, onChange, value)}
        </BufferedWorkoutScope.Provider>
    );
    const activate = (workoutId: string) => {
        useAppStore.setState({ localWorkout: { id: workoutId } as WorkoutSession });
    };

    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({
            localWorkout: null,
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            syncPresentation: 'normal',
            saveError: null,
        });
    });

    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        vi.restoreAllMocks();
    });

    it('does not resurrect a same-consent unscoped legacy note in another workout', () => {
        const owner = captureSession().owner;
        const oldKey = deviceKey(`draft:buffered:${kind}:stable-draft`, owner);
        const oldRecord = JSON.stringify({
            __logbookBufferedDraft: 1, owner,
            name: `draft:buffered:${kind}:stable-draft`,
            consentRevision: 3, value: 'private value from a previous workout',
        });
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        localStorage.setItem(oldKey, oldRecord);

        activate(secondId);
        const onChange = vi.fn();
        const view = render(scoped(secondId, onChange, 'new workout value'));
        expect(editor().value).toBe('new workout value');
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(oldKey)).toBe(oldRecord);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        view.unmount();
    });

    it('does not replay a prior workout and does not flush its mounted input into the next workout', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const firstKey = protectedDeviceKey(name(firstId), owner);
        const secondKey = protectedDeviceKey(name(secondId), owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        activate(firstId);
        const firstChange = vi.fn();
        const secondChange = vi.fn();
        const view = render(scoped(firstId, firstChange));
        fireEvent.change(editor(), { target: { value: 'first workout secret' } });
        const firstRaw = localStorage.getItem(firstKey);
        expect(firstRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict(name(firstId), owner)!)).toMatchObject({
            __logbookBufferedDraft: 1, owner,
            name: name(firstId), consentRevision: 3, value: 'first workout secret',
        });

        // The old dirty field unmounts when a new workout takes over the same
        // React parent. Its cleanup must not mutate the next workout.
        activate(secondId);
        view.rerender(scoped(secondId, secondChange, 'fresh second workout'));
        expect(firstChange).not.toHaveBeenCalled();
        expect(secondChange).not.toHaveBeenCalled();
        expect(editor().value).toBe('fresh second workout');
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        expect(localStorage.getItem(secondKey)).toBeNull();

        fireEvent.change(editor(), { target: { value: 'second workout value' } });
        const secondRaw = localStorage.getItem(secondKey);
        expect(secondRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict(name(secondId), owner)!)).toMatchObject({
            name: name(secondId), value: 'second workout value',
        });
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        view.unmount();

        activate(firstId);
        const reopening = render(scoped(firstId, vi.fn()));
        expect(editor().value).toBe('first workout secret');
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        expect(localStorage.getItem(secondKey)).toBe(secondRaw);
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        reopening.unmount();
    });

    it('removes only the matching workout draft after parent confirms the same value', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const firstKey = protectedDeviceKey(name(firstId), owner);
        const secondKey = protectedDeviceKey(name(secondId), owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        activate(firstId);
        const onChange = vi.fn();
        const view = render(scoped(firstId, onChange));
        fireEvent.change(editor(), { target: { value: '6,5' } });
        const firstRaw = localStorage.getItem(firstKey);
        expect(firstRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        writeBufferedDraft(name(secondId), owner, 'different workout', '3');
        const otherValue = localStorage.getItem(secondKey);
        expect(otherValue).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledExactlyOnceWith(kind === 'input' ? '6.5' : '6,5');
        view.rerender(scoped(firstId, onChange, kind === 'input' ? '6.5' : '6,5'));
        expect(localStorage.getItem(firstKey)).toBeNull();
        expect(localStorage.getItem(secondKey)).toBe(otherValue);
        expect(readBufferedDraftSnapshot(name(secondId), owner).value).toBe('different workout');
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        expect(firstRaw).not.toBeNull();
        view.unmount();
    });
});
