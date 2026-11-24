import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde realm must not load Firebase');
});
const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: catalogSource.read,
}));

import api from '../../../cloudflare/api/worker.mjs';
import kinde from '../../../cloudflare/auth/kinde-http-worker.mjs';
import { routeCandidateFirstPartyApi } from '../../../cloudflare/first-party-api-candidate.mjs';
import { createCloudKeyHttpFixture, ORIGIN } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { openKindeCandidateFitnessRealm } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { isVaultUnlocked, lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { beginLocalPurge } from '../../../src/lib/sync/localPurgeFence';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';
import { protectedDeviceKey } from '../../../src/lib/sync/deviceStorageKeys';
import { readDeviceValueStrict } from '../../../src/lib/sync/deviceStorageRead';
import { captureActivitySteps } from '../../../src/lib/activity';
import { requiredUpdateRecoveryRegistry } from '../../../src/lib/sync/requiredUpdateRecovery';

const uid = 'k_' + 'P'.repeat(43);
const otherUid = 'k_' + 'Q'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const witnessNamePrefix = 'draft:dated-intent:';
const witnessKeyPrefix = protectedDeviceKey(witnessNamePrefix, owner);
const datedWitnessKeys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => key?.startsWith(witnessKeyPrefix) === true);
let online: boolean;
const catalog = {
    manifest: { version: 'cf03-realm', updatedAt: '2026-11-21T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

function browser(fixture: Fixture, account = uid) {
    const session = fixture.sessions.get(account);
    if (!session) throw Error('Synthetic Kinde session missing');
    let csrf = '__Host-logbook_csrf=' + session.csrf;
    let current = true;
    const paths: string[] = [];
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        paths.push(path);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        return routeCandidateFirstPartyApi(new Request(ORIGIN + path, { ...init, headers }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, env) },
            D1_API: { fetch: (request: Request) => api.fetch(request, env) },
        });
    };
    return {
        send, paths,
        browserCookies: () => csrf,
        stillCurrent: () => current,
        rotate: () => { csrf = '__Host-logbook_csrf=' + 'Z'.repeat(43); },
        stop: () => { current = false; },
    };
}

