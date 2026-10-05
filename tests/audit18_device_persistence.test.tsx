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

const parseUserData = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;
const OWNER = 'guest';

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
        useAppStore.setState({
            userData: parseUserData({ activeWorkout: workout('w-current') }),
            dataOwner: OWNER,
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
        const key = deviceKey('workout', OWNER);
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
        const key = deviceKey('workout', OWNER);
        localStorage.setItem(key, JSON.stringify(workout('device-new', '10')));
        localStorageMock.setItem.mockClear();
        const fallback = workout('envelope-old', '6');

        localStorageMock.getItem.mockImplementationOnce((readKey: string) => {
            if (readKey === key) throw new DOMException('blocked', 'SecurityError');
            return null;
        });

        expect(() => getInitialLocalWorkout(OWNER, fallback)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();

    });

    it('does not reinterpret an unreadable running timer as stopped', () => {
        const key = deviceKey('timer', OWNER);
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

        expect(() => readWorkoutTimerSnapshot(OWNER)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it('refuses to start a workout when the canonical timer snapshot cannot be written', async () => {
        const pending = workout('w-start');
        useAppStore.setState({
            userData: parseUserData({ activeWorkout: pending }),
            dataOwner: OWNER,
            localWorkout: pending,
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            saveError: null,
        });
        const timerKey = deviceKey('timer', OWNER);
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

    it('persists pre-session readiness synchronously on each edit', () => {
        render(
            <PreSessionCheckIn
                workoutId="w-current"
                date="2026-10-05"
                onStart={vi.fn(async () => true)}
                onCancel={vi.fn(async () => {})}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));

        const key = deviceKey('draft:pre-session:w-current', OWNER);
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            key,
            expect.stringContaining('"energy":4'),
        );
    });

    it('surfaces a pre-session draft write failure instead of waiting for a lifecycle event', () => {
        const key = deviceKey('draft:pre-session:w-current', OWNER);
        render(
            <PreSessionCheckIn
                workoutId="w-current"
                date="2026-10-05"
                onStart={vi.fn(async () => true)}
                onCancel={vi.fn(async () => {})}
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
});
