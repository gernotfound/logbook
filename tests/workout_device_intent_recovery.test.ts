import { beforeEach, describe, expect, it, vi } from 'vitest';
import { update as idbUpdate } from 'idb-keyval';
import { DomainParsers, UserDataSchema } from '../src/lib/schema';
import { equivalentWorkoutSnapshot } from '../src/lib/sync/workoutSnapshotEquality';
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

    it('preserves a losing tab draft in an independent slot when two tabs overwrite their shared snapshot', async () => {
        const parallelOwner = 'user:slot-overwrite-test';
        const original = data(workout('50'));
        await initializeLocal(parallelOwner, original);
        const first = saveWorkoutDeviceIntent(parallelOwner, original.activeWorkout ?? null, workout('55'), original.activeWorkout ?? null);
        const firstCopy = JSON.stringify(first);
        const other = { ...first, intentId: 'c'.repeat(32), workout: workout('60') };
        writeDeviceValue('workout-slot:' + 'a'.repeat(32), JSON.stringify(other), parallelOwner);
        writeDeviceValue('workout', JSON.stringify(other), parallelOwner);
        const firstSlot = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            .find(key => key?.startsWith('logbook:v2:' + parallelOwner + ':')
                && key.includes('workout-slot:') && !key.endsWith('a'.repeat(32)));
        expect(firstSlot).toBeDefined();
        expect(readDeviceValueStrict('workout-slot:' + firstSlot!.split(':').at(-1), parallelOwner)).toBe(firstCopy);
        await expect(recoverWorkoutDeviceIntent(parallelOwner, () => true))
            .rejects.toThrow('Più schede');
        expect((await readLocal(parallelOwner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('50');
        expect(readDeviceValueStrict('workout', parallelOwner)).toBe(JSON.stringify(other));
        expect(readDeviceValueStrict('workout-slot:' + 'a'.repeat(32), parallelOwner)).toBe(JSON.stringify(other));
    });

    it('replays the same encrypted device snapshot into IndexedDB and the pending journal after a crash', async () => {
        const before = data(workout('50'));
        await initializeLocal(owner, before);
        const changed = workout('55');
        const intent = saveWorkoutDeviceIntent(owner, before.activeWorkout ?? null, changed, before.activeWorkout ?? null);
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
        expect(recovered.lastWorkoutDeviceIntent).toEqual({ generation: intent.generation, sequence: 1, intentId: intent.intentId });
        const count = recovered.pending.length;
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.pending.length).toBe(count);
    });

    it('applies the latest rapid edit and refuses a delayed older IndexedDB commit', async () => {
        const initial = data(workout('50'));
        await initializeLocal(owner, initial);
        const first = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('52'), initial.activeWorkout ?? null);
        const latest = saveWorkoutDeviceIntent(owner, workout('52'), workout('57'), initial.activeWorkout ?? null);
        expect(latest.intentId).not.toBe(first.intentId);
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: latest.workout }, initial, undefined,
            { generation: latest.generation, sequence: latest.sequence, intentId: latest.intentId, baseline: latest.baseline });
        const afterLatest = (await readLocal(owner))!;
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: first.workout }, initial, undefined,
            { generation: first.generation, sequence: first.sequence, intentId: first.intentId, baseline: first.baseline });
        const final = (await readLocal(owner))!;
        expect(final.data.activeWorkout?.exercises[0].sets[0].kg).toBe('57');
        expect(final.pending).toEqual(afterLatest.pending);
        expect(final.lastWorkoutDeviceIntent?.sequence).toBe(2);
        expect(readWorkoutDeviceIntent(owner)?.workout.exercises[0].sets[0].kg).toBe('57');
    });

    it('refuses different concurrent workouts with the same generation and sequence without losing either durable record', async () => {
        for (const [committedKg, competingKg] of [['55', '60'], ['60', '55']]) {
            const parallelOwner = 'user:device-intent-collision-' + committedKg;
            const original = data(workout('50'));
            await initializeLocal(parallelOwner, original);
            const first = saveWorkoutDeviceIntent(parallelOwner, original.activeWorkout ?? null, workout(committedKg), original.activeWorkout ?? null);
            const competing = { ...first, intentId: 'b'.repeat(32), workout: workout(competingKg) };

            await commitDomainOperations(parallelOwner, { type: 'active-workout.set', workout: first.workout },
                original, undefined, { generation: first.generation, sequence: first.sequence, intentId: first.intentId, baseline: first.baseline });
            const committed = await readLocal(parallelOwner);
            // A second tab wrote after reading the same prior sequence.
            writeDeviceValue('workout', JSON.stringify(competing), parallelOwner);
            const deviceCopy = readDeviceValueStrict('workout', parallelOwner);
            await expect(commitDomainOperations(parallelOwner, { type: 'active-workout.set', workout: competing.workout },
                original, undefined, { generation: competing.generation, sequence: competing.sequence, intentId: competing.intentId, baseline: competing.baseline }))
                .rejects.toThrow('Conflitto tra modifiche concorrenti');
            await expect(recoverWorkoutDeviceIntent(parallelOwner, () => true))
                .rejects.toThrow('Conflitto tra modifiche concorrenti');
            expect(await readLocal(parallelOwner)).toEqual(committed);
            expect(readDeviceValueStrict('workout', parallelOwner)).toBe(deviceCopy);
        }
    });

    it('allows an equivalent retry at the same generation/sequence without duplicate journal entries', async () => {
        const initial = data(workout('50'));
        await initializeLocal(owner, initial);
        const intent = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null);
        await recoverWorkoutDeviceIntent(owner, () => true);
        const before = (await readLocal(owner))!;
        const expanded = DomainParsers.parseActiveWorkout(intent.workout);
        if (!expanded) throw new Error('Expected valid workout');
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: expanded }, initial, undefined,
            { generation: intent.generation, sequence: intent.sequence, intentId: intent.intentId, baseline: intent.baseline });
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.pending).toEqual(before.pending);
        expect((await readLocal(owner))?.revision).toBe(before.revision);
    });

    it('accepts semantically identical serialized and Zod-expanded snapshots without masking competing edits', async () => {
        const initial = data(workout('50'));
        await initializeLocal(owner, initial);
        const first = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null);
        const expanded = DomainParsers.parseActiveWorkout(first.workout);
        if (!expanded) throw new Error('Test workout must be valid');

        // Browser JSON omits undefined; the in-memory store can contain Zod defaults
        // and optional undefined fields. These must not look like a competing tab.
        expect(JSON.stringify(expanded)).not.toBe(JSON.stringify(first.workout));
        expect(equivalentWorkoutSnapshot(first.workout, expanded)).toBe(true);
        const second = saveWorkoutDeviceIntent(owner, expanded, workout('60'), initial.activeWorkout ?? null);
        expect(second.sequence).toBe(2);
        expect(second.generation).toBe(first.generation);

        // A genuinely different value must still fail closed, preserving the
        // latest device record rather than manufacturing a new journal intent.
        expect(equivalentWorkoutSnapshot(second.workout, workout('61'))).toBe(false);
        const durable = readDeviceValueStrict('workout', owner);
        expect(() => saveWorkoutDeviceIntent(owner, workout('61'), workout('70'), initial.activeWorkout ?? null))
            .toThrow('altra scheda');
        expect(readDeviceValueStrict('workout', owner)).toBe(durable);

        await recoverWorkoutDeviceIntent(owner, () => true);
        const saved = await readLocal(owner);
        expect(saved?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('60');
        expect(saved?.lastWorkoutDeviceIntent).toEqual({ generation: first.generation, sequence: 2, intentId: second.intentId });
        expect(saved?.pending.length).toBeGreaterThan(0);
    });

    it('accepts a durable baseline with Zod-expanded optional fields without losing its session identity', async () => {
        const rawBaseline: WorkoutSession = { ...workout('50'), pains: undefined };
        await initializeLocal(owner, data(rawBaseline));
        saveWorkoutDeviceIntent(owner, rawBaseline, workout('55'), rawBaseline);
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
    });

    it('preserves an intentionally null first baseline through subsequent synchronous edits', async () => {
        await initializeLocal(owner, data(null));
        const first = saveWorkoutDeviceIntent(owner, null, workout('50'), null);
        const second = saveWorkoutDeviceIntent(owner, first.workout, workout('55'), workout('50'));
        expect(second.baseline).toBeNull();
        await recoverWorkoutDeviceIntent(owner, () => true);
        const saved = (await readLocal(owner))!;
        expect(saved.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
        expect(saved.lastWorkoutDeviceIntent?.sequence).toBe(2);
        expect(saved.lastWorkoutDeviceIntent?.intentId).toBe(second.intentId);
    });

    it('rejects an unrelated durable workout without deleting the saved device intent', async () => {
        const before = data(workout('50'));
        await initializeLocal(owner, before);
        saveWorkoutDeviceIntent(owner, before.activeWorkout ?? null, workout('55'), before.activeWorkout ?? null);
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
