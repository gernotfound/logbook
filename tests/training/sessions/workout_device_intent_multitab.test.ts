import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet } from 'idb-keyval';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { BrowserStorageError } from '../../../src/lib/sync/browserStorage';
import { localStorageMock } from '../../setup';
import { commitDomainOperations, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { persistPlainWorkoutSnapshot, readWorkoutDeviceIntent, recoverWorkoutDeviceIntent, releaseCommittedWorkoutSlot, saveWorkoutDeviceIntent } from '../../../src/lib/sync/workoutDeviceIntent';
import { workout, data, prepareAccountWorkoutArchive, injectAtArchiveUpdate } from './workoutDeviceIntentFixture';

describe('authenticated device-intent replay into semantic journal', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('preserves a losing tab draft in immutable copies when two tabs overwrite their shared snapshot', async () => {
        const parallelOwner = 'user:slot-overwrite-test';
        const original = data(workout('50'));
        await prepareAccountWorkoutArchive(parallelOwner);
        await initializeLocal(parallelOwner, original);
        const first = saveWorkoutDeviceIntent(parallelOwner, original.activeWorkout ?? null, workout('55'), original.activeWorkout ?? null);
        const firstCopy = JSON.stringify(first);
        const other = { ...first, intentId: 'c'.repeat(32), workout: workout('60') };
        writeDeviceValue('workout-intent:' + other.intentId, JSON.stringify(other), parallelOwner);
        writeDeviceValue('workout', JSON.stringify(other), parallelOwner);
        const firstSlot = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            .find(key => key?.startsWith('logbook:v2:' + parallelOwner + ':')
                && key.includes('workout-intent:') && !key.endsWith(other.intentId));
        expect(firstSlot).toBeDefined();
        expect(readDeviceValueStrict('workout-intent:' + firstSlot!.split(':').at(-1), parallelOwner)).toBe(firstCopy);
        await expect(recoverWorkoutDeviceIntent(parallelOwner, () => true))
            .rejects.toThrow('Più schede');
        expect((await readLocal(parallelOwner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('50');
        expect(readDeviceValueStrict('workout', parallelOwner)).toBe(JSON.stringify(other));
        expect(readDeviceValueStrict('workout-intent:' + other.intentId, parallelOwner)).toBe(JSON.stringify(other));
    });

    it('blocks replay when cross-tab compaction hides a competing independent workout witness', async () => {
        const scopedOwner = 'user:slot-index-compaction-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(scopedOwner);
        await initializeLocal(scopedOwner, initial);
        const unrelated = 'cross-tab:temporary-' + crypto.randomUUID();
        localStorage.setItem(unrelated, 'present');
        const first = saveWorkoutDeviceIntent(scopedOwner, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        const competitor = { ...first, intentId: 'e'.repeat(32), workout: workout('60') };
        writeDeviceValue('workout-intent:' + competitor.intentId, JSON.stringify(competitor), scopedOwner);
        writeDeviceValue('workout', JSON.stringify(competitor), scopedOwner);

        const originalFirst = readDeviceValueStrict('workout-intent:' + first.intentId, scopedOwner);
        const originalSecond = readDeviceValueStrict('workout-intent:' + competitor.intentId, scopedOwner);
        const before = await readLocal(scopedOwner);
        const originalKey = localStorageMock.key.getMockImplementation();
        if (!originalKey) throw new Error('Missing localStorage mock implementation');
        let compacted = false;
        localStorageMock.key.mockImplementation((index: number) => {
            const found = originalKey(index);
            if (!compacted && found === unrelated) {
                compacted = true;
                localStorage.removeItem(unrelated);
            }
            return found;
        });
        try {
            await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
                .rejects.toThrow('Inventario copie workout');
        } finally {
            localStorageMock.key.mockImplementation(originalKey);
        }
        expect(compacted).toBe(true);
        expect(await readLocal(scopedOwner)).toEqual(before);
        expect(readDeviceValueStrict('workout-intent:' + first.intentId, scopedOwner)).toBe(originalFirst);
        expect(readDeviceValueStrict('workout-intent:' + competitor.intentId, scopedOwner)).toBe(originalSecond);

        await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true)).rejects.toThrow('Più schede');
        expect(await readLocal(scopedOwner)).toEqual(before);
    });

    it('refuses a late competing workout witness inserted while reading the final inventory', async () => {
        const scopedOwner = 'user:late-slot-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(scopedOwner);
        await initializeLocal(scopedOwner, initial);
        const first = saveWorkoutDeviceIntent(scopedOwner, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        const competitor = { ...first, intentId: 'e'.repeat(32), workout: workout('60') };
        const before = await readLocal(scopedOwner);
        const firstRaw = readDeviceValueStrict('workout-intent:' + first.intentId, scopedOwner);

        const originalGet = localStorageMock.getItem.getMockImplementation();
        if (!originalGet) throw new Error('Missing browser storage mock implementation');
        let reads = 0;
        localStorageMock.getItem.mockImplementation((key: string) => {
            const value = originalGet(key);
            if (key === deviceKey('workout-intent:' + first.intentId, scopedOwner)
                && ++reads === 3) {
                // Two authenticated reads finish the first recovery scan;
                // the third is the second scan just before journal replay.
                // In another tab, a second editor keeps its independent slot.
                // The shared key can still point at the first editor.
                writeDeviceValue('workout-intent:' + competitor.intentId,
                    JSON.stringify(competitor), scopedOwner);
            }
            return value;
        });
        try {
            await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
                .rejects.toThrow('Copie workout cambiate durante il recupero');
        } finally {
            localStorageMock.getItem.mockImplementation(originalGet);
        }
        expect(reads).toBeGreaterThanOrEqual(2);
        expect(await readLocal(scopedOwner)).toEqual(before);
        expect(readDeviceValueStrict('workout-intent:' + first.intentId, scopedOwner)).toBe(firstRaw);
        expect(readDeviceValueStrict('workout-intent:' + competitor.intentId, scopedOwner))
            .toBe(JSON.stringify(competitor));

        await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
            .rejects.toThrow('Più schede');
        expect(await readLocal(scopedOwner)).toEqual(before);
    });

    it('blocks an independent witness inserted during the final authenticated read inside the journal guard', async () => {
        const scopedOwner = 'user:last-slot-read-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(scopedOwner);
        await initializeLocal(scopedOwner, initial);
        const first = saveWorkoutDeviceIntent(scopedOwner, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        const competitor = { ...first, intentId: 'e'.repeat(32), workout: workout('60') };
        const before = await readLocal(scopedOwner);
        const firstRaw = readDeviceValueStrict('workout-intent:' + first.intentId, scopedOwner);

        const originalGet = localStorageMock.getItem.getMockImplementation();
        if (!originalGet) throw new Error('Missing browser storage mock implementation');
        let slotReads = 0;
        let injected = false;
        localStorageMock.getItem.mockImplementation((key: string) => {
            const value = originalGet(key);
            if (key === deviceKey('workout-intent:' + first.intentId, scopedOwner)
                && ++slotReads === 6) {
                // Each of the three recovery scans reads the slot twice; this
                // insertion occurs after the final membership check of the
                // synchronous IndexedDB preflight, during its last byte read.
                injected = true;
                writeDeviceValue('workout-intent:' + competitor.intentId,
                    JSON.stringify(competitor), scopedOwner);
            }
            return value;
        });
        try {
            await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
                .rejects.toThrow('Copie workout cambiate durante il recupero');
        } finally {
            localStorageMock.getItem.mockImplementation(originalGet);
        }
        expect(injected).toBe(true);
        expect(await readLocal(scopedOwner)).toEqual(before);
        expect(readDeviceValueStrict('workout-intent:' + first.intentId, scopedOwner)).toBe(firstRaw);
        expect(readDeviceValueStrict('workout-intent:' + competitor.intentId, scopedOwner))
            .toBe(JSON.stringify(competitor));
        await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
            .rejects.toThrow('Più schede');
        expect(await readLocal(scopedOwner)).toEqual(before);
    });

    it('refuses a new sibling inserted after the last scan but inside the IndexedDB commit guard', async () => {
        const scopedOwner = 'user:commit-time-sibling-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(scopedOwner);
        await initializeLocal(scopedOwner, initial);
        const original = saveWorkoutDeviceIntent(scopedOwner, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        const competing = { ...original, intentId: 'd'.repeat(32), workout: workout('60') };
        const before = await readLocal(scopedOwner);
        const originalRaw = readDeviceValueStrict('workout-intent:' + original.intentId, scopedOwner);
        const injection = injectAtArchiveUpdate(scopedOwner, 'before-transform', () => {
            writeDeviceValue('workout-intent:' + competing.intentId, JSON.stringify(competing), scopedOwner);
        });
        try {
            await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
                .rejects.toThrow('Copie workout cambiate prima del commit locale');
        } finally { injection.restore(); }
        expect(injection.didInject()).toBe(true);
        expect(await readLocal(scopedOwner)).toEqual(before);
        expect(readDeviceValueStrict('workout-intent:' + original.intentId, scopedOwner))
            .toBe(originalRaw);
        expect(readDeviceValueStrict('workout-intent:' + competing.intentId, scopedOwner))
            .toBe(JSON.stringify(competing));
        await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
            .rejects.toThrow('Più schede');
        expect(await readLocal(scopedOwner)).toEqual(before);
    });

    it('refuses a shared workout changed during the IndexedDB commit preflight', async () => {
        const scopedOwner = 'user:commit-time-shared-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(scopedOwner);
        await initializeLocal(scopedOwner, initial);
        const original = saveWorkoutDeviceIntent(scopedOwner, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        const witness = readDeviceValueStrict('workout-intent:' + original.intentId, scopedOwner);
        const before = await readLocal(scopedOwner);
        const injection = injectAtArchiveUpdate(scopedOwner, 'before-transform', () => {
            writeDeviceValue('workout', JSON.stringify({ ...original, workout: workout('60') }), scopedOwner);
        });
        try {
            await expect(recoverWorkoutDeviceIntent(scopedOwner, () => true))
                .rejects.toThrow('Copie workout cambiate prima del commit locale');
        } finally { injection.restore(); }
        expect(injection.didInject()).toBe(true);
        expect(await readLocal(scopedOwner)).toEqual(before);
        expect(readDeviceValueStrict('workout-intent:' + original.intentId, scopedOwner)).toBe(witness);
        expect(readDeviceValueStrict('workout', scopedOwner))
            .toBe(JSON.stringify({ ...original, workout: workout('60') }));
    });

    it('preserves a concurrent plain workout written after the journal commit', async () => {
        const account = 'user:post-commit-plain-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const candidate = saveWorkoutDeviceIntent(account, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        let draftRaw: string | null = null;
        const injection = injectAtArchiveUpdate(account, 'after-commit', () => {
            persistPlainWorkoutSnapshot(workout('60'), account);
            draftRaw = readDeviceValueStrict('workout', account);
        });
        try {
            await expect(recoverWorkoutDeviceIntent(account, () => true))
                .rejects.toThrow('Snapshot workout concorrente senza intento');
        } finally { injection.restore(); }
        expect(injection.didInject()).toBe(true);
        const committed = await readLocal(account);
        expect(committed?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
        expect(committed?.pending.length).toBeGreaterThan(0);
        expect(readDeviceValueStrict('workout', account)).toBe(draftRaw);
        expect(readDeviceValueStrict('workout-intent:' + candidate.intentId, account))
            .toBe(JSON.stringify(candidate));
        await recoverWorkoutDeviceIntent(account, () => true);
        expect(readDeviceValueStrict('workout', account)).toBe(draftRaw);
    });

    it('never overwrites an unbacked legacy intent after a newer journal commit', async () => {
        const account = 'user:post-commit-legacy-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const first = saveWorkoutDeviceIntent(account, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        saveWorkoutDeviceIntent(account, first.workout, workout('60'), first.baseline);
        const legacy = { ...first, intentId: undefined, workout: workout('65') };
        const rawLegacy = JSON.stringify(legacy);
        const injection = injectAtArchiveUpdate(account, 'after-commit', () => {
            writeDeviceValue('workout', rawLegacy, account);
        });
        try {
            await expect(recoverWorkoutDeviceIntent(account, () => true))
                .rejects.toThrow('identificativo verificabile');
        } finally { injection.restore(); }
        expect(injection.didInject()).toBe(true);
        expect((await readLocal(account))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('60');
        expect(readDeviceValueStrict('workout', account)).toBe(rawLegacy);
        expect(readDeviceValueStrict('workout-intent:' + first.intentId, account))
            .toBe(JSON.stringify(first));
    });

    it('rejects an ID-less shared intent without replay, overwrite or cleanup', async () => {
        const account = 'user:idless-intent-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const modern = saveWorkoutDeviceIntent(account, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        writeDeviceValue('workout-intent:' + modern.intentId, null, account);
        const invalid = { ...modern, intentId: undefined };
        const original = JSON.stringify(invalid);
        writeDeviceValue('workout', original, account);
        const sharedKey = protectedDeviceKey('workout', account);
        const ciphertext = localStorage.getItem(sharedKey);
        const envelopeKey = 'logbook:v2:' + account;
        const envelope = await idbGet(envelopeKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(envelope).toMatch(/^tlb-sealed:v1:/);

        expect(() => readWorkoutDeviceIntent(account)).toThrow('identificativo verificabile');
        await expect(recoverWorkoutDeviceIntent(account, () => true)).rejects.toThrow('identificativo verificabile');
        expect(() => saveWorkoutDeviceIntent(account, modern.workout, workout('60'), modern.baseline))
            .toThrow('identificativo verificabile');
        expect(() => persistPlainWorkoutSnapshot(null, account)).toThrow('identificativo verificabile');
        await expect(commitDomainOperations(account, { type: 'active-workout.set', workout: modern.workout },
            initial, undefined, invalid as unknown as NonNullable<Parameters<typeof commitDomainOperations>[4]>))
            .rejects.toThrow('Intento workout non valido per il journal');

        expect(await idbGet(envelopeKey)).toBe(envelope);
        expect(readDeviceValueStrict('workout', account)).toBe(original);
        expect(localStorage.getItem(sharedKey)).toBe(ciphertext);
        expect(readDeviceValueStrict('workout-intent:' + modern.intentId, account)).toBeNull();
    });

    it('repairs an unchanged older shared snapshot only when its private ancestor is authentic', async () => {
        const account = 'user:backed-ancestor-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const first = saveWorkoutDeviceIntent(account, initial.activeWorkout ?? null,
            workout('55'), initial.activeWorkout ?? null);
        const next = saveWorkoutDeviceIntent(account, first.workout, workout('60'), first.baseline);
        writeDeviceValue('workout', JSON.stringify(first), account);
        await recoverWorkoutDeviceIntent(account, () => true);
        expect((await readLocal(account))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('60');
        expect(readWorkoutDeviceIntent(account)?.intentId).toBe(next.intentId);
    });

    it('recovers a private draft when the shared snapshot write was interrupted', async () => {
        const testOwner = 'user:slot-before-shared';
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(testOwner);
        await initializeLocal(testOwner, initial);
        const intent = saveWorkoutDeviceIntent(testOwner, initial.activeWorkout ?? null,
            workout('57'), initial.activeWorkout ?? null);
        writeDeviceValue('workout', null, testOwner);
        expect(readWorkoutDeviceIntent(testOwner)).toBeNull();
        await recoverWorkoutDeviceIntent(testOwner, () => true);
        expect((await readLocal(testOwner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('57');
        expect(readWorkoutDeviceIntent(testOwner)?.intentId).toBe(intent.intentId);
        const beforeRetry = await readLocal(testOwner);
        await recoverWorkoutDeviceIntent(testOwner, () => true);
        expect(await readLocal(testOwner)).toEqual(beforeRetry);
    });

    it('retains a linked immutable chain until the latest edit is journalled', async () => {
        const testOwner = 'user:slot-rapid-edits';
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(testOwner);
        await initializeLocal(testOwner, initial);
        let previous = initial.activeWorkout ?? null;
        for (let i = 1; i <= 24; i++) {
            const next = workout(String(50 + i));
            saveWorkoutDeviceIntent(testOwner, previous, next, initial.activeWorkout ?? null);
            previous = next;
        }
        const slots = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            .filter(key => key?.startsWith('logbook:v2:' + testOwner + ':') && key.includes('workout-intent:'));
        expect(slots).toHaveLength(24);
        await recoverWorkoutDeviceIntent(testOwner, () => true);
        expect((await readLocal(testOwner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('74');
        const remaining = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            .filter(key => key?.startsWith('logbook:v2:' + testOwner + ':') && key.includes('workout-intent:'));
        expect(remaining).toHaveLength(0);
    });

    it('retains the committed head if ancestor cleanup fails midway, then recovers without a stale-witness block', async () => {
        const account = 'user:partial-witness-cleanup';
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const first = saveWorkoutDeviceIntent(account, initial.activeWorkout ?? null, workout('52'), initial.activeWorkout ?? null);
        const middle = saveWorkoutDeviceIntent(account, first.workout, workout('55'), first.baseline);
        const latest = saveWorkoutDeviceIntent(account, middle.workout, workout('60'), middle.baseline);
        await commitDomainOperations(account, { type: 'active-workout.set', workout: latest.workout }, initial, undefined, {
            generation: latest.generation, sequence: latest.sequence, consentRevision: latest.consentRevision,
            intentId: latest.intentId, parentIntentId: latest.parentIntentId,
            ancestorIds: latest.ancestorIds, baseline: latest.baseline,
        });

        const originalRemove = localStorageMock.removeItem.getMockImplementation();
        if (!originalRemove) throw new Error('Expected localStorage removeItem mock');
        let witnessRemovals = 0;
        localStorageMock.removeItem.mockImplementation((key: string) => {
            if (key.includes(':sealed:workout-intent:') && ++witnessRemovals === 2) {
                throw new DOMException('Storage cleanup interrupted', 'SecurityError');
            }
            return originalRemove(key);
        });
        try {
            await expect(releaseCommittedWorkoutSlot(account, latest)).rejects.toThrow();
        } finally {
            localStorageMock.removeItem.mockImplementation(originalRemove);
        }

        expect(witnessRemovals).toBe(2);
        expect(readDeviceValueStrict('workout-intent:' + first.intentId, account)).toBeNull();
        expect(readDeviceValueStrict('workout-intent:' + latest.intentId, account)).not.toBeNull();

        await recoverWorkoutDeviceIntent(account, () => true);
        for (const intent of [first, middle, latest]) {
            expect(readDeviceValueStrict('workout-intent:' + intent.intentId, account)).toBeNull();
        }
        expect((await readLocal(account))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('60');
    });

    it('retains its immutable witness if the shared snapshot write is denied after the first write', async () => {
        const testOwner = 'user:shared-write-denied';
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(testOwner);
        await initializeLocal(testOwner, initial);
        const write = localStorageMock.setItem.getMockImplementation();
        if (!write) throw new Error('Expected storage implementation');
        const sharedKey = protectedDeviceKey('workout', testOwner);
        localStorageMock.setItem.mockImplementation((key: string, value: string) => {
            if (key === sharedKey) throw new DOMException('Storage full', 'QuotaExceededError');
            return write(key, value);
        });
        try {
            expect(() => saveWorkoutDeviceIntent(testOwner, initial.activeWorkout ?? null,
                workout('55'), initial.activeWorkout ?? null)).toThrow(BrowserStorageError);
        } finally {
            localStorageMock.setItem.mockImplementation(write);
        }
        expect(readWorkoutDeviceIntent(testOwner)).toBeNull();
        const witnesses = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            .filter(key => key?.startsWith('logbook:v2:' + testOwner + ':') && key.includes('workout-intent:'));
        expect(witnesses).toHaveLength(1);
        await recoverWorkoutDeviceIntent(testOwner, () => true);
        const recovered = await readLocal(testOwner);
        expect(recovered?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
        expect(recovered?.pending.length).toBeGreaterThan(0);
        expect(readWorkoutDeviceIntent(testOwner)?.workout.exercises[0].sets[0].kg).toBe('55');
    });

});
