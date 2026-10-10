import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { UserDataSchema } from '../src/lib/schema';
import type { UserData, WorkoutSession } from '../src/types';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { readWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import { BrowserStorageError } from '../src/lib/sync/browserStorage';
import { localStorageMock } from './setup';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import PreSessionCheckIn from '../src/components/Training/PreSessionCheckIn';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { captureSession } from '../src/lib/sync/session';

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
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        owner = captureSession().owner;
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
        const key = deviceKey('workout', owner);
        localStorageMock.setItem.mockImplementationOnce((writtenKey: string) => {
            if (writtenKey === key) throw new DOMException(message, name);
        });

        const next = workout('w-current', '9');
        await expect(useAppStore.getState().setSyncedLocalWorkout(next)).rejects.toBeInstanceOf(BrowserStorageError);

        expect(useAppStore.getState().localWorkout?.exercises[0].sets[0].reps).toBe('8');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(useAppStore.getState().saveError).toContain('Impossibile salvare l’allenamento');
    });

    it('does not let a one-shot read failure replace a newer device workout with an older IndexedDB fallback', () => {
        const key = deviceKey('workout', owner);
        localStorage.setItem(key, JSON.stringify(workout('device-new', '10')));
        localStorageMock.setItem.mockClear();
        const fallback = workout('envelope-old', '6');

        localStorageMock.getItem.mockImplementationOnce((readKey: string) => {
            if (readKey === key) throw new DOMException('blocked', 'SecurityError');
            return null;
        });

        expect(() => getInitialLocalWorkout(owner, fallback)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();

    });

    it('does not reinterpret an unreadable running timer as stopped', () => {
        const key = deviceKey('timer', owner);
        localStorage.setItem(key, JSON.stringify({
            version: 1,
            state: 'running',
            startTime: 1000,
            accumulated: 250,
        }));
        localStorageMock.setItem.mockClear();
        localStorageMock.removeItem.mockClear();
        localStorageMock.getItem.mockImplementationOnce((readKey: string) => {
            if (readKey === key) throw new DOMException('blocked', 'SecurityError');
            return null;
        });

        expect(() => readWorkoutTimerSnapshot(owner)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
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
        const timerKey = deviceKey('timer', owner);
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

        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));

        const key = deviceKey('draft:pre-session:w-current', owner);
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            key,
            expect.stringContaining('"energy":4'),
        );
    });

    it('surfaces a pre-session draft write failure instead of waiting for a lifecycle event', () => {
        const key = deviceKey('draft:pre-session:w-current', owner);
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

});
