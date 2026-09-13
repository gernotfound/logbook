import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, waitForPendingWrites } from 'firebase/firestore';
const sdk = vi.hoisted(() => ({ db: null as any, auth: { currentUser: { uid: 'a' } } }));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth, getDb: () => sdk.db, ensureAppCheck: async () => {}, waitForPendingWrites: (db: any) => waitForPendingWrites(db) }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { DB as RealDB } from '../../src/lib/db';
import { dbState as __testDbState } from '../../src/lib/db/db_core';
import { readLocal, initializeLocal, commitLocal } from '../../src/lib/sync/localRepository';
const DB = {
    ...RealDB,
    saveUserData: async (state: any, _rev?: any) => {
        let oldState = __testDbState.lastSavedStateStr ? JSON.parse(__testDbState.lastSavedStateStr) : {};
        const uid = sdk.auth.currentUser?.uid;
        if (uid) await commitLocal('user:' + uid, state, oldState);
        return RealDB.saveUserData(state, _rev);
    }
};
import { UserDataSchema } from '../../src/lib/schema';
import { projectDocuments } from '../../src/lib/sync/documentProjection';
import type { UserData, CachedGlobalCatalog } from '../../src/types';
const catalog = { exercises: [], foods: [] } as unknown as CachedGlobalCatalog;
const data = (input: Partial<UserData> = {}) => UserDataSchema.parse(input) as unknown as UserData;
let env: RulesTestEnvironment;
beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the local emulator is allowed');
    vi.stubGlobal('navigator', { onLine: true });
    env = await initializeTestEnvironment({ projectId: 'demo-logbook-audit', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await clear(); DB.resetCache(); sdk.db = env.authenticatedContext('a').firestore(); sdk.auth.currentUser = { uid: 'a' }; });
afterAll(async () => { await env?.cleanup(); vi.unstubAllGlobals(); });
it('stages, replicates and acknowledges through the actual DB and SDK path', async () => {
    const desired = data({ profile: { height: '171' } });
    expect(await DB.saveUserData(desired)).toEqual({ ok: true, status: 'synced' });
    expect((await getDoc(doc(sdk.db, 'users/a'))).data()?.profile.height).toBe('171');
    expect((await readLocal('user:a'))?.pending).toEqual([]);
    expect(await get('pending_sync_token')).toBeUndefined();
    expect(await get('pending_sync_payload')).toBeUndefined();
});
it('keeps offline data durable and replays after reconnect without another edit', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const desired = data({ profile: { height: '171' } });
    expect((await DB.saveUserData(desired)).status).toBe('local-pending');
    expect((await readLocal('user:a'))?.pending).toHaveLength(1);
    expect((await getDoc(doc(sdk.db, 'users/a'))).exists()).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    expect((await DB.saveUserData((await readLocal('user:a'))!.data)).status).toBe('synced');
    expect((await readLocal('user:a'))?.pending).toEqual([]);
});
it('retains the owner journal when real Rules reject a write', async () => {
    sdk.db = env.authenticatedContext('b').firestore();
    const result = await DB.saveUserData(data({ profile: { height: '171' } }));
    expect(result.status).toBe('rejected');
    expect((await readLocal('user:a'))?.data.profile.height).toBe('171');
    expect((await readLocal('user:a'))?.pending).toHaveLength(1);
});
it('adopts independent remote fields without overwriting them with the old local snapshot', async () => {
    const base = data({ profile: { height: '170', gender: 'M' } });
    const desired = data({ profile: { height: '171', gender: 'M' } });
    await initializeLocal('user:a', base);
    await commitLocal('user:a', desired, base);
    await setDoc(doc(sdk.db, 'users/a'), projectDocuments(data({ profile: { height: '170', gender: 'F' } }), catalog).get('')!);
    expect((await DB.saveUserData(desired)).status).toBe('synced');
    expect((await readLocal('user:a'))?.data.profile).toMatchObject({ height: '171', gender: 'F' });
    expect((await readLocal('user:a'))?.pending).toEqual([]);
});
