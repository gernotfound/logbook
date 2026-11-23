import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('The Kinde measurement editor must never load Firebase');
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
import { protectedDeviceKey } from '../../../src/lib/sync/deviceStorageKeys';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';

const uid = 'k_' + 'M'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const DATE = '2026-11-20';
const slot = protectedDeviceKey('draft_measurement', owner);
let online = true;

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

function browser(fixture: Fixture) {
    const session = fixture.sessions.get(uid);
    if (!session) throw Error('Synthetic account missing');
    let current = true;
    const paths: string[] = [];
    const send: typeof fetch = async (input, init) => {
        const path = String(input);
        paths.push(path);
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        return routeCandidateFirstPartyApi(new Request(ORIGIN + path, { ...init, headers }), {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (request: Request) => kinde.fetch(request, { ...fixture.env, APP_ORIGIN: ORIGIN }) },
            D1_API: { fetch: (request: Request) => api.fetch(request, { ...fixture.env, APP_ORIGIN: ORIGIN }) },
        });
    };
    return {
        paths, send,
        browserCookies: () => '__Host-logbook_csrf=' + session.csrf,
        stillCurrent: () => current,
        stop: () => { current = false; },
    };
}

beforeEach(async () => {
    online = true;
    lockAllVaults();
    await clear();
    localStorage.clear();
    catalogSource.read.mockReset().mockResolvedValue({
        manifest: { version: 'measurement', updatedAt: '2026-11-20T00:00:00.000Z',
            schemaVersion: 1, docRefs: { exercises: 'test/ex', foods: 'test/food' },
            itemCounts: { exercises: 0, foods: 0 } },
        exercises: [], foods: [], cachedAt: 0,
    });
    const held = new Set<string>();
    vi.stubGlobal('navigator', { get onLine() { return online; }, locks: {
        request: async (name: string, options: LockOptions, work: (lock: { name: string } | null) => Promise<unknown>) => {
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

describe('candidate-only measurement editor, authenticated encrypted device draft and D1 journal', () => {
    it('recovers input after closure, persists a single measurement and deletes only its exact device draft', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await first.openMeasurementDraft(DATE);
            draft.write({ ...draft.initial.values, weight: '75,5', waist: '90', neck: '40', measureTime: '08:30' });
            const sealed = localStorage.getItem(slot);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            expect(sealed).not.toContain('75,5');
            first.close();
            expect(localStorage.getItem(slot)).toBe(sealed);

            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const resumed = await second.openMeasurementDraft('2026-11-21');
            expect(resumed.initial.date).toBe(DATE);
            expect(resumed.initial.values).toMatchObject({ weight: '75,5', measureTime: '08:30' });
            await expect(second.saveMeasurementDraft(resumed)).resolves.toMatchObject({
                outcome: { kind: 'cloud-acknowledged' }, draftCleared: true,
            });
            expect(second.snapshot()?.data.nutrition?.[DATE]).toMatchObject({
                weight: 75.5, waist: 90, neck: 40, measurementTime: '08:30',
            });
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(localStorage.getItem(slot)).toBeNull();
            second.close();
        } finally { fixture.close(); }
    });

    it('rejects a stale measurement after another account view edits its day, preserving other day fields and ciphertext', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            await first.submit({ type: 'nutrition-day.patch', date: DATE, patch: {
                weight: 72, sleepHours: '07:30', waist: 88,
            } });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await first.openMeasurementDraft(DATE);
            draft.write({ ...draft.initial.values, weight: '73' });
            const sealed = localStorage.getItem(slot);
            await second.submit({ type: 'nutrition-day.patch', date: DATE, patch: { weight: 76 } });
            await expect(first.saveMeasurementDraft(draft)).rejects.toThrow('misurazione è cambiata');
            expect(localStorage.getItem(slot)).toBe(sealed);
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            expect((await readLocal(owner))?.data.nutrition?.[DATE]).toMatchObject({
                weight: 76, sleepHours: '07:30', waist: 88,
            });
            first.close();
            second.close();
        } finally { fixture.close(); }
    });

    it('commits offline only to IndexedDB journal, with no invented cloud receipt', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openMeasurementDraft(DATE);
            draft.write({ ...draft.initial.values, weight: '82', chest: '100' });
            online = false;
            await expect(realm.saveMeasurementDraft(draft)).resolves.toMatchObject({
                outcome: { kind: 'local-pending' }, draftCleared: true,
            });
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            expect((await readLocal(owner))?.data.nutrition?.[DATE]).toMatchObject({
                weight: 82, chest: 100,
            });
            expect(localStorage.getItem(slot)).toBeNull();
            realm.close();
        } finally { fixture.close(); }
    });

    it('requires valid measurements and current biometric baseline for US Navy calculation', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            await realm.submit({ type: 'profile.patch', patch: { height: '177', gender: 'M' } });
            const draft = await realm.openMeasurementDraft(DATE);
            draft.write({ ...draft.initial.values, weight: '0x41' });
            await expect(realm.saveMeasurementDraft(draft)).rejects.toThrow('valore valido per il peso');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            draft.write({ ...draft.initial.values, weight: '79', waist: '92', neck: '38', calculateBf: true });
            await expect(realm.saveMeasurementDraft(draft)).resolves.toMatchObject({
                outcome: { kind: 'cloud-acknowledged' },
            });
            expect(realm.snapshot()?.data.nutrition?.[DATE]).toMatchObject({
                weight: 79, bfProvenance: { method: 'us_navy', inputs: { gender: 'M', heightCm: 177 } },
            });
            realm.close();
        } finally { fixture.close(); }
    });

    it('blocks two tabs from editing one draft and never adopts a modified device witness', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await first.openMeasurementDraft(DATE);
            draft.write({ ...draft.initial.values, weight: '84' });
            await expect(second.openMeasurementDraft(DATE)).rejects.toThrow('un’altra scheda');
            first.close();
            const copy = localStorage.getItem(slot);
            const resumed = await second.openMeasurementDraft(DATE);
            expect(resumed.initial.values.weight).toBe('84');
            expect(localStorage.getItem(slot)).toBe(copy);
            resumed.close();
            second.close();
        } finally { fixture.close(); }
    });

    it('retains a submitted marker when cleanup fails and refuses duplicate journal intent', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openMeasurementDraft(DATE);
            draft.write({ ...draft.initial.values, weight: '80' });
            const remove = localStorage.removeItem.bind(localStorage);
            const failing = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
                if (key === slot) throw new Error('Injected device storage failure');
                remove(key);
            });
            await expect(realm.saveMeasurementDraft(draft)).resolves.toMatchObject({
                outcome: { kind: 'cloud-acknowledged' }, draftCleared: false,
            });
            failing.mockRestore();
            const recovered = await realm.openMeasurementDraft(DATE);
            expect(recovered.initial.submitted).toBe(true);
            await expect(realm.saveMeasurementDraft(recovered)).rejects.toThrow('già tentato');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            recovered.discard();
            expect(localStorage.getItem(slot)).toBeNull();
            realm.close();
        } finally { fixture.close(); }
    });
});
