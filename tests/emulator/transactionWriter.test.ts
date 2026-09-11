import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import { documentChanges, projectDocuments } from '../../src/lib/sync/documentProjection';
import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';
import type { CachedGlobalCatalog, UserData } from '../../src/types';
const catalog = { exercises: [], foods: [] } as unknown as CachedGlobalCatalog;
const data = (input: Partial<UserData> = {}) => UserDataSchema.parse(input) as unknown as UserData;
let env: RulesTestEnvironment;
beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed');
    env = await initializeTestEnvironment({ projectId: 'demo-logbook-audit', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

it('imports one day without replacing the other 30 remote days, including on retry', async () => {
    const db = env.authenticatedContext('a').firestore();
    const nutrition = Object.fromEntries(Array.from({ length: 31 }, (_, i) => { const date = `2026-08-${String(i + 1).padStart(2, '0')}`; return [date, { date, weight: 70 + i / 10 }]; }));
    const remote = projectDocuments(data({ nutrition }), catalog).get('nutrition_months/2026-08')!;
    const ref = doc(db, 'users/a/nutrition_months/2026-08');
    await setDoc(ref, remote);
    const base = data();
    const desired = data({ nutrition: { '2026-08-15': { date: '2026-08-15', weight: 71.4, notes: 'imported' } } });
    // A new record overlapping a remote day changes only previously absent fields.
    const changes = documentChanges(base, desired, catalog);
    const first = await applyDocumentChanges(db, 'a', changes, () => true);
    expect(first.conflicts).toEqual([]);
    const saved = (await getDoc(ref)).data()!;
    expect(Object.keys(saved)).toHaveLength(31);
    expect(saved['2026-08-01']).toEqual(remote['2026-08-01']);
    expect(saved['2026-08-15'].notes).toBe('imported');
    expect((await applyDocumentChanges(db, 'a', changes, () => true)).conflicts).toEqual([]);
    expect((await getDoc(ref)).data()).toEqual(saved);
});

it('converges two independent profile edits from separate clients', async () => {
    const one = env.authenticatedContext('a').firestore();
    const two = env.authenticatedContext('a', { device: 'second' }).firestore();
    const base = data({ profile: { height: '170', gender: 'M' } });
    await setDoc(doc(one, 'users/a'), projectDocuments(base, catalog).get('')!);
    const first = documentChanges(base, data({ ...base, profile: { height: '171', gender: 'M' } }), catalog);
    const second = documentChanges(base, data({ ...base, profile: { height: '170', gender: 'F' } }), catalog);
    const results = await Promise.all([applyDocumentChanges(one, 'a', first, () => true), applyDocumentChanges(two, 'a', second, () => true)]);
    expect(results.every(result => result.conflicts.length === 0)).toBe(true);
    expect((await getDoc(doc(one, 'users/a'))).data()?.profile).toMatchObject({ height: '171', gender: 'F' });
});

it('preserves both collision alternatives and writes none of the independent documents', async () => {
    const db = env.authenticatedContext('a').firestore();
    const base = data({ profile: { height: '170' } });
    const remote = data({ profile: { height: '172' } });
    await setDoc(doc(db, 'users/a'), projectDocuments(remote, catalog).get('')!);
    const desired = data({ profile: { height: '171' }, nutrition: { '2026-09-01': { date: '2026-09-01', weight: 80 } } });
    const result = await applyDocumentChanges(db, 'a', documentChanges(base, desired, catalog), () => true);
    expect(result.conflicts).toContainEqual({ path: ['profile', 'height'], base: '170', local: '171', remote: '172' });
    expect((await getDoc(doc(db, 'users/a'))).data()?.profile.height).toBe('172');
    expect((await getDoc(doc(db, 'users/a/nutrition_months/2026-09'))).exists()).toBe(false);
});

it('deletes one known day while preserving a remotely added day in the same month', async () => {
    const db = env.authenticatedContext('a').firestore();
    const base = data({ nutrition: { '2026-09-01': { date: '2026-09-01', weight: 80 } } });
    const remote = data({ nutrition: { ...base.nutrition, '2026-09-02': { date: '2026-09-02', weight: 81 } } });
    const ref = doc(db, 'users/a/nutrition_months/2026-09');
    await setDoc(ref, projectDocuments(remote, catalog).get('nutrition_months/2026-09')!);
    const result = await applyDocumentChanges(db, 'a', documentChanges(base, data(), catalog), () => true);
    expect(result.conflicts).toEqual([]);
    expect(Object.keys((await getDoc(ref)).data()!)).toEqual(['2026-09-02']);
});

it('refuses a session invalidated between transaction start and read completion', async () => {
    const db = env.authenticatedContext('a').firestore();
    let checks = 0;
    await expect(applyDocumentChanges(db, 'a', documentChanges(data(), data({ profile: { height: '171' } }), catalog), () => ++checks < 3)).rejects.toThrow('Sessione cambiata');
    expect((await getDoc(doc(db, 'users/a'))).exists()).toBe(false);
});
