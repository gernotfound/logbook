import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { UserDataSchema } from '../src/lib/schema';
import type { UserData, WorkoutSession } from '../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../src/lib/sync/deviceStorage';
import { persistPlainWorkoutSnapshot, unwrapWorkoutDeviceSnapshot } from '../src/lib/sync/workoutDeviceIntent';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { writeWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { readWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import { BrowserStorageError } from '../src/lib/sync/browserStorage';
import { localStorageMock } from './setup';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import PreSessionCheckIn from '../src/components/Training/PreSessionCheckIn';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { captureSession } from '../src/lib/sync/session';
import { initializeLocal } from '../src/lib/sync/localRepository';

const parseUserData = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;
let owner: string;

function workout(id: string, reps = '8'): WorkoutSession {
    return {
        id,
        date: '2026-10-05',
        routineName: 'Audit 18',
        exercises: [{
            id: 'se-bench',
            exId: 'bench',
            sessionNote: '',
            sets: [{ id: 's-bench', kg: '80', reps }],
        }],
    };
}

describe('Audit 18 device-critical persistence', () => {
    beforeEach(async () => {
        localStorage.clear();
        owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        vi.clearAllMocks();
        useAppStore.setState({
            userData: parseUserData({ activeWorkout: workout('w-current') }),
            dataOwner: owner,
            localWorkout: workout('w-current'),
            localPersistenceBlocked: false,
            syncing: false,
            syncHealth: 'synced',
            syncPresentation: 'normal',
            saveError: null,
        });
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['SecurityError', 'blocked'],
        ['QuotaExceededError', 'full'],
    ])('does not publish a workout edit when the device write fails with %s', async (name, message) => {
        // The first durable edit write is now the immutable AEAD witness;
        // failing it must prevent both shared-snapshot publication and IDB.
        localStorageMock.setItem.mockImplementationOnce(() => {
            throw new DOMException(message, name);
        });

        const next = workout('w-current', '9');
        await expect(useAppStore.getState().setSyncedLocalWorkout(next)).rejects.toBeInstanceOf(BrowserStorageError);

        expect(useAppStore.getState().localWorkout?.exercises[0].sets[0].reps).toBe('8');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(useAppStore.getState().saveError).toContain('Impossibile salvare l’allenamento');
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toBeNull();
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
    });

    it('does not let a one-shot read failure replace a newer device workout with an older IndexedDB fallback', () => {
        const key = deviceKey('workout', owner);
        const sealedKey = protectedDeviceKey('workout', owner);
        persistPlainWorkoutSnapshot(workout('device-new', '10'), owner);
        const originalCiphertext = localStorage.getItem(sealedKey);
        expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
        localStorageMock.setItem.mockClear();
        const fallback = workout('envelope-old', '6');

        localStorageMock.getItem.mockImplementationOnce((readKey: string) => {
            if (readKey === key) throw new DOMException('blocked', 'SecurityError');
            return null;
        });

        expect(() => getInitialLocalWorkout(owner, fallback)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorage.getItem(sealedKey)).toBe(originalCiphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(unwrapWorkoutDeviceSnapshot(JSON.parse(readDeviceValueStrict('workout', owner)!), owner).workout)
            .toEqual(workout('device-new', '10'));
    });

    it('does not reinterpret an unreadable running timer as stopped', () => {
        const key = deviceKey('timer', owner);
        const sealedKey = protectedDeviceKey('timer', owner);
        const running = { version: 1 as const, state: 'running' as const, startTime: 1000, accumulated: 250 };
        writeWorkoutTimerSnapshot(running, owner);
        const originalCiphertext = localStorage.getItem(sealedKey);
        expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
        localStorageMock.setItem.mockClear();
        localStorageMock.removeItem.mockClear();
        localStorageMock.getItem.mockImplementationOnce((readKey: string) => {
            if (readKey === key) throw new DOMException('blocked', 'SecurityError');
            return null;
        });

        expect(() => readWorkoutTimerSnapshot(owner)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
        expect(localStorage.getItem(sealedKey)).toBe(originalCiphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(readWorkoutTimerSnapshot(owner)).toEqual(running);
    });

    it('refuses to start a workout when the canonical timer snapshot cannot be written', async () => {
        const pending = workout('w-start');
        useAppStore.setState({
            userData: parseUserData({ activeWorkout: pending }),
            dataOwner: owner,
            localWorkout: pending,
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            saveError: null,
        });
        // Start validation now requires a real durable prepared workout. The
        // timer failure must be tested after that prerequisite is satisfied.
        await initializeLocal(owner, parseUserData({ activeWorkout: pending }));
        const timerKey = protectedDeviceKey('timer', owner);
        const running = { version: 1 as const, state: 'running' as const, startTime: 1000, accumulated: 250 };
        writeWorkoutTimerSnapshot(running, owner);
        const originalCiphertext = localStorage.getItem(timerKey);
        localStorageMock.setItem.mockClear();
        localStorageMock.setItem.mockImplementationOnce((writtenKey: string) => {
            if (writtenKey === timerKey) throw new DOMException('full', 'QuotaExceededError');
        });

        const { result } = renderHook(() => useWorkoutSession());
        let started = true;
        await act(async () => {
            started = await result.current.confirmWorkoutStart({ energy: 4 });
        });

        expect(started).toBe(false);
        expect(useAppStore.getState().localWorkout?.globalStartTime).toBeUndefined();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().saveError).toContain('timer');
        expect(localStorage.getItem(timerKey)).toBe(originalCiphertext);
        expect(localStorage.getItem(deviceKey('timer', owner))).toBeNull();
    });

    it('contains an initial pre-session owner read failure and blocks device-critical persistence', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('storage unavailable'); });

        expect(() => render(
            <PreSessionCheckIn
                workoutId="w-current"
                date="2026-10-05"
                onStart={vi.fn(async () => true)}
                onCancel={vi.fn(async () => true)}
            />,
        )).not.toThrow();

        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(useAppStore.getState().saveError).toContain('check-in non salvata');
        consoleSpy.mockRestore();
    });

    it('persists pre-session readiness synchronously on each edit', () => {
        render(
            <PreSessionCheckIn
                workoutId="w-current"
                date="2026-10-05"
                onStart={vi.fn(async () => true)}
                onCancel={vi.fn(async () => true)}
            />,
        );

        const name = 'draft:pre-session:w-current';
        const key = protectedDeviceKey(name, owner);
        const writes = () => localStorageMock.setItem.mock.calls
            .filter(([writtenKey]) => writtenKey === key)
            .map(([, raw]) => raw as string);
        localStorageMock.setItem.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        expect(writes()).toHaveLength(1);
        expect(writes()[0]).toMatch(/^tlb-sealed:v1:/);
        expect(JSON.parse(readDeviceValueStrict(name, owner)!)).toMatchObject({ energy: 4 });

        fireEvent.click(screen.getByRole('button', { name: 'Stress: 3 su 5' }));
        expect(writes()).toHaveLength(2);
        expect(writes()[1]).toMatch(/^tlb-sealed:v1:/);
        expect(writes()[1]).not.toBe(writes()[0]);
        expect(JSON.parse(readDeviceValueStrict(name, owner)!)).toMatchObject({ energy: 4, stress: 3 });

        fireEvent.click(screen.getByRole('button', { name: 'Energia: 5 su 5' }));
        expect(writes()).toHaveLength(3);
        expect(writes()[2]).toMatch(/^tlb-sealed:v1:/);
        expect(writes()[2]).not.toBe(writes()[1]);
        expect(JSON.parse(readDeviceValueStrict(name, owner)!)).toMatchObject({ energy: 5, stress: 3 });
        expect(localStorage.getItem(key)).toBe(writes()[2]);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    });

    it('surfaces a pre-session draft write failure instead of waiting for a lifecycle event', () => {
        const name = 'draft:pre-session:w-current';
        const key = protectedDeviceKey(name, owner);
        render(
            <PreSessionCheckIn
                workoutId="w-current"
                date="2026-10-05"
                onStart={vi.fn(async () => true)}
                onCancel={vi.fn(async () => true)}
            />,
        );
        localStorageMock.setItem.mockImplementationOnce((writtenKey: string) => {
            if (writtenKey === key) throw new DOMException('full', 'QuotaExceededError');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Stress: 3 su 5' }));

        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().saveError).toContain('Bozza del check-in non salvata');
        expect(localStorage.getItem(key)).toBeNull();
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    });

    it('makes visibilitychange flush failures fail closed', () => {
        const fail = () => { throw new DOMException('blocked', 'SecurityError'); };
        draftRegistry.register(fail);
        try {
            Object.defineProperty(document, 'visibilityState', {
                value: 'hidden',
                configurable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));

            expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            expect(useAppStore.getState().syncHealth).toBe('failed');
            expect(useAppStore.getState().saveError).toContain('mettere al sicuro');
        } finally {
            draftRegistry.unregister(fail);
        }
    });
    it('does not mark persistence as failed on an empty, unauthenticated landing screen', () => {
        useAppStore.setState({
            userData: null,
            dataOwner: null,
            localWorkout: null,
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            saveError: null,
        });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(useAppStore.getState().syncHealth).toBe('synced');
        expect(useAppStore.getState().saveError).toBeNull();
    });

    it('still flushes registered drafts on an empty unauthenticated screen', () => {
        const failingDraft = () => { throw new DOMException('blocked', 'SecurityError'); };
        draftRegistry.register(failingDraft);
        try {
            useAppStore.setState({
                userData: null,
                dataOwner: null,
                localWorkout: null,
                localPersistenceBlocked: false,
                syncHealth: 'synced',
                saveError: null,
            });
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            expect(useAppStore.getState().saveError).toContain('mettere al sicuro');
        } finally {
            draftRegistry.unregister(failingDraft);
        }
    });

    it('fails closed for a workout that has no provable owner on backgrounding', () => {
        useAppStore.setState({
            userData: null,
            dataOwner: null,
            localWorkout: workout('w-current'),
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            saveError: null,
        });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().saveError).toContain('mettere al sicuro');
    });


    it('persists the workout produced by a synchronous draft flush, not its previous snapshot', () => {
        const updated = workout('w-current', '12');
        persistPlainWorkoutSnapshot(workout('w-current'), owner);
        const flushDraft = () => { useAppStore.setState({ localWorkout: updated }); };
        draftRegistry.register(flushDraft);
        try {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            const sealed = localStorage.getItem(protectedDeviceKey('workout', owner));
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            const raw = readDeviceValueStrict('workout', owner);
            expect(raw).not.toBeNull();
            expect((unwrapWorkoutDeviceSnapshot(JSON.parse(raw!), owner).workout as WorkoutSession)
                .exercises[0].sets[0].reps).toBe('12');
            expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
            expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        } finally {
            draftRegistry.unregister(flushDraft);
        }
    });

    it.each([false, true])('preserves a newer tab workout when a stale tab backgrounds (draft=%s)', flushesDraft => {
        const latest = workout('w-current', '14');
        // This tab still has reps=8 while another tab published reps=14.
        const key = protectedDeviceKey('workout', owner);
        persistPlainWorkoutSnapshot(latest, owner);
        const originalCiphertext = localStorage.getItem(key);
        expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
        const staleDraft = () => useAppStore.setState({ localWorkout: workout('w-current', '12') });
        if (flushesDraft) draftRegistry.register(staleDraft);
        try {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            expect(localStorage.getItem(key)).toBe(originalCiphertext);
            expect(unwrapWorkoutDeviceSnapshot(JSON.parse(readDeviceValueStrict('workout', owner)!), owner).workout)
                .toEqual(latest);
            expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
            expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            expect(useAppStore.getState().saveError).toContain('mettere al sicuro');
        } finally {
            if (flushesDraft) draftRegistry.unregister(staleDraft);
        }
    });


});
