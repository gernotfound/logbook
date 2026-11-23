import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde sleep drafts must never import Firebase');
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
import { isVaultUnlocked, lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';

const uid = 'k_' + 'S'.repeat(43);
const owner = 'user:' + uid;
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const date = '2026-11-20';
const slot = protectedDeviceKey('draft_sleep', owner);
let online = true;

type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

async function readVerifiedLocal() {
    const grant = await unlockVaultForOwner(owner);
    try { return await readLocal(owner); }
    finally { grant.release(); }
}

function browser(fixture: Fixture) {
    const session = fixture.sessions.get(uid);
    if (!session) throw Error('Synthetic Kinde session missing');
    let current = true;
    const send: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('sec-fetch-site', 'same-origin');
        headers.set('cookie', session.cookies);
        const request = new Request(ORIGIN + String(input), { ...init, headers });
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        return routeCandidateFirstPartyApi(request, {
            APP_ORIGIN: ORIGIN,
            KINDE_HTTP: { fetch: (r: Request) => kinde.fetch(r, env) },
            D1_API: { fetch: (r: Request) => api.fetch(r, env) },
        });
    };
    return {
        send, browserCookies: () => '__Host-logbook_csrf=' + session.csrf,
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
        manifest: { version: 'sleep-candidate', updatedAt: '2026-11-20T00:00:00.000Z',
            schemaVersion: 1, docRefs: { exercises: 'test/ex', foods: 'test/food' },
            itemCounts: { exercises: 0, foods: 0 } },
        exercises: [], foods: [], cachedAt: 0,
    });
    const held = new Set<string>();
    vi.stubGlobal('navigator', { get onLine() { return online; }, locks: {
        request: async (name: string, options: LockOptions,
            work: (lock: { name: string } | null) => Promise<unknown>) => {
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

describe('Kinde sleep: encrypted local draft, owner guards, authenticated domain journal', () => {
    it('restores the sealed original day, clears optional phases and preserves measurements/activity', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            await first.submit({ type: 'nutrition-day.patch', date, patch: {
                weight: 81, sleepHours: '07:00', sleepDeep: '02:00',
            } });
            await first.submit({ type: 'activity-steps.set', date, steps: 3000 });
            const draft = await first.openSleepDraft(date);
            expect(draft.initial).toMatchObject({ date, hasExisting: true,
                values: { sleepHours: '07:00', sleepDeep: '02:00' } });
            draft.write({ ...draft.initial.values, sleepHours: '08:15',
                sleepDeep: '', sleepRem: '01:10' });
            const sealed = localStorage.getItem(slot);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            expect(sealed).not.toContain('08:15');
            first.close();
            expect(localStorage.getItem(slot)).toBe(sealed);

            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const resumed = await second.openSleepDraft('2026-11-21');
            expect(resumed.initial.date).toBe(date);
            expect(resumed.initial.values).toMatchObject({ sleepHours: '08:15', sleepRem: '01:10' });
            await expect(second.saveSleepDraft(resumed)).resolves.toMatchObject({
                outcome: { kind: 'cloud-acknowledged' }, draftCleared: true,
            });
            expect(second.snapshot()?.data.nutrition?.[date]).toMatchObject({
                weight: 81, steps: 3000, sleepHours: '08:15', sleepRem: '01:10',
            });
            expect(second.snapshot()?.data.nutrition?.[date]?.sleepDeep).toBeUndefined();
            expect(localStorage.getItem(slot)).toBeNull();
            expect(fixture.count('sync_receipts', uid)).toBe(3);
            expect(isVaultUnlocked(owner)).toBe(false);
            second.close();
        } finally { fixture.close(); }
    });

    it('refuses an old sleep baseline after another realm writes the same night', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            await first.submit({ type: 'nutrition-day.patch', date, patch: {
                sleepHours: '07:20', weight: 79, sleepLight: '04:00',
            } });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await first.openSleepDraft(date);
            draft.write({ ...draft.initial.values, sleepHours: '08:00' });
            const sealed = localStorage.getItem(slot);
            await second.submit({ type: 'nutrition-day.patch', date, patch: { sleepHours: '06:30' } });
            await expect(first.saveSleepDraft(draft)).rejects.toThrow('sonno è cambiato');
            expect(localStorage.getItem(slot)).toBe(sealed);
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            expect((await readVerifiedLocal())?.data.nutrition?.[date]).toMatchObject({
                weight: 79, sleepLight: '04:00', sleepHours: '06:30',
            });
            first.close();
            second.close();
        } finally { fixture.close(); }
    });

    it('keeps a durable encrypted journal while offline without claiming a cloud ACK', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openSleepDraft(date);
            draft.write({ ...draft.initial.values, sleepHours: '08:05', sleepAwake: '00:10' });
            online = false;
            await expect(realm.saveSleepDraft(draft)).resolves.toMatchObject({
                outcome: { kind: 'local-pending' }, draftCleared: true,
            });
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            const stored = await readVerifiedLocal();
            expect(stored?.pending?.length).toBeGreaterThan(0);
            expect(stored?.data.nutrition?.[date]).toMatchObject({
                sleepHours: '08:05', sleepAwake: '00:10',
            });
            expect(await get<string>('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(slot)).toBeNull();
            expect(isVaultUnlocked(owner)).toBe(false);
            realm.close();
        } finally { fixture.close(); }
    });

    it('validates total and optional phases before commit and retains editable ciphertext', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openSleepDraft(date);
            draft.write({ ...draft.initial.values, sleepHours: '24:00' });
            await expect(realm.saveSleepDraft(draft)).rejects.toThrow('ore di sonno');
            draft.write({ ...draft.initial.values, sleepHours: '08:00', sleepDeep: '26:40' });
            await expect(realm.saveSleepDraft(draft)).rejects.toThrow('sonno profondo');
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            draft.write({ ...draft.initial.values, sleepHours: '08:00', sleepDeep: '02:15' });
            await expect(realm.saveSleepDraft(draft)).resolves.toMatchObject({
                outcome: { kind: 'cloud-acknowledged' },
            });
            expect(realm.snapshot()?.data.nutrition?.[date]).toMatchObject({
                sleepHours: '08:00', sleepDeep: '02:15',
            });
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            realm.close();
        } finally { fixture.close(); }
    });

    it('prevents simultaneous device editors and preserves an exact retained draft', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const first = await openKindeCandidateFitnessRealm({ ...client, expected });
            const second = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await first.openSleepDraft(date);
            draft.write({ ...draft.initial.values, sleepHours: '07:45' });
            await expect(second.openSleepDraft(date)).rejects.toThrow('un’altra scheda');
            const sealed = localStorage.getItem(slot);
            first.close();
            const resumed = await second.openSleepDraft(date);
            expect(resumed.initial.values.sleepHours).toBe('07:45');
            expect(localStorage.getItem(slot)).toBe(sealed);
            resumed.close();
            second.close();
        } finally { fixture.close(); }
    });

    it('keeps the submitted marker on cleanup failure and rejects a second attempt', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openSleepDraft(date);
            draft.write({ ...draft.initial.values, sleepHours: '07:50' });
            const remove = localStorage.removeItem.bind(localStorage);
            const failing = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
                if (key === slot) throw Error('Injected storage failure');
                remove(key);
            });
            await expect(realm.saveSleepDraft(draft)).resolves.toMatchObject({
                outcome: { kind: 'cloud-acknowledged' }, draftCleared: false,
            });
            failing.mockRestore();
            const recovered = await realm.openSleepDraft(date);
            expect(recovered.initial.submitted).toBe(true);
            await expect(realm.saveSleepDraft(recovered)).rejects.toThrow('già tentato');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            recovered.discard();
            expect(localStorage.getItem(slot)).toBeNull();
            realm.close();
        } finally { fixture.close(); }
    });

    it('invalidates a stale consent generation while preserving the sealed draft', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            const realm = await openKindeCandidateFitnessRealm({ ...client, expected });
            const draft = await realm.openSleepDraft(date);
            draft.write({ ...draft.initial.values, sleepHours: '07:30' });
            const sealed = localStorage.getItem(slot);
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '2');
            expect(() => draft.write({ ...draft.initial.values, sleepHours: '09:00' })).toThrow();
            await expect(realm.saveSleepDraft(draft)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(localStorage.getItem(slot)).toBe(sealed);
            expect(fixture.count('sync_receipts', uid)).toBe(0);
            realm.close();
        } finally { fixture.close(); }
    });
});