beforeEach(async () => {
    online = true;
    lockAllVaults();
    await clear();
    localStorage.clear();
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    const held = new Set<string>();
    vi.stubGlobal('navigator', { get onLine() { return online; }, locks: {
        request: async (name: string, options: LockOptions, work: (lock: { name: string } | null) => Promise<unknown>) => {
            // Web Locks dispatch the request after already scheduled releases.
            await new Promise<void>(resolve => setImmediate(resolve));
            if (options.ifAvailable && held.has(name)) return work(null);
            held.add(name);
            try { return await work({ name }); } finally { held.delete(name); }
        },
    } });
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('isolated Kinde fitness realm with trusted owner, no Firebase/global grant', () => {
    it('restores a sealed cycle draft and creates and selects the first cycle as one intent', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const slot = protectedDeviceKey('draft_training_cycle', owner);
        try {
            await fixture.consent(uid);
            const first = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                await first.submit({ type: 'routine.create', routine: { id: 'cycle-routine', name: 'Scheda', exercises: [] } });
                const draft = await first.openCycleDraft();
                draft.write({
                    ...draft.initial.values, name: 'Primo ciclo', durationWeeks: '4',
                    dateTextInput: '12/10/2026', endDateTextInput: '08/11/2026',
                    cycleRoutines: [{ routineId: 'cycle-routine', frequencyPerWeek: 1 }],
                });
                expect(localStorage.getItem(slot)).toMatch(/^tlb-sealed:v1:/);
                expect(localStorage.getItem(slot)).not.toContain('Primo ciclo');
                const sealed = localStorage.getItem(slot);
                requiredUpdateRecoveryRegistry.captureAll();
                expect(localStorage.getItem(slot)).toBe(sealed);
            } finally { first.close(); }
            const reopened = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                const resumed = await reopened.openCycleDraft();
                expect(resumed.initial.values.name).toBe('Primo ciclo');
                expect(resumed.initial.stale).toBe(false);
                await expect(reopened.saveCycleDraft(resumed)).resolves.toMatchObject({
                    outcome: { kind: 'cloud-acknowledged' }, draftCleared: true,
                });
                const data = reopened.snapshot()?.data;
                expect(data?.trainingCycles).toMatchObject([{ name: 'Primo ciclo', startDate: '2026-10-12' }]);
                expect(data?.activeCycleId).toBe(data?.trainingCycles?.[0]?.id);
                expect(fixture.count('sync_receipts', uid)).toBe(2);
                expect(localStorage.getItem(slot)).toBeNull();
            } finally { reopened.close(); }
        } finally { fixture.close(); }
    });

    it('recovers a Kinde cardio draft and saves it without replacing steps or sleep', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const date = '2026-10-12';
        try {
            await fixture.consent(uid);
            const first = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                await first.submit([
                    { type: 'activity-steps.set', date, steps: 4200 },
                    { type: 'nutrition-day.patch', date, patch: { sleepHours: '07:00' } },
                ]);
                const draft = await first.openCardioDraft(date, null);
                draft.write({ ...draft.initial.values, modality: 'bike', durationMinutes: '35',
                    intensity: 'moderate', distanceKm: '8,2', notes: 'Sessione fixture' });
                expect(datedWitnessKeys()).toHaveLength(1);
            } finally { first.close(); }
            const reopened = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                const draft = await reopened.openCardioDraft(date, null);
                expect(draft.initial.values).toMatchObject({ modality: 'bike', durationMinutes: '35', distanceKm: '8,2' });
                await expect(reopened.saveCardioDraft(draft)).resolves.toMatchObject({
                    outcome: { kind: 'cloud-acknowledged' }, draftCleared: true,
                });
                expect(reopened.snapshot()?.data.nutrition?.[date]).toMatchObject({
                    steps: 4200, sleepHours: '07:00',
                    cardioSessions: [{ modality: 'bike', durationMinutes: 35, intensity: 'moderate', distanceKm: 8.2 }],
                });
                expect(fixture.count('sync_receipts', uid)).toBe(2);
                expect(datedWitnessKeys()).toEqual([]);
            } finally { reopened.close(); }
        } finally { fixture.close(); }
    });

    it('preserves cardio when a confirmed edit and removal both observe a stale session', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const date = '2026-10-12';
        const original = { id: 'bike-example', modality: 'bike', durationMinutes: 35, intensity: 'moderate' } as const;
        try {
            await fixture.consent(uid);
            const first = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            const second = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                await first.submit({ type: 'cardio-session.upsert', date, session: original });
                await second.refresh();
                const draft = await first.openCardioDraft(date, original.id);
                draft.write({ ...draft.initial.values, durationMinutes: '40' });
                const [key] = datedWitnessKeys();
                const before = localStorage.getItem(key);
                await second.submit({ type: 'cardio-session.upsert', date, session: { ...original, durationMinutes: 28 } });
                await expect(first.saveCardioDraft(draft)).rejects.toThrow('Sessione cardio cambiata');
                expect(localStorage.getItem(key)).toBe(before);
                await expect(first.submit({ type: 'cardio-session.delete', date, sessionId: original.id, expected: original }))
                    .rejects.toThrow('è cambiata');
                expect(fixture.count('sync_receipts', uid)).toBe(2);
                expect((await second.refresh()).data.nutrition?.[date]?.cardioSessions).toMatchObject([{ durationMinutes: 28 }]);
            } finally { first.close(); second.close(); }
        } finally { fixture.close(); }
    });

    it('recovers the separately witnessed steps draft and acknowledges only the selected day', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const date = '2026-10-12';
        const slot = protectedDeviceKey('draft:activity-steps:' + date, owner);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            try {
                await first.submit({ type: 'nutrition-day.patch', date, patch: { sleepHours: '07:00' } });
                const draft = await first.openStepsDraft(date);
                draft.write('8124');
                const [key] = datedWitnessKeys();
                const initialDraft = localStorage.getItem(slot);
                const witness = localStorage.getItem(key);
                expect(initialDraft).toMatch(/^tlb-sealed:v1:/);
                expect(witness).toMatch(/^tlb-sealed:v1:/);
                expect(witness).not.toBe(initialDraft);
                requiredUpdateRecoveryRegistry.captureAll();
                expect(localStorage.getItem(slot)).toBe(initialDraft);
                expect(localStorage.getItem(key)).toBe(witness);
            } finally { first.close(); }
            const reopened = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                const draft = await reopened.openStepsDraft(date);
                expect(draft.initial).toMatchObject({ date, steps: '8124', submitted: false });
                await expect(reopened.saveStepsDraft(draft)).resolves.toMatchObject({
                    outcome: { kind: 'cloud-acknowledged' }, draftCleared: true,
                });
                expect(reopened.snapshot()?.data.nutrition?.[date]).toMatchObject({ steps: 8124, sleepHours: '07:00' });
                expect(fixture.count('sync_receipts', uid)).toBe(2);
                expect(datedWitnessKeys()).toEqual([]);
                expect(localStorage.getItem(slot)).toMatch(/^tlb-sealed:v1:/);
                expect(isVaultUnlocked(owner)).toBe(false);
            } finally { reopened.close(); }
        } finally { fixture.close(); }
    });

    it('fences stale steps edits and removal while keeping the other writer’s value', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const date = '2026-10-12';
        const slot = protectedDeviceKey('draft:activity-steps:' + date, owner);
        try {
            await fixture.consent(uid);
            const first = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            const second = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                const draft = await first.openStepsDraft(date);
                draft.write('8124');
                const original = localStorage.getItem(slot);
                await expect(second.openStepsDraft(date)).rejects.toThrow('un’altra scheda');
                const oldSteps = captureActivitySteps(first.snapshot()?.data.nutrition?.[date]);
                await second.submit({ type: 'activity-steps.set', date, steps: 5600, capturedAt: 2367 });
                await expect(first.saveStepsDraft(draft)).rejects.toThrow('I passi sono cambiati');
                expect(localStorage.getItem(slot)).toBe(original);
                await expect(first.submit({ type: 'activity-steps.clear', date, expected: oldSteps }))
                    .rejects.toThrow('I passi sono cambiati');
                expect(fixture.count('sync_receipts', uid)).toBe(1);
                expect((await second.refresh()).data.nutrition?.[date]?.steps).toBe(5600);
            } finally { first.close(); second.close(); }
        } finally { fixture.close(); }
    });

    it('keeps the independent copy after a failed canonical write and blocks save and reload', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        const date = '2026-10-12';
        const slot = protectedDeviceKey('draft:activity-steps:' + date, owner);
        try {
            await fixture.consent(uid);
            const realm = await openKindeCandidateFitnessRealm({ ...browser(fixture), expected });
            try {
                const draft = await realm.openStepsDraft(date);
                const store = localStorage.setItem.bind(localStorage);
                const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
                    if (key === slot) throw new DOMException('Quota exceeded', 'QuotaExceededError');
                    store(key, value);
                });
                try { expect(() => draft.write('8124')).toThrow(); }
                finally { write.mockRestore(); }
                const [key] = datedWitnessKeys();
                const witness = localStorage.getItem(key);
                expect(witness).toMatch(/^tlb-sealed:v1:/);
                expect(localStorage.getItem(slot)).toBeNull();
                const grant = await unlockVaultForOwner(owner);
                try {
                    const name = witnessNamePrefix + key.slice(witnessKeyPrefix.length);
                    const raw = readDeviceValueStrict(name, owner);
                    expect(JSON.parse(raw!)).toMatchObject({
                        owner, consentRevision: 1, draftName: 'draft:activity-steps:' + date, values: { steps: '8124' },
                    });
                } finally { grant.release(); }
                expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow();
                await expect(realm.saveStepsDraft(draft)).rejects.toThrow();
                expect(fixture.count('sync_receipts', uid)).toBe(0);
                expect(localStorage.getItem(key)).toBe(witness);
            } finally { realm.close(); }
        } finally { fixture.close(); }
    });

    it('saves an exercise without consuming the routine draft and opens both with separate device locks', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const routine = await realm.openRoutineDraft();
            const exercise = await realm.openExerciseDraft();
            routine.write({ name: 'Scheda ancora in bozza', exercises: [] });
            exercise.write({ ...exercise.initial.values, name: 'Esercizio salvato', notes: 'Setup cifrato' });
            const routineSlot = protectedDeviceKey('draft_routine', owner);
            const exerciseSlot = protectedDeviceKey('draft_exercise', owner);
            const before = localStorage.getItem(routineSlot);
            expect(before).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(exerciseSlot)).toMatch(/^tlb-sealed:v1:/);
            expect(isVaultUnlocked(owner)).toBe(false);
            await expect(realm.saveExerciseDraft(exercise))
                .resolves.toMatchObject({ outcome: { kind: 'cloud-acknowledged' }, draftCleared: true });
            expect(localStorage.getItem(exerciseSlot)).toBeNull();
            expect(localStorage.getItem(routineSlot)).toBe(before);
            expect(() => routine.write({ name: 'Editor precedente', exercises: [] })).toThrow();
            const recovered = await realm.openRoutineDraft();
            expect(recovered.initial.name).toBe('Scheda ancora in bozza');
            expect(realm.snapshot()?.data.library).toMatchObject([{ name: 'Esercizio salvato', notes: 'Setup cifrato' }]);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            realm.close();
        } finally { fixture.close(); }
    });

    it('rejects deletion when another realm adds a routine reference after the confirmation snapshot', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            const id = 'exercise-confirmed-earlier';
            await first.submit({ type: 'exercise.upsert', exercise: { id, name: 'Esercizio da conservare', setsCount: 3, sets: [] } });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(first.snapshot()?.data.routines ?? []).toEqual([]);
            await second.submit({
                type: 'routine.create', routine: { id: 'new-reference', name: 'Nuova scheda', exercises: [{ exId: id, setsCount: 4 }] },
            });
            await expect(first.submit({ type: 'exercise.delete', id, expectedRoutineIds: [] }))
                .rejects.toThrow('schede collegate cambiati');
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            const { data } = await second.refresh();
            expect(data.library?.map(exercise => exercise.id)).toEqual([id]);
            expect(data.routines?.[0]?.exercises).toMatchObject([{ exId: id, setsCount: 4 }]);
            first.close();
            second.close();
        } finally { fixture.close(); }
    });

    it('recovers a sealed routine draft after close and submits it once without a global vault grant', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const slot = protectedDeviceKey('draft_routine', owner);
            const draft = await first.openRoutineDraft();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(localStorage.getItem(slot)).toBeNull();
            draft.write({ name: 'Scheda privata', exercises: [] });
            const raw = localStorage.getItem(slot);
            expect(raw).toMatch(/^tlb-sealed:v1:/);
            expect(raw).not.toContain('Scheda privata');
            await expect(second.openRoutineDraft()).rejects.toThrow('un’altra scheda');
            first.close();
            expect(() => draft.write({ name: 'Stale', exercises: [] })).toThrow();
            expect(localStorage.getItem(slot)).toBe(raw);

            const recovered = await second.openRoutineDraft();
            expect(recovered.initial).toMatchObject({ name: 'Scheda privata', routineId: draft.initial.routineId });
            await expect(second.saveRoutineDraft(recovered))
                .resolves.toMatchObject({ outcome: { kind: 'cloud-acknowledged' }, draftCleared: true });
            expect(second.snapshot()?.data.routines).toEqual([{ id: draft.initial.routineId, name: 'Scheda privata', exercises: [] }]);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(localStorage.getItem(slot)).toBeNull();
            expect(isVaultUnlocked(owner)).toBe(false);
            second.close();
        } finally { fixture.close(); }
    });

    it('detects a replaced draft inside the offline transaction and preserves the observed ciphertext and journal', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openRoutineDraft();
            const slot = protectedDeviceKey('draft_routine', owner);
            draft.write({ name: 'Prima versione', exercises: [] });
            const replacement = localStorage.getItem(slot)!;
            draft.write({ name: 'Seconda versione', exercises: [] });
            const envelope = await get('logbook:v2:' + owner);
            online = false;
            catalogSource.read.mockImplementationOnce(async () => {
                localStorage.setItem(slot, replacement);
                return catalog;
            });
            await expect(realm.saveRoutineDraft(draft)).rejects.toThrow('Bozza cambiata');
            expect(await get('logbook:v2:' + owner)).toBe(envelope);
            expect(localStorage.getItem(slot)).toBe(replacement);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            expect(isVaultUnlocked(owner)).toBe(false);
            realm.close();
        } finally { fixture.close(); }
    });

    it('preserves a committed draft marker when cleanup fails and never sends that attempt twice', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openRoutineDraft();
            const slot = protectedDeviceKey('draft_routine', owner);
            draft.write({ name: 'Una sola volta', exercises: [] });
            const removeItem = localStorage.removeItem.bind(localStorage);
            const removal = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
                if (key === slot) throw new Error('Device storage failure');
                removeItem(key);
            });
            await expect(realm.saveRoutineDraft(draft))
                .resolves.toMatchObject({ outcome: { kind: 'cloud-acknowledged' }, draftCleared: false });
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            removal.mockRestore();
            const recovered = await realm.openRoutineDraft();
            expect(recovered.initial).toMatchObject({ name: 'Una sola volta', submitted: true });
            await expect(realm.saveRoutineDraft(recovered)).rejects.toThrow('già tentato');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            recovered.discard();
            expect(localStorage.getItem(slot)).toBeNull();
            realm.close();
        } finally { fixture.close(); }
    });

    it('preserves a draft after the consent generation changes and blocks the old editor from submitting or clearing it', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openRoutineDraft();
            draft.write({ name: 'Bozza prima della revoca', exercises: [] });
            const slot = protectedDeviceKey('draft_routine', owner);
            const raw = localStorage.getItem(slot);
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '2');
            expect(() => draft.write({ name: 'Non deve cambiare', exercises: [] })).toThrow();
            expect(() => draft.discard()).toThrow();
            await expect(realm.saveRoutineDraft(draft)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(localStorage.getItem(slot)).toBe(raw);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            expect(realm.snapshot()).toBeNull();
            realm.close();
        } finally { fixture.close(); }
    });

    it('preserves the newer committed routine when an editor starts from older values', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            const id = 'routine-already-editing';
            await first.submit({ type: 'routine.create', routine: { id, name: 'Nome iniziale', exercises: [] } });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const editor = await first.openRoutineDraft(id);
            editor.write({ name: 'Nome dalla bozza vecchia', exercises: [] });
            const slot = protectedDeviceKey('draft_routine', owner);
            const raw = localStorage.getItem(slot);
            await second.submit({ type: 'routine.edit', id, name: 'Nome già confermato', exercises: [] });
            await expect(first.saveRoutineDraft(editor)).rejects.toThrow('Scheda cambiata');
            expect(localStorage.getItem(slot)).toBe(raw);
            const observed = await second.refresh();
            expect(observed.data.routines).toEqual([{ id, name: 'Nome già confermato', exercises: [] }]);
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            first.close();
            second.close();
        } finally { fixture.close(); }
    });

    it('confirms a nutrition planning edit through encrypted local storage and a verified D1 receipt', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const plan = { ...createDefaultNutritionPlanning(), weight: 78, onDaysCount: 3, notes: 'Prova' };
            await expect(realm.submit({
                type: 'nutrition-planning.replace', value: plan, origin: 'user-edited',
            })).resolves.toMatchObject({ kind: 'cloud-acknowledged' });
            expect(realm.snapshot()?.data).toMatchObject({
                nutritionPlanning: plan, nutritionPlanningOrigin: 'user-edited',
            });
            expect(await get('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            expect(client.paths).toContain('/v1/sync/receipt');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            realm.close();
        } finally { fixture.close(); }
    });

    it('journals two edits offline with no HTTP, then reconciles exactly once on reconnect', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const before = client.paths.length;
            online = false;
            for (const [index, height] of ['181', '184'].entries()) {
                await expect(realm.submit({ type: 'profile.patch', patch: { height } }))
                    .resolves.toEqual({ kind: 'local-pending', pendingCount: index + 1 });
                expect(realm.snapshot()?.data.profile?.height).toBe(height);
                expect(isVaultUnlocked(owner)).toBe(false);
            }
            expect(client.paths).toHaveLength(before);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            const sealed = await get('logbook:v2:' + owner);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            await expect(openKindeCandidateFitnessRealm({ ...client, expected }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            expect(client.paths).toHaveLength(before);

            online = true;
            expect(realm.snapshot()).toBeNull();
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '190' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(client.paths).toHaveLength(before);
            await expect(realm.refresh()).resolves.toMatchObject({ data: { profile: { height: '184' } } });
            const receipts = fixture.count('sync_receipts', uid);
            expect(receipts).toBe(1);
            await realm.refresh();
            expect(fixture.count('sync_receipts', uid)).toBe(receipts);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('applies the deadline again inside IndexedDB after a local writer yields', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const deadline = Date.now() + 60_000;
            fixture.sqlite.prepare('UPDATE auth_sessions SET idle_expires_at_ms=? WHERE uid=?').run(deadline, uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const before = await get('logbook:v2:' + owner);
            const requests = client.paths.length;
            online = false;
            catalogSource.read.mockImplementationOnce(async () => {
                vi.spyOn(Date, 'now').mockReturnValue(deadline + 1_000);
                return catalog;
            });
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '181' } })).rejects.toThrow();
            expect(realm.snapshot()).toBeNull();
            expect(await get('logbook:v2:' + owner)).toBe(before);
            expect(client.paths).toHaveLength(requests);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('withdraws the offline view and edit witness when local purge starts', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            online = false;
            expect(realm.isCurrent()).toBe(true);
            expect(realm.snapshot()).toMatchObject({ owner });
            const sealed = await get('logbook:v2:' + owner);
            const requests = client.paths.length;

            beginLocalPurge(owner);

            expect(realm.snapshot()).toBeNull();
            expect(realm.isCurrent()).toBe(false);
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '199' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            expect(client.paths).toHaveLength(requests);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            realm.close();
        } finally { fixture.close(); }
    });

    it('bounds offline access by the primary session clock even when the device clock has a fixed offset', async () => {
        for (const offset of [-120_000, 120_000]) {
            const fixture = await createCloudKeyHttpFixture([uid]);
            const realNow = Date.now;
            try {
                await fixture.consent(uid);
                const expiry = realNow() + 30_000;
                fixture.sqlite.prepare('UPDATE auth_sessions SET idle_expires_at_ms=? WHERE uid=?').run(expiry, uid);
                const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
                const client = browser(fixture);
                const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
                online = false;
                const sealed = await get('logbook:v2:' + owner);
                const requests = client.paths.length;
                expect(realm.snapshot()).toMatchObject({ owner });

                clock.mockReturnValue(expiry + offset + 1_000);
                expect(realm.snapshot()).toBeNull();
                await expect(realm.submit({ type: 'profile.patch', patch: { height: '199' } }))
                    .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
                expect(await get('logbook:v2:' + owner)).toBe(sealed);
                expect(client.paths).toHaveLength(requests);
                realm.close();
            } finally {
                vi.restoreAllMocks();
                online = true;
                lockAllVaults();
                await clear();
                localStorage.clear();
                fixture.close();
            }
        }
    });

    it('expires an observed account realm without a browser event, blocking plaintext and writes', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const expiry = Date.now() + 30_000;
            fixture.sqlite.prepare('UPDATE auth_sessions SET idle_expires_at_ms=? WHERE uid=?').run(expiry, uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const sealed = await get('logbook:v2:' + owner);
            const requests = client.paths.length;
            expect(realm.snapshot()).not.toBeNull();
            vi.spyOn(Date, 'now').mockReturnValue(expiry + 1_000);
            expect(realm.isCurrent()).toBe(false);
            expect(realm.snapshot()).toBeNull();
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '199' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(client.paths).toHaveLength(requests);
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            realm.close();
        } finally { fixture.close(); }
    });

    it('expires a Kinde realm when the monotonic clock advances and the wall clock stops', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const expiry = Date.now() + 30_000;
            fixture.sqlite.prepare('UPDATE auth_sessions SET idle_expires_at_ms=? WHERE uid=?').run(expiry, uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(realm.snapshot()).not.toBeNull();
            vi.spyOn(Date, 'now').mockReturnValue(Date.now());
            const oldPerformance = performance.now();
            vi.spyOn(performance, 'now').mockReturnValue(oldPerformance + 60_000);
            expect(realm.snapshot()).toBeNull();
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '199' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            realm.close();
        } finally { fixture.close(); }
    });

    it('rejects an account realm when its trusted session expiry is missing', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const send: typeof fetch = async (input, init) => {
                const response = await client.send(input, init);
                if (String(input) !== '/v1/consent/status') return response;
                const headers = new Headers(response.headers);
                headers.delete('X-Logbook-Session-Expires-At-Ms');
                return new Response(await response.text(), { status: response.status, headers });
            };
            await expect(openKindeCandidateFitnessRealm({ ...client, expected, send }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(authenticatedIdentitySource.hasReader()).toBe(false);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('preserves the encrypted edit when consent was revoked on another device before reconnect', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            online = false;
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '181' } }))
                .resolves.toMatchObject({ kind: 'local-pending' });
            const sealed = await get('logbook:v2:' + owner);
            await fixture.withdraw(uid);
            online = true;
            await expect(realm.refresh()).rejects.toThrow();
            expect(realm.snapshot()).toBeNull();
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            expect(client.paths).not.toContain('/v1/sync/commit');
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('opens a read-only snapshot, commits a domain intent with one verified D1 receipt, and closes without leaking a DEK', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(realm.isCurrent()).toBe(true);
            expect(realm.snapshot()).toMatchObject({ owner, principal: expected });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(authenticatedIdentitySource.hasReader()).toBe(false);

            // Returned data is a copy, not a mutable reference to the
            // realm's authorized snapshot.
            const loose = realm.snapshot()!;
            loose.data.profile = { ...(loose.data.profile ?? {}), height: '999' };
            expect(realm.snapshot()?.data.profile?.height).not.toBe('999');

            await expect(realm.submit({
                type: 'profile.patch', patch: { height: '181' },
            })).resolves.toMatchObject({ kind: 'cloud-acknowledged' });
            expect(realm.snapshot()?.data.profile?.height).toBe('181');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            realm.close();
            expect(realm.snapshot()).toBeNull();
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '182' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('invalidates owner data and refuses any write on CSRF rotation, withdrawal marker or cancelled generation', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(realm.snapshot()).not.toBeNull();
            client.rotate();
            expect(realm.isCurrent()).toBe(false);
            expect(realm.snapshot()).toBeNull();
            const before = client.paths.length;
            await expect(realm.submit({ type: 'profile.patch', patch: { height: '188' } }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(client.paths).toHaveLength(before);
            realm.close();

            const second = browser(fixture);
            const revoked = await openKindeCandidateFitnessRealm({ ...second, expected });
            localStorage.setItem('logbook:v2:' + owner + ':health-consent-withdrawal', 'pending:1');
            expect(revoked.snapshot()).toBeNull();
            await expect(revoked.refresh()).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            revoked.close();

            localStorage.removeItem('logbook:v2:' + owner + ':health-consent-withdrawal');
            const cancelled = browser(fixture);
            cancelled.stop();
            await expect(openKindeCandidateFitnessRealm({ ...cancelled, expected }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            expect(fixture.count('sync_documents', otherUid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('never associates another authenticated Kinde session with the requested owner', async () => {
        const fixture = await createCloudKeyHttpFixture([uid, otherUid]);
        try {
            await fixture.consent(uid);
            const foreign = browser(fixture, otherUid);
            await expect(openKindeCandidateFitnessRealm({
                ...foreign, expected,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(foreign.paths).toContain('/api/auth/session');
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
            expect(fixture.count('sync_documents', uid)).toBe(0);
            expect(fixture.count('sync_documents', otherUid)).toBe(0);
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it('recovers a response lost AFTER D1 commit immediately and keeps subsequent refresh idempotent', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let lost = false;
            const send: typeof fetch = async (input, init) => {
                if (String(input) === '/v1/sync/commit' && !lost) {
                    lost = true;
                    const committed = await client.send(input, init);
                    expect(committed.ok).toBe(true);
                    throw new TypeError('synthetic response lost after commit');
                }
                return client.send(input, init);
            };
            const realm = await openKindeCandidateFitnessRealm({ ...client, send, expected });
            const outcome = await realm.submit({
                type: 'profile.patch', patch: { height: '193' },
            });
            // The existing receipt bridge may immediately reconcile this
            // already-committed batch. That verified ACK is stronger than
            // artificially forcing a pending state for the UI.
            expect(outcome).toMatchObject({ kind: 'cloud-acknowledged', operations: 1 });
            expect(realm.snapshot()?.data.profile?.height).toBe('193');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            const reconciled = await realm.refresh();
            expect(reconciled.data.profile?.height).toBe('193');
            expect(realm.snapshot()?.data.profile?.height).toBe('193');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            const grant = await unlockVaultForOwner(owner);
            try {
                const local = await readLocal(owner);
                expect(local?.pending).toHaveLength(0);
                expect(local?.data.profile?.height).toBe('193');
                expect(local?.cloudflareDelivery).toBeUndefined();
            } finally {
                grant.release();
            }
            expect(isVaultUnlocked(owner)).toBe(false);
            realm.close();
        } finally {
            fixture.close();
        }
    });

    it('blocks stale plaintext after a lost response and recovers exactly the pending ciphertext on fresh trusted scope', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let lost = false;
            const send: typeof fetch = async (input, init) => {
                if (String(input) === '/v1/sync/commit' && !lost) {
                    lost = true;
                    throw new TypeError('synthetic transport loss');
                }
                return client.send(input, init);
            };
            const realm = await openKindeCandidateFitnessRealm({ ...client, send, expected });
            const outcome = await realm.submit({
                type: 'profile.patch', patch: { height: '192' },
            });
            expect(outcome).toMatchObject({ kind: 'local-pending', pendingCount: 1 });
            expect(realm.snapshot()).toBeNull();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);

            const grant = await unlockVaultForOwner(owner);
            try {
                const local = await readLocal(owner);
                expect(local?.pending).toHaveLength(1);
                expect(local?.data.profile?.height).toBe('192');
                expect(local?.cloudflareDelivery).toBeDefined();
            } finally {
                grant.release();
            }
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            const reconciled = await realm.refresh();
            expect(reconciled.data.profile?.height).toBe('192');
            expect(realm.snapshot()?.data.profile?.height).toBe('192');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            realm.close();

            const resumed = await openKindeCandidateFitnessRealm({ ...client, expected });
            expect(resumed.snapshot()?.data.profile?.height).toBe('192');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(isVaultUnlocked(owner)).toBe(false);
            resumed.close();
        } finally {
            fixture.close();
        }
    });
});
