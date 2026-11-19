import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateGuestSession, captureSessionForOwner, GUEST_SESSION_KEY, revokeGuestSession } from '../../../src/lib/sync/session';
import { readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { advanceLocalConsentRevisionIfClean, commitDomainOperations, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { persistPlainWorkoutSnapshot, readWorkoutDeviceIntent, recoverWorkoutDeviceIntent, saveWorkoutDeviceIntent, unwrapWorkoutDeviceSnapshot } from '../../../src/lib/sync/workoutDeviceIntent';
import { getInitialLocalWorkout } from '../../../src/store/slices/createWorkoutSlice';
import { persistOwnerBoundWorkoutSnapshot } from '../../../src/lib/sync/deviceCriticalState';
import { assertHistoryEditorContextEpoch, HISTORY_EDITOR_CONTEXT } from '../../../src/hooks/workout/historyEditorContext';
import { workout, data, owner, prepareAccountWorkoutArchive } from './workoutDeviceIntentFixture';

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

});
