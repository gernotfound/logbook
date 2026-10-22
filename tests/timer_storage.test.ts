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

    it('returns stopped without writing when the canonical snapshot is absent', () => {
        expect(readWorkoutTimerSnapshot(OWNER)).toEqual(stoppedWorkoutTimer());
        expect(localStorage.getItem(deviceKey('timer', OWNER))).toBeNull();
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid JSON', '{broken'],
        ['unsupported snapshot version', JSON.stringify({ version: 2, state: 'stopped', startTime: 0, accumulated: 0 })],
        ['invalid running timestamp', JSON.stringify({ version: 1, state: 'running', startTime: 0, accumulated: 250 })],
    ])('fails closed for %s rather than silently resetting a damaged timer', (_description, value) => {
        localStorage.setItem(deviceKey('timer', OWNER), value);
        localStorageMock.setItem.mockClear();
        localStorageMock.removeItem.mockClear();

        expect(() => readWorkoutTimerSnapshot(OWNER)).toThrow();
        expect(localStorage.getItem(deviceKey('timer', OWNER))).toBe(value);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
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
