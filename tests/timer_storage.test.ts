import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageMock } from './setup';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import {
    readWorkoutTimerSnapshot,
    resetGlobalWorkoutTimer,
    stoppedWorkoutTimer,
    writeWorkoutTimerSnapshot,
} from '../src/lib/utils/timer';

const OWNER = 'user:timer-test';

describe('atomic workout timer storage', () => {
    beforeEach(async () => {
        localStorage.clear();
        await prepareUnlockedTestArchive(OWNER);
        localStorageMock.setItem.mockClear();
        localStorageMock.removeItem.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns stopped without writing when the canonical snapshot is absent', () => {
        expect(readWorkoutTimerSnapshot(OWNER)).toEqual(stoppedWorkoutTimer());
        expect(localStorage.getItem(deviceKey('timer', OWNER))).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('timer', OWNER))).toBeNull();
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid JSON', '{broken'],
        ['unsupported snapshot version', JSON.stringify({ version: 2, state: 'stopped', startTime: 0, accumulated: 0 })],
        ['invalid running timestamp', JSON.stringify({ version: 1, state: 'running', startTime: 0, accumulated: 250 })],
    ])('fails closed for %s rather than silently resetting a damaged timer', (_description, value) => {
        writeDeviceValue('timer', value, OWNER);
        const sealed = localStorage.getItem(protectedDeviceKey('timer', OWNER));
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        localStorageMock.setItem.mockClear();
        localStorageMock.removeItem.mockClear();

        expect(() => readWorkoutTimerSnapshot(OWNER)).toThrow();
        expect(localStorage.getItem(protectedDeviceKey('timer', OWNER))).toBe(sealed);
        expect(readDeviceValueStrict('timer', OWNER)).toBe(value);
        expect(localStorage.getItem(deviceKey('timer', OWNER))).toBeNull();
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it('persists a complete running state with one authenticated sealed setItem call', () => {
        writeWorkoutTimerSnapshot({
            version: 1,
            state: 'running',
            startTime: 123456,
            accumulated: 9000,
        }, OWNER);

        const sealedKey = protectedDeviceKey('timer', OWNER);
        const canonicalWrites = localStorageMock.setItem.mock.calls.filter(([key]) => key === sealedKey);
        expect(canonicalWrites).toHaveLength(1);
        expect(canonicalWrites[0][1]).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(sealedKey)).toBe(canonicalWrites[0][1]);
        expect(localStorage.getItem(deviceKey('timer', OWNER))).toBeNull();
        expect(readWorkoutTimerSnapshot(OWNER)).toEqual({
            version: 1,
            state: 'running',
            startTime: 123456,
            accumulated: 9000,
        });
    });

    it('does not publish a reset event when the canonical storage write fails', () => {
        const canonicalKey = protectedDeviceKey('timer', OWNER);
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
        expect(localStorage.getItem(canonicalKey)).toBeNull();
        expect(localStorage.getItem(deviceKey('timer', OWNER))).toBeNull();
    });

    it('preserves a forged plaintext timer and refuses to treat it as a valid sealed snapshot', () => {
        const legacyKey = deviceKey('timer', OWNER);
        const stale = JSON.stringify({ version: 1, state: 'running', startTime: 1000, accumulated: 250 });
        localStorage.setItem(legacyKey, stale);
        localStorageMock.setItem.mockClear();
        expect(() => readWorkoutTimerSnapshot(OWNER)).toThrow();
        expect(localStorage.getItem(legacyKey)).toBe(stale);
        expect(localStorage.getItem(protectedDeviceKey('timer', OWNER))).toBeNull();
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
});
