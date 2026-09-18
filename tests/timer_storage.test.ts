import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageMock } from './setup';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import {
    readWorkoutTimerSnapshot,
    resetGlobalWorkoutTimer,
    stoppedWorkoutTimer,
    writeWorkoutTimerSnapshot,
} from '../src/lib/utils/timer';

const OWNER = 'user:timer-test';

describe('atomic workout timer storage', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorageMock.setItem.mockClear();
        localStorageMock.removeItem.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('migrates a valid legacy three-key timer into one canonical snapshot', () => {
        localStorage.setItem(deviceKey('timer_state', OWNER), 'running');
        localStorage.setItem(deviceKey('timer_start', OWNER), '1000');
        localStorage.setItem(deviceKey('timer_accumulated', OWNER), '250');

        expect(readWorkoutTimerSnapshot(OWNER)).toEqual({
            version: 1,
            state: 'running',
            startTime: 1000,
            accumulated: 250,
        });

        expect(JSON.parse(localStorage.getItem(deviceKey('timer', OWNER))!)).toEqual({
            version: 1,
            state: 'running',
            startTime: 1000,
            accumulated: 250,
        });
        expect(localStorage.getItem(deviceKey('timer_state', OWNER))).toBeNull();
        expect(localStorage.getItem(deviceKey('timer_start', OWNER))).toBeNull();
        expect(localStorage.getItem(deviceKey('timer_accumulated', OWNER))).toBeNull();
    });

    it('keeps the canonical stopped snapshot authoritative over stale legacy keys', () => {
        localStorage.setItem(deviceKey('timer_state', OWNER), 'running');
        localStorage.setItem(deviceKey('timer_start', OWNER), '1000');
        localStorage.setItem(deviceKey('timer_accumulated', OWNER), '250');
        localStorage.setItem(deviceKey('timer', OWNER), JSON.stringify(stoppedWorkoutTimer()));

        expect(readWorkoutTimerSnapshot(OWNER)).toEqual(stoppedWorkoutTimer());
    });

    it('persists a complete running state with one canonical setItem call', () => {
        writeWorkoutTimerSnapshot({
            version: 1,
            state: 'running',
            startTime: 123456,
            accumulated: 9000,
        }, OWNER);

        const canonicalWrites = localStorageMock.setItem.mock.calls.filter(([key]) => key === deviceKey('timer', OWNER));
        expect(canonicalWrites).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(deviceKey('timer', OWNER))!)).toEqual({
            version: 1,
            state: 'running',
            startTime: 123456,
            accumulated: 9000,
        });
    });

    it('does not publish a reset event when the canonical storage write fails', () => {
        const canonicalKey = deviceKey('timer', OWNER);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.setItem.mockImplementationOnce((key: string) => {
            if (key === canonicalKey) throw new DOMException('blocked', 'SecurityError');
        });
        const listener = vi.fn();
        window.addEventListener('logbook_reset_timer', listener);

        try {
            expect(resetGlobalWorkoutTimer(OWNER)).toBe(false);
            expect(listener).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('logbook_reset_timer', listener);
        }
    });
});
