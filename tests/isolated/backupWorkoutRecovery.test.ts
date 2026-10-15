import { beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ read: vi.fn(), timer: vi.fn() }));
vi.mock('../../src/lib/sync/deviceStorage', () => ({ readDeviceValueStrict: sdk.read }));
vi.mock('../../src/lib/utils/timer', () => ({ writeWorkoutTimerSnapshot: sdk.timer }));
import { UserDataSchema } from '../../src/lib/schema';
import { decodePortableWorkout, restorePortableWorkout, restorePortableTimerAsPaused } from '../../src/lib/backupWorkoutRecovery';
import type { UserData, WorkoutSession } from '../../src/types';
const workout: WorkoutSession = { id: 'backup-session', date: '2026-10-14', exercises: [], routineName: 'Recuperato' };
const empty = () => UserDataSchema.parse({}) as unknown as UserData;
beforeEach(() => { sdk.read.mockReset().mockReturnValue(null); sdk.timer.mockReset(); });

describe('portable workout recovery as a new Domain Operation', () => {
    it('translates a device snapshot to a current-owner commit and never copies old journal metadata', async () => {
        const commit = vi.fn(async () => ({ ok: false as const, status: 'local-pending' as const, error: new Error('offline') }));
        const state = () => ({ dataOwner: 'user:a', userData: empty(), localWorkout: null, localPersistenceBlocked: false });
        const outcome = await restorePortableWorkout(JSON.stringify(workout), 'user:a', state, commit, () => {});
        expect(outcome).toBe('restored');
        expect(commit).toHaveBeenCalledWith(expect.objectContaining(workout));
    });

    it('does not resurrect a completed workout or displace an active session', async () => {
        const commit = vi.fn();
        const completed = () => ({ dataOwner: 'user:a', userData: { ...empty(), history: [workout] }, localWorkout: null, localPersistenceBlocked: false });
        await expect(restorePortableWorkout(JSON.stringify(workout), 'user:a', completed, commit, () => {})).resolves.toBe('completed');
        const conflict = () => ({ dataOwner: 'user:a', userData: { ...empty(), activeWorkout: { ...workout, id: 'newer' } }, localWorkout: null, localPersistenceBlocked: false });
        await expect(restorePortableWorkout(JSON.stringify(workout), 'user:a', conflict, commit, () => {})).resolves.toBe('conflict');
        expect(commit).not.toHaveBeenCalled();
    });

    it('preserves an existing sealed workout and a session swap', async () => {
        const commit = vi.fn();
        const state = () => ({ dataOwner: 'user:a', userData: empty(), localWorkout: null, localPersistenceBlocked: false });
        sdk.read.mockReturnValue('sealed newer');
        await expect(restorePortableWorkout(JSON.stringify(workout), 'user:a', state, commit, () => {})).resolves.toBe('already-present');
        sdk.read.mockReturnValue(null);
        await expect(restorePortableWorkout(JSON.stringify(workout), 'user:a', state, commit,
            () => { throw new Error('session changed'); })).rejects.toThrow('session changed');
        expect(commit).not.toHaveBeenCalled();
    });

    it('freezes a running timer at the recorded export instant without overwriting a local timer', () => {
        const raw = JSON.stringify({ version: 1, state: 'running', startTime: 1_000, accumulated: 200 });
        expect(restorePortableTimerAsPaused(raw, new Date(6_000).toISOString(), 'user:a', () => {})).toBe(true);
        expect(sdk.timer).toHaveBeenCalledWith({
            version: 1, state: 'paused', startTime: 0, accumulated: 5_200,
        }, 'user:a');
        sdk.read.mockReturnValue('newer-timer');
        expect(restorePortableTimerAsPaused(raw, new Date(6_000).toISOString(), 'user:a', () => {})).toBe(false);
        expect(sdk.timer).toHaveBeenCalledTimes(1);
    });

    it('rejects future timestamps and corrupted snapshots without a destructive fallback', () => {
        expect(() => decodePortableWorkout('{', 'user:a')).toThrow('non JSON');
        expect(() => restorePortableTimerAsPaused(
            JSON.stringify({ version: 1, state: 'running', startTime: 8000, accumulated: 1 }),
            new Date(6_000).toISOString(), 'user:a', () => {})).toThrow('non coerente');
        expect(sdk.timer).not.toHaveBeenCalled();
    });
});
