import { beforeEach, describe, expect, it, vi } from 'vitest';
import { update as idbUpdate } from 'idb-keyval';
import { UserDataSchema } from '../src/lib/schema';
import { captureSession } from '../src/lib/sync/session';
import { readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { commitDomainOperations, initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import {
    readWorkoutDeviceIntent, recoverWorkoutDeviceIntent, saveWorkoutDeviceIntent,
} from '../src/lib/sync/workoutDeviceIntent';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { persistOwnerBoundWorkoutSnapshot } from '../src/lib/sync/deviceCriticalState';
import type { UserData, WorkoutSession } from '../src/types';

const workout = (kg: string): WorkoutSession => ({
    id: 'device-intent-w1', date: '2026-10-14', routineName: 'Allenamento',
    exercises: [{ id: 'se1', exId: 'bench', sessionNote: '', sets: [{ id: 's1', kg, reps: '8' }] }],
});
const data = (activeWorkout: WorkoutSession | null) => UserDataSchema.parse({ activeWorkout }) as unknown as UserData;
const owner = 'user:test-user-id';

describe('authenticated device-intent replay into semantic journal', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('replays the same encrypted device snapshot into IndexedDB and the pending journal after a crash', async () => {
        const before = data(workout('50'));
        await initializeLocal(owner, before);
        const changed = workout('55');
        const intent = saveWorkoutDeviceIntent(owner, before.activeWorkout ?? null, changed, before.activeWorkout);
        const encoded = readDeviceValueStrict('workout', owner);
        expect(intent.sequence).toBe(1);
        expect((await readLocal(owner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('50');
        expect(getInitialLocalWorkout(owner, before.activeWorkout ?? null, before.history)?.exercises[0].sets[0].kg).toBe('55');
        expect(readDeviceValueStrict('workout', owner)).toBe(encoded);
        persistOwnerBoundWorkoutSnapshot(captureSession(), owner, changed);
        expect(readDeviceValueStrict('workout', owner)).toBe(encoded);
        await recoverWorkoutDeviceIntent(owner, () => true);
        const recovered = (await readLocal(owner))!;
        expect(recovered.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
        expect(recovered.pending.length).toBeGreaterThan(0);
        expect(recovered.lastWorkoutDeviceIntent).toEqual({ generation: intent.generation, sequence: 1 });
        const count = recovered.pending.length;
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.pending.length).toBe(count);
    });

    it('applies the latest rapid edit and refuses a delayed older IndexedDB commit', async () => {
        const initial = data(workout('50'));
        await initializeLocal(owner, initial);
        const first = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('52'), initial.activeWorkout ?? null);
        const latest = saveWorkoutDeviceIntent(owner, workout('52'), workout('57'), initial.activeWorkout ?? null);
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: latest.workout }, initial, undefined,
            { generation: latest.generation, sequence: latest.sequence, baseline: latest.baseline });
        const afterLatest = (await readLocal(owner))!;
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: first.workout }, initial, undefined,
            { generation: first.generation, sequence: first.sequence, baseline: first.baseline });
        const final = (await readLocal(owner))!;
        expect(final.data.activeWorkout?.exercises[0].sets[0].kg).toBe('57');
        expect(final.pending).toEqual(afterLatest.pending);
        expect(final.lastWorkoutDeviceIntent?.sequence).toBe(2);
        expect(readWorkoutDeviceIntent(owner)?.workout.exercises[0].sets[0].kg).toBe('57');
    });

    it('rejects an unrelated durable workout without deleting the saved device intent', async () => {
        const before = data(workout('50'));
        await initializeLocal(owner, before);
        saveWorkoutDeviceIntent(owner, before.activeWorkout ?? null, workout('55'), before.activeWorkout);
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: { ...workout('60'), id: 'other-workout' } }, before);
        const saved = readDeviceValueStrict('workout', owner);
        await expect(recoverWorkoutDeviceIntent(owner, () => true)).rejects.toThrow('stato locale è cambiato');
        expect(readDeviceValueStrict('workout', owner)).toBe(saved);
        expect((await readLocal(owner))?.data.activeWorkout?.id).toBe('other-workout');
    });

    it('rejects a corrupt preexisting snapshot instead of overwriting it', async () => {
        const initial = data(workout('50'));
        await initializeLocal(owner, initial);
        writeDeviceValue('workout', '{broken-json', owner);
        expect(() => saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null))
            .toThrow('corrotto');
        expect(readDeviceValueStrict('workout', owner)).toBe('{broken-json');
    });

    it('keeps the device intent intact when IndexedDB rejects its transaction', async () => {
        const initial = data(workout('50'));
        await initializeLocal(owner, initial);
        const intent = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('66'), initial.activeWorkout ?? null);
        vi.mocked(idbUpdate).mockRejectedValueOnce(new Error('disk failure'));
        await expect(recoverWorkoutDeviceIntent(owner, () => true)).rejects.toThrow('disk failure');
        expect((await readLocal(owner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('50');
        expect(readWorkoutDeviceIntent(owner)?.generation).toBe(intent.generation);
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('66');
    });
});
