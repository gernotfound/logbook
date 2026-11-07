import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet, update as idbUpdate } from 'idb-keyval';
import { DomainParsers, UserDataSchema } from '../src/lib/schema';
import { equivalentWorkoutSnapshot } from '../src/lib/sync/workoutSnapshotEquality';
import { activateGuestSession, captureSession, captureSessionForOwner, GUEST_SESSION_KEY, revokeGuestSession } from '../src/lib/sync/session';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { BrowserStorageError } from '../src/lib/sync/browserStorage';
import { localStorageMock } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { advanceLocalConsentRevisionIfClean, commitDomainOperations, initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import {
    persistPlainWorkoutSnapshot, readWorkoutDeviceIntent, recoverWorkoutDeviceIntent, releaseCommittedWorkoutSlot, saveWorkoutDeviceIntent, unwrapWorkoutDeviceSnapshot,
} from '../src/lib/sync/workoutDeviceIntent';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { persistOwnerBoundWorkoutSnapshot } from '../src/lib/sync/deviceCriticalState';
import { assertHistoryEditorContextEpoch, HISTORY_EDITOR_CONTEXT } from '../src/hooks/workout/historyEditorContext';
import type { UserData, WorkoutSession } from '../src/types';

const workout = (kg: string): WorkoutSession => ({
    id: 'device-intent-w1', date: '2026-10-14', routineName: 'Allenamento',
    exercises: [{ id: 'se1', exId: 'bench', sessionNote: '', sets: [{ id: 's1', kg, reps: '8' }] }],
});
const data = (activeWorkout: WorkoutSession | null) => UserDataSchema.parse({ activeWorkout }) as unknown as UserData;
const owner = 'user:test-user-id';

async function prepareAccountWorkoutArchive(account: string): Promise<void> {
    if (account.startsWith('user:') && localStorage.getItem(`logbook:v2:${account}:health-consent-generation`) === null) {
        localStorage.setItem(`logbook:v2:${account}:health-consent-generation`, '1');
    }
    await prepareUnlockedTestArchive(account);
}


// Inject at the storage boundary rather than relying on how often recovery
// calls its session guard. The production transformation stays synchronous.
function injectAtArchiveUpdate(account: string, phase: 'before-transform' | 'after-commit', inject: () => void) {
    const original = vi.mocked(idbUpdate).getMockImplementation()!;
    let injected = false;
    vi.mocked(idbUpdate).mockImplementation(async (key, transform, store) => {
        await original(key, value => {
            if (!injected && key === 'logbook:v2:' + account && phase === 'before-transform') {
                injected = true;
                inject();
            }
            return transform(value);
        }, store);
        if (!injected && key === 'logbook:v2:' + account && phase === 'after-commit') {
            injected = true;
            inject();
        }
    });
    return {
        didInject: () => injected,
        restore: () => { vi.mocked(idbUpdate).mockImplementation(original); },
    };
}

describe('authenticated device-intent replay into semantic journal', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('fences a legacy plain workout after consent advances without altering its durable source', async () => {
        const account = 'user:legacy-plain-' + crypto.randomUUID();
        const epochKey = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(epochKey, '1');
        const baseline = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, baseline);
        const original = JSON.stringify(workout('65'));
        writeDeviceValue('workout', original, account);
        localStorage.setItem(epochKey, '3');
        expect(await advanceLocalConsentRevisionIfClean(account, 3)).toBe(true);
        const before = await readLocal(account);

        await expect(recoverWorkoutDeviceIntent(account, () => true)).resolves.toBeUndefined();
        expect(() => getInitialLocalWorkout(account, baseline.activeWorkout, baseline.history, undefined, undefined, 3))
            .toThrow('generazione di consenso non verificabile');
        expect(() => persistPlainWorkoutSnapshot(workout('75'), account))
            .toThrow('generazione di consenso non verificabile');
        expect(() => persistPlainWorkoutSnapshot(null, account))
            .toThrow('generazione di consenso non verificabile');
        // A captured token for a different active owner is rejected at the
        // earlier session boundary; it cannot overwrite the fenced snapshot.
        expect(() => persistOwnerBoundWorkoutSnapshot(captureSessionForOwner(account), account, workout('75')))
            .toThrow('Sessione cambiata');
        expect(() => saveWorkoutDeviceIntent(account, workout('65'), workout('75'), baseline.activeWorkout ?? null))
            .toThrow('generazione di consenso non verificabile');

        expect(readDeviceValueStrict('workout', account)).toBe(original);
        expect(await readLocal(account)).toEqual(before);
        expect((await readLocal(account))?.pending).toEqual([]);
    });

    it('does not adopt or overwrite an account plain workout without consent provenance at epoch one', async () => {
        const account = 'user:unmarked-plain-epoch-one-' + crypto.randomUUID();
        const epochKey = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(epochKey, '1');
        await prepareAccountWorkoutArchive(account);
        const initial = data(workout('50'));
        await initializeLocal(account, initial);
        const original = JSON.stringify(workout('60'));
        writeDeviceValue('workout', original, account);
        const before = await readLocal(account);

        expect(() => getInitialLocalWorkout(account, initial.activeWorkout, initial.history, undefined, undefined, 1))
            .toThrow('generazione di consenso non verificabile');
        expect(() => persistPlainWorkoutSnapshot(workout('70'), account))
            .toThrow('generazione di consenso non verificabile');
        expect(() => persistPlainWorkoutSnapshot(null, account))
            .toThrow('generazione di consenso non verificabile');
        expect(() => saveWorkoutDeviceIntent(account, workout('60'), workout('70'), initial.activeWorkout ?? null))
            .toThrow('generazione di consenso non verificabile');
        // An unrelated explicit backup may retain the raw evidence, but the
        // automatic workout state and the journal must never adopt it.
        await expect(recoverWorkoutDeviceIntent(account, () => true)).resolves.toBeUndefined();
        expect(readDeviceValueStrict('workout', account)).toBe(original);
        expect(await readLocal(account)).toEqual(before);
    });

    it('does not create an account plain snapshot without a current consent marker', async () => {
        const account = 'user:missing-plain-consent-' + crypto.randomUUID();
        await prepareUnlockedTestArchive(account);
        const initial = data(workout('50'));
        await initializeLocal(account, initial);
        const before = await readLocal(account);

        expect(() => persistPlainWorkoutSnapshot(workout('65'), account))
            .toThrow('Generazione consenso workout non verificabile');
        // Clearing an already absent copy is a no-op, not a new device write.
        expect(() => persistPlainWorkoutSnapshot(null, account)).not.toThrow();
        expect(() => getInitialLocalWorkout(account, initial.activeWorkout))
            .toThrow('Generazione consenso workout non verificabile');
        expect(readDeviceValueStrict('workout', account)).toBeNull();
        expect(await readLocal(account)).toEqual(before);
    });

    it('keeps guest plain workout snapshots without account consent metadata', async () => {
        const guest = 'guest';
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'plain-workout-guest-session');
        activateGuestSession('plain-workout-guest-session');
        await prepareUnlockedTestArchive(guest);
        persistPlainWorkoutSnapshot(workout('65'), guest);
        const original = readDeviceValueStrict('workout', guest);
        expect(original).toBe(JSON.stringify(workout('65')));
        expect(getInitialLocalWorkout(guest)?.exercises[0].sets[0].kg).toBe('65');
        // Guest hydration may normalize optional fields before rewriting its
        // still-guest record; it must never acquire an account consent marker.
        const refreshed = unwrapWorkoutDeviceSnapshot(JSON.parse(readDeviceValueStrict('workout', guest)!), guest);
        expect(refreshed.consentRevision).toBeUndefined();
        expect(refreshed.workout).toMatchObject(workout('65'));
        revokeGuestSession();
    });

    it('preserves source-epoch metadata on a plain workout and refuses an old stamped copy', async () => {
        const account = 'user:stamped-plain-' + crypto.randomUUID();
        const epochKey = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(epochKey, '1');
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        persistPlainWorkoutSnapshot(workout('55'), account);
        const stamped = readDeviceValueStrict('workout', account);
        expect(unwrapWorkoutDeviceSnapshot(JSON.parse(stamped!), account).consentRevision).toBe(1);
        localStorage.setItem(epochKey, '3');
        expect(await advanceLocalConsentRevisionIfClean(account, 3)).toBe(true);
        const before = await readLocal(account);

        expect(() => getInitialLocalWorkout(account, initial.activeWorkout, initial.history, undefined, undefined, 3))
            .toThrow('generazione di consenso precedente');
        expect(() => persistPlainWorkoutSnapshot(null, account)).toThrow('generazione di consenso precedente');
        expect(readDeviceValueStrict('workout', account)).toBe(stamped);
        expect(await readLocal(account)).toEqual(before);
    });

    it('supports fresh plain workout drafts in the current epoch without losing the consent witness', async () => {
        const account = 'user:fresh-plain-' + crypto.randomUUID();
        localStorage.setItem(`logbook:v2:${account}:health-consent-generation`, '3');
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        persistPlainWorkoutSnapshot(workout('55'), account);
        const raw = readDeviceValueStrict('workout', account);
        expect(unwrapWorkoutDeviceSnapshot(JSON.parse(raw!), account)).toMatchObject({
            isIntent: false, consentRevision: 3, workout: workout('55'),
        });
        const hydrated = getInitialLocalWorkout(account, initial.activeWorkout, initial.history, undefined, undefined, 3);
        expect(hydrated?.exercises[0].sets[0].kg).toBe('55');
        const intent = saveWorkoutDeviceIntent(account, hydrated, workout('60'), initial.activeWorkout ?? null);
        expect(intent.consentRevision).toBe(3);
        await recoverWorkoutDeviceIntent(account, () => true);
        expect((await readLocal(account))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('60');
    });

    it('rejects tampered plain workout metadata without overwriting or claiming a new consent', async () => {
        const account = 'user:invalid-plain-' + crypto.randomUUID();
        localStorage.setItem(`logbook:v2:${account}:health-consent-generation`, '3');
        const original = JSON.stringify({
            __logbookWorkoutSnapshot: 1, owner: 'user:someone-else',
            consentRevision: 3, workout: workout('80'),
        });
        await prepareAccountWorkoutArchive(account);
        writeDeviceValue('workout', original, account);
        expect(() => getInitialLocalWorkout(account, null, [], undefined, undefined, 3))
            .toThrow('Metadati dello snapshot workout non validi');
        expect(() => persistPlainWorkoutSnapshot(workout('90'), account))
            .toThrow('Metadati dello snapshot workout non validi');
        expect(readDeviceValueStrict('workout', account)).toBe(original);
    });

    it('preserves a suspended historical-editor workout of unknown source epoch', async () => {
        const account = 'user:history-epoch-' + crypto.randomUUID();
        const epochKey = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(epochKey, '1');
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const source = JSON.stringify({
            version: 1, editorId: 'historical-edit', suspended: workout('75'),
        });
        writeDeviceValue(HISTORY_EDITOR_CONTEXT, source, account);
        localStorage.setItem(epochKey, '3');
        expect(await advanceLocalConsentRevisionIfClean(account, 3)).toBe(true);
        const before = await readLocal(account);

        expect(() => assertHistoryEditorContextEpoch(source, account, before?.consentRevision))
            .toThrow('consenso editor storico non verificabile');
        expect(readDeviceValueStrict(HISTORY_EDITOR_CONTEXT, account)).toBe(source);
        expect(await readLocal(account)).toEqual(before);
        const stamped = JSON.stringify({
            version: 1, editorId: 'fresh-edit', suspended: workout('80'), consentRevision: 3,
        });
        expect(() => assertHistoryEditorContextEpoch(stamped, account, 3)).not.toThrow();
        expect(() => assertHistoryEditorContextEpoch(stamped, account, 1))
            .toThrow('Generazione consenso locale incoerente');
    });

    it('does not adopt a consent-unmarked history editor context for an account at epoch one', async () => {
        const account = 'user:history-unknown-origin-' + crypto.randomUUID();
        localStorage.setItem(`logbook:v2:${account}:health-consent-generation`, '1');
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, data(workout('50')));
        const original = JSON.stringify({
            version: 1, editorId: 'historical-edit', suspended: workout('70'),
        });
        writeDeviceValue(HISTORY_EDITOR_CONTEXT, original, account);
        const before = await readLocal(account);
        expect(() => assertHistoryEditorContextEpoch(original, account, 1))
            .toThrow('consenso editor storico non verificabile');
        expect(readDeviceValueStrict(HISTORY_EDITOR_CONTEXT, account)).toBe(original);
        expect(await readLocal(account)).toEqual(before);

        const stamped = JSON.stringify({
            version: 1, editorId: 'historical-edit', consentRevision: 1, suspended: workout('70'),
        });
        expect(() => assertHistoryEditorContextEpoch(stamped, account, 1)).not.toThrow();
        expect(() => assertHistoryEditorContextEpoch(original, 'guest')).not.toThrow();
    });

    it('never turns a pre-revocation device-only edit into a new-consent cloud journal', async () => {
        const account = 'user:old-device-epoch-' + crypto.randomUUID();
        const key = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(key, '1');
        const original = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, original);
        const intent = saveWorkoutDeviceIntent(account, (original.activeWorkout ?? null), workout('55'), (original.activeWorkout ?? null));
        expect(intent.consentRevision).toBe(1);
        const rawWitness = readDeviceValueStrict('workout-intent:' + intent.intentId, account);

        // The consent epoch advances while the synchronous workout intent has
        // not yet reached its atomic IndexedDB/journal transaction.
        localStorage.setItem(key, '3');
        expect(await advanceLocalConsentRevisionIfClean(account, 3)).toBe(true);
        const before = await readLocal(account);
        expect(before?.pending).toEqual([]);

        await expect(recoverWorkoutDeviceIntent(account, () => true))
            .rejects.toThrow('generazione di consenso');
        expect(await readLocal(account)).toEqual(before);
        expect(readDeviceValueStrict('workout-intent:' + intent.intentId, account)).toBe(rawWitness);
        expect(() => saveWorkoutDeviceIntent(account, workout('55'), workout('60'), (original.activeWorkout ?? null)))
            .toThrow('consenso precedente');
    });

    it('preserves an unmarked account intent in the first consent epoch without replay or overwrite', async () => {
        const account = 'user:unmarked-device-epoch-' + crypto.randomUUID();
        const key = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(key, '1');
        const original = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, original);
        const stamped = saveWorkoutDeviceIntent(account, original.activeWorkout ?? null, workout('55'), original.activeWorkout ?? null);
        const unmarked = { ...stamped, consentRevision: undefined };
        const originalBytes = JSON.stringify(unmarked);
        writeDeviceValue('workout', originalBytes, account);
        writeDeviceValue('workout-intent:' + stamped.intentId, originalBytes, account);
        const before = await readLocal(account);

        expect(() => readWorkoutDeviceIntent(account)).toThrow('senza provenienza');
        expect(() => getInitialLocalWorkout(account, original.activeWorkout, original.history, undefined, undefined, 1))
            .toThrow('senza provenienza');
        expect(() => saveWorkoutDeviceIntent(account, workout('55'), workout('60'), original.activeWorkout ?? null))
            .toThrow('senza provenienza');
        await expect(recoverWorkoutDeviceIntent(account, () => true)).rejects.toThrow('senza provenienza');
        await expect(commitDomainOperations(account, { type: 'active-workout.set', workout: unmarked.workout },
            original, () => true, { generation: unmarked.generation, sequence: unmarked.sequence,
                consentRevision: unmarked.consentRevision, intentId: unmarked.intentId, baseline: unmarked.baseline }))
            .rejects.toThrow('consenso precedente');
        expect(await readLocal(account)).toEqual(before);
        expect(readDeviceValueStrict('workout', account)).toBe(originalBytes);
        expect(readDeviceValueStrict('workout-intent:' + stamped.intentId, account)).toBe(originalBytes);
    });

    it('refuses new unmarked account intents before writing either device copy', async () => {
        const account = 'user:missing-consent-intent-' + crypto.randomUUID();
        const initial = data(workout('50'));
        await prepareUnlockedTestArchive(account);
        await initializeLocal(account, initial);
        const before = await readLocal(account);
        expect(() => saveWorkoutDeviceIntent(account, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null))
            .toThrow('Generazione consenso workout non verificabile');
        expect(readDeviceValueStrict('workout', account)).toBeNull();
        expect(await readLocal(account)).toEqual(before);
    });

    it('retains guest device intent support without account consent metadata', async () => {
        const guest = 'guest';
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'workout-intent-guest-session');
        activateGuestSession('workout-intent-guest-session');
        await prepareUnlockedTestArchive(guest);
        const current = saveWorkoutDeviceIntent(guest, null, workout('50'), null);
        expect(current.consentRevision).toBeUndefined();
        expect(readWorkoutDeviceIntent(guest)?.intentId).toBe(current.intentId);
        expect(readDeviceValueStrict('workout-intent:' + current.intentId, guest)).not.toBeNull();
        revokeGuestSession();
    });

    it('allows a fresh synchronous workout intent created under the current reaccepted epoch', async () => {
        const account = 'user:fresh-device-epoch-' + crypto.randomUUID();
        localStorage.setItem(`logbook:v2:${account}:health-consent-generation`, '3');
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, initial);
        const newer = saveWorkoutDeviceIntent(account, (initial.activeWorkout ?? null), workout('55'), (initial.activeWorkout ?? null));
        expect(newer.consentRevision).toBe(3);

        await recoverWorkoutDeviceIntent(account, () => true);
        const current = await readLocal(account);
        expect(current?.consentRevision).toBe(3);
        expect(current?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
        expect(current?.pending.length).toBeGreaterThan(0);
    });

    it('rechecks the original workout epoch inside the atomic IndexedDB commit', async () => {
        const account = 'user:atomic-device-epoch-' + crypto.randomUUID();
        const key = `logbook:v2:${account}:health-consent-generation`;
        localStorage.setItem(key, '1');
        const original = data(workout('50'));
        await prepareAccountWorkoutArchive(account);
        await initializeLocal(account, original);
        const intent = saveWorkoutDeviceIntent(account, (original.activeWorkout ?? null), workout('55'), (original.activeWorkout ?? null));
        localStorage.setItem(key, '3');
        expect(await advanceLocalConsentRevisionIfClean(account, 3)).toBe(true);
        const before = await readLocal(account);

        await expect(commitDomainOperations(account,
            { type: 'active-workout.set', workout: intent.workout }, original, () => true,
            { generation: intent.generation, sequence: intent.sequence,
              consentRevision: intent.consentRevision, intentId: intent.intentId,
              parentIntentId: intent.parentIntentId, ancestorIds: intent.ancestorIds,
              baseline: intent.baseline },
        )).rejects.toThrow('consenso precedente');
        expect(await readLocal(account)).toEqual(before);
    });

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

    it('replays a persisted device intent into the journal idempotently in the same test realm', async () => {
        const before = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
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

    it('blocks an equivalent background or reload workout intent from a previous consent epoch', async () => {
        const original = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
        await initializeLocal(owner, original);
        const intent = saveWorkoutDeviceIntent(owner, original.activeWorkout ?? null,
            workout('55'), original.activeWorkout ?? null);
        const sharedBefore = readDeviceValueStrict('workout', owner);
        const privateBefore = readDeviceValueStrict('workout-intent:' + intent.intentId, owner);

        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        expect(await advanceLocalConsentRevisionIfClean(owner, 3)).toBe(true);
        const envelopeBefore = await readLocal(owner);

        // The same workout value is not proof of a valid consent generation.
        expect(() => persistOwnerBoundWorkoutSnapshot(captureSession(), owner, workout('55')))
            .toThrow('generazione di consenso precedente');
        expect(readDeviceValueStrict('workout', owner)).toBe(sharedBefore);
        expect(readDeviceValueStrict('workout-intent:' + intent.intentId, owner)).toBe(privateBefore);
        expect(await readLocal(owner)).toEqual(envelopeBefore);
    });

    it('applies the latest rapid edit and refuses a delayed older IndexedDB commit', async () => {
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
        await initializeLocal(owner, initial);
        const first = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('52'), initial.activeWorkout ?? null);
        const latest = saveWorkoutDeviceIntent(owner, workout('52'), workout('57'), initial.activeWorkout ?? null);
        expect(latest.intentId).not.toBe(first.intentId);
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: latest.workout }, initial, undefined,
            { generation: latest.generation, sequence: latest.sequence, consentRevision: latest.consentRevision, intentId: latest.intentId, parentIntentId: latest.parentIntentId,
                ancestorIds: latest.ancestorIds, baseline: latest.baseline });
        const afterLatest = (await readLocal(owner))!;
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: first.workout }, initial, undefined,
            { generation: first.generation, sequence: first.sequence, consentRevision: first.consentRevision, intentId: first.intentId, baseline: first.baseline });
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
            await prepareAccountWorkoutArchive(parallelOwner);
            await initializeLocal(parallelOwner, original);
            const first = saveWorkoutDeviceIntent(parallelOwner, original.activeWorkout ?? null, workout(committedKg), original.activeWorkout ?? null);
            const competing = { ...first, intentId: 'b'.repeat(32), workout: workout(competingKg) };

            await commitDomainOperations(parallelOwner, { type: 'active-workout.set', workout: first.workout },
                original, undefined, { generation: first.generation, sequence: first.sequence, consentRevision: first.consentRevision, intentId: first.intentId, baseline: first.baseline });
            const committed = await readLocal(parallelOwner);
            // A second tab wrote after reading the same prior sequence.
            writeDeviceValue('workout', JSON.stringify(competing), parallelOwner);
            const deviceCopy = readDeviceValueStrict('workout', parallelOwner);
            await expect(commitDomainOperations(parallelOwner, { type: 'active-workout.set', workout: competing.workout },
                original, undefined, { generation: competing.generation, sequence: competing.sequence, consentRevision: competing.consentRevision, intentId: competing.intentId, baseline: competing.baseline }))
                .rejects.toThrow('Conflitto tra modifiche concorrenti');
            await expect(recoverWorkoutDeviceIntent(parallelOwner, () => true))
                .rejects.toThrow('Conflitto tra modifiche concorrenti');
            expect(await readLocal(parallelOwner)).toEqual(committed);
            expect(readDeviceValueStrict('workout', parallelOwner)).toBe(deviceCopy);
        }
    });

    it('rejects a newer sequence from a divergent tab branch before changing IndexedDB', async () => {
        const testOwner = 'user:divergent-ancestry';
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(testOwner);
        await initializeLocal(testOwner, initial);
        const first = saveWorkoutDeviceIntent(testOwner, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null);
        await commitDomainOperations(testOwner, { type: 'active-workout.set', workout: first.workout },
            initial, undefined, { generation: first.generation, sequence: first.sequence, consentRevision: first.consentRevision,
                intentId: first.intentId, baseline: first.baseline });
        const alreadyCommitted = await readLocal(testOwner);
        const competingParent = { ...first, intentId: 'b'.repeat(32), workout: workout('60') };
        writeDeviceValue('workout-intent:' + competingParent.intentId, JSON.stringify(competingParent), testOwner);
        const divergent = { ...first, intentId: 'c'.repeat(32), sequence: 2,
            parentIntentId: competingParent.intentId, workout: workout('65') };
        writeDeviceValue('workout-intent:' + divergent.intentId, JSON.stringify(divergent), testOwner);

        await expect(commitDomainOperations(testOwner, { type: 'active-workout.set', workout: divergent.workout },
            initial, undefined, { generation: divergent.generation, sequence: divergent.sequence, consentRevision: divergent.consentRevision,
                intentId: divergent.intentId, parentIntentId: divergent.parentIntentId, baseline: divergent.baseline }))
            .rejects.toThrow('non discendente');
        expect(await readLocal(testOwner)).toEqual(alreadyCommitted);
        expect(readDeviceValueStrict('workout-intent:' + divergent.intentId, testOwner))
            .toBe(JSON.stringify(divergent));
    });

    it('accepts a newer snapshot whose intervening intent is still uncommitted', async () => {
        const testOwner = 'user:linear-ancestry';
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(testOwner);
        await initializeLocal(testOwner, initial);
        const first = saveWorkoutDeviceIntent(testOwner, initial.activeWorkout ?? null, workout('52'), initial.activeWorkout ?? null);
        const middle = saveWorkoutDeviceIntent(testOwner, first.workout, workout('55'), first.baseline);
        const latest = saveWorkoutDeviceIntent(testOwner, middle.workout, workout('60'), middle.baseline);
        await commitDomainOperations(testOwner, { type: 'active-workout.set', workout: first.workout },
            initial, undefined, { generation: first.generation, sequence: first.sequence, consentRevision: first.consentRevision,
                intentId: first.intentId, baseline: first.baseline });
        await commitDomainOperations(testOwner, { type: 'active-workout.set', workout: latest.workout },
            initial, undefined, { generation: latest.generation, sequence: latest.sequence, consentRevision: latest.consentRevision,
                intentId: latest.intentId, parentIntentId: latest.parentIntentId,
                ancestorIds: latest.ancestorIds, baseline: latest.baseline });
        expect((await readLocal(testOwner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('60');
    });

    it('allows an equivalent retry at the same generation/sequence without duplicate journal entries', async () => {
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
        await initializeLocal(owner, initial);
        const intent = saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null);
        await recoverWorkoutDeviceIntent(owner, () => true);
        const before = (await readLocal(owner))!;
        const expanded = DomainParsers.parseActiveWorkout(intent.workout);
        if (!expanded) throw new Error('Expected valid workout');
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: expanded }, initial, undefined,
            { generation: intent.generation, sequence: intent.sequence, consentRevision: intent.consentRevision, intentId: intent.intentId, baseline: intent.baseline });
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.pending).toEqual(before.pending);
        expect((await readLocal(owner))?.revision).toBe(before.revision);
    });

    it('accepts semantically identical serialized and Zod-expanded snapshots without masking competing edits', async () => {
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
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
        expect(saved?.lastWorkoutDeviceIntent).toMatchObject({ generation: first.generation, sequence: 2,
            intentId: second.intentId, parentIntentId: first.intentId });
        expect(saved?.pending.length).toBeGreaterThan(0);
    });

    it('accepts a durable baseline with Zod-expanded optional fields without losing its session identity', async () => {
        const rawBaseline: WorkoutSession = { ...workout('50'), pains: undefined };
        await prepareAccountWorkoutArchive(owner);
        await initializeLocal(owner, data(rawBaseline));
        saveWorkoutDeviceIntent(owner, rawBaseline, workout('55'), rawBaseline);
        await recoverWorkoutDeviceIntent(owner, () => true);
        expect((await readLocal(owner))?.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
    });

    it('preserves an intentionally null first baseline through subsequent synchronous edits', async () => {
        await prepareAccountWorkoutArchive(owner);
        await initializeLocal(owner, data(null));
        const first = saveWorkoutDeviceIntent(owner, null, workout('50'), null);
        const second = saveWorkoutDeviceIntent(owner, first.workout, workout('55'), workout('50'));
        expect(second.baseline).toBeNull();
        await recoverWorkoutDeviceIntent(owner, () => true);
        const saved = (await readLocal(owner))!;
        expect(saved.data.activeWorkout?.exercises[0].sets[0].kg).toBe('55');
        expect(saved.lastWorkoutDeviceIntent?.sequence).toBe(2);
        expect(saved.lastWorkoutDeviceIntent?.intentId).toBe(second.intentId);
        expect(saved.lastWorkoutDeviceIntent?.ancestorIds).toContain(first.intentId);
    });

    it('rejects an unrelated durable workout without deleting the saved device intent', async () => {
        const before = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
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
        await prepareAccountWorkoutArchive(owner);
        await initializeLocal(owner, initial);
        writeDeviceValue('workout', '{broken-json', owner);
        expect(() => saveWorkoutDeviceIntent(owner, initial.activeWorkout ?? null, workout('55'), initial.activeWorkout ?? null))
            .toThrow('corrotto');
        expect(readDeviceValueStrict('workout', owner)).toBe('{broken-json');
    });

    it('keeps the device intent intact when IndexedDB rejects its transaction', async () => {
        const initial = data(workout('50'));
        await prepareAccountWorkoutArchive(owner);
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
