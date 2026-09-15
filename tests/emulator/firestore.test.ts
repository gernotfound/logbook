import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Run via test:rules: only the isolated local emulator is allowed');
    env = await initializeTestEnvironment({ projectId: 'demo-logbook-audit', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

it('allows the owner to create, read and delete their own profile', async () => {
    const ref = doc(env.authenticatedContext('a').firestore(), 'users/a');
    await assertSucceeds(setDoc(ref, { profile: { height: '175' }, nutritionPlanningOrigin: 'user-edited', _schemaVersion: 1 }));
    expect((await assertSucceeds(getDoc(ref))).data()?.profile.height).toBe('175');
    await assertSucceeds(deleteDoc(ref));
});

it('allows the clean-cut unversioned schema-1 baseline, marks it lazily, and prevents marker downgrade', async () => {
    const db = env.authenticatedContext('a').firestore();
    const root = doc(db, 'users/a');
    await assertSucceeds(setDoc(root, { profile: { name: 'baseline' } }));
    await assertSucceeds(setDoc(root, { profile: { name: 'current' }, _schemaVersion: 1 }));
    await assertFails(setDoc(root, { profile: { name: 'marker-dropped' } }));
    await assertFails(setDoc(root, { profile: { name: 'future' }, _schemaVersion: 2 }));

    for (const collection of ['history_months', 'nutrition_months']) {
        const ref = doc(db, `users/a/${collection}/2026-09`);
        await assertSucceeds(setDoc(ref, {}));
        await assertSucceeds(setDoc(ref, { _schemaVersion: 1 }));
        await assertFails(setDoc(ref, {}));
        await assertFails(setDoc(ref, { _schemaVersion: 2 }));
    }
});

it.each(['anonymous', 'b'])('denies %s all operations on another user and their private collections', async identity => {
    const db = identity === 'anonymous' ? env.unauthenticatedContext().firestore() : env.authenticatedContext(identity).firestore();
    for (const path of ['users/a', 'users/a/history_months/2026-09', 'users/a/nutrition_months/2026-09', 'users/a/telemetry_events/e', 'users/a/telemetry_errors/e', 'users/a/telemetry_anomalies/e']) {
        const ref = doc(db, path);
        await assertFails(getDoc(ref));
        await assertFails(setDoc(ref, {}));
        await assertFails(deleteDoc(ref));
    }
});

it('makes account_deletions server-only and immediately blocks the owner on every private path', async () => {
    const ownerDb = env.authenticatedContext('a').firestore();
    const privatePaths = [
        'users/a',
        'users/a/history_months/2026-09',
        'users/a/nutrition_months/2026-09',
        'users/a/telemetry_events/e',
        'users/a/telemetry_errors/e',
        'users/a/telemetry_anomalies/e',
    ];

    await assertFails(getDoc(doc(ownerDb, 'account_deletions/a')));
    await assertFails(setDoc(doc(ownerDb, 'account_deletions/a'), { status: 'requested' }));

    await env.withSecurityRulesDisabled(async context => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'users/a'), { profile: { name: 'before barrier' } });
        await setDoc(doc(adminDb, 'users/a/history_months/2026-09'), { value: true });
        await setDoc(doc(adminDb, 'users/a/nutrition_months/2026-09'), { value: true });
        await setDoc(doc(adminDb, 'users/a/telemetry_events/e'), { type: 'x' });
        await setDoc(doc(adminDb, 'users/a/telemetry_errors/e'), { type: 'x' });
        await setDoc(doc(adminDb, 'users/a/telemetry_anomalies/e'), { type: 'x' });
        await setDoc(doc(adminDb, 'account_deletions/a'), { uid: 'a', status: 'requested', attempts: 0 });
    });

    for (const path of privatePaths) {
        const ref = doc(ownerDb, path);
        await assertFails(getDoc(ref));
        await assertFails(setDoc(ref, path === 'users/a' ? { profile: { name: 'resurrected' } } : {}));
        await assertFails(deleteDoc(ref));
    }

    await env.withSecurityRulesDisabled(async context => {
        await deleteDoc(doc(context.firestore(), 'account_deletions/a'));
    });
    await assertSucceeds(getDoc(doc(ownerDb, 'users/a')));
});

it('rejects unknown root fields, invalid origin and malformed month paths', async () => {
    const db = env.authenticatedContext('a').firestore();
    await assertFails(setDoc(doc(db, 'users/a'), { unknown: true }));
    await assertFails(setDoc(doc(db, 'users/a'), { nutritionPlanningOrigin: 'injected' }));
    for (const name of ['history_months', 'nutrition_months']) {
        await assertFails(setDoc(doc(db, `users/a/${name}/2026-13`), {}));
        await assertSucceeds(setDoc(doc(db, `users/a/${name}/2026-09`), { _schemaVersion: 1 }));
    }
});

it('permits public catalog reads but denies client writes', async () => {
    for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext('a').firestore()]) {
        const ref = doc(db, 'global_catalog/manifest');
        await assertSucceeds(getDoc(ref));
        await assertFails(setDoc(ref, { version: 'tampered' }));
    }
});

it('rejects untyped root fields', async () => {
    const db = env.authenticatedContext('a').firestore();
    await assertFails(setDoc(doc(db, 'users/a'), { profile: 'invalid-profile', _schemaVersion: 1 }));
});
