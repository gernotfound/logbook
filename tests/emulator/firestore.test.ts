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

const telemetryContext = {
    appVersion: '1.0.0',
    platform: 'other',
    displayMode: 'browser',
    online: true,
};

it('allows the owner to create, read and update their profile but denies direct root deletion', async () => {
    const ref = doc(env.authenticatedContext('a').firestore(), 'users/a');
    await assertSucceeds(setDoc(ref, { profile: { height: '175' }, nutritionPlanningOrigin: 'user-edited', _schemaVersion: 1 }));
    expect((await assertSucceeds(getDoc(ref))).data()?.profile.height).toBe('175');
    await assertSucceeds(setDoc(ref, { profile: { height: '176' }, nutritionPlanningOrigin: 'user-edited', _schemaVersion: 1 }));
    expect((await assertSucceeds(getDoc(ref))).data()?.profile.height).toBe('176');
    await assertFails(deleteDoc(ref));
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

it('rejects malformed sync envelopes while allowing the current structural contract', async () => {
    const db = env.authenticatedContext('a').firestore();
    const root = doc(db, 'users/a');
    const validSync = { protocolVersion: 1, clock: {}, fields: {} };

    await assertSucceeds(setDoc(root, { profile: { name: 'valid' }, _schemaVersion: 1, _sync: validSync }));
    await assertFails(setDoc(root, { profile: { name: 'wrong protocol' }, _schemaVersion: 1, _sync: { ...validSync, protocolVersion: 2 } }));
    await assertFails(setDoc(root, { profile: { name: 'missing clock' }, _schemaVersion: 1, _sync: { protocolVersion: 1, fields: {} } }));
    await assertFails(setDoc(root, { profile: { name: 'bad clock' }, _schemaVersion: 1, _sync: { protocolVersion: 1, clock: [], fields: {} } }));
    await assertFails(setDoc(root, { profile: { name: 'bad fields' }, _schemaVersion: 1, _sync: { protocolVersion: 1, clock: {}, fields: [] } }));
    await assertFails(setDoc(root, { profile: { name: 'extra sync key' }, _schemaVersion: 1, _sync: { ...validSync, unexpected: true } }));
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

it('accepts bounded owner telemetry and rejects malformed payloads', async () => {
    const db = env.authenticatedContext('a').firestore();
    const eventRef = doc(db, 'users/a/telemetry_events/e1');
    const errorRef = doc(db, 'users/a/telemetry_errors/err1');
    const anomalyRef = doc(db, 'users/a/telemetry_anomalies/a1');

    const event = {
        timestamp: 1000,
        type: 'workout_started',
        context: telemetryContext,
        userId: 'a',
        sessionId: 'session-a',
        details: { offline: false, routineId: 'routine-1', routineName: 'Upper A' },
    };
    const error = {
        timestamp: 1000,
        type: 'TypeError',
        message: 'safe message',
        source: 'window_error',
        context: telemetryContext,
        userId: 'a',
        sessionId: 'session-a',
        count: 1,
        firstSeen: 1000,
        lastSeen: 1000,
    };
    const anomaly = {
        type: 'storage_recovery_anomaly',
        reason: 'indexeddb_cache_missing_with_valid_marker',
        timestamp: 1000,
        elapsedMs: 50,
        platform: 'other',
        standalone: false,
        persisted: null,
    };

    await assertSucceeds(setDoc(eventRef, event));
    await assertSucceeds(setDoc(errorRef, error));
    await assertSucceeds(setDoc(anomalyRef, anomaly));

    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/bad-user'), { ...event, userId: 'b' }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/bad-context'), { ...event, context: { ...telemetryContext, platform: 'android' } }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/bad-details'), { ...event, details: { secret: 'not-allowed' } }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/bad-type'), { ...event, type: 42 }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_errors/bad-count'), { ...error, count: 0 }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_errors/bad-stack'), { ...error, stack: 'x'.repeat(1001) }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_anomalies/bad-anomaly'), { ...anomaly, platform: 'android' }));
});

it('makes telemetry events/anomalies immutable and error aggregation monotonic', async () => {
    const db = env.authenticatedContext('a').firestore();
    const eventRef = doc(db, 'users/a/telemetry_events/e1');
    const errorRef = doc(db, 'users/a/telemetry_errors/err1');
    const anomalyRef = doc(db, 'users/a/telemetry_anomalies/a1');

    const event = {
        timestamp: 1000,
        type: 'pwa_install_click',
        context: telemetryContext,
        userId: 'a',
        sessionId: 'session-a',
        details: { source: 'settings' },
    };
    const error = {
        timestamp: 1000,
        type: 'TypeError',
        message: 'safe message',
        source: 'window_error',
        context: telemetryContext,
        userId: 'a',
        sessionId: 'session-a',
        count: 1,
        firstSeen: 1000,
        lastSeen: 1000,
    };
    const anomaly = {
        type: 'storage_recovery_anomaly',
        reason: 'indexeddb_cache_missing_with_valid_marker',
        timestamp: 1000,
        elapsedMs: 50,
        platform: 'other',
        standalone: false,
        persisted: false,
    };

    await assertSucceeds(setDoc(eventRef, event));
    await assertSucceeds(setDoc(eventRef, event));
    await assertFails(setDoc(eventRef, { ...event, type: 'pwa_appinstalled' }));

    await assertSucceeds(setDoc(anomalyRef, anomaly));
    await assertSucceeds(setDoc(anomalyRef, anomaly));
    await assertFails(setDoc(anomalyRef, { ...anomaly, reason: 'tampered' }));

    await assertSucceeds(setDoc(errorRef, error));
    await assertSucceeds(setDoc(errorRef, { ...error, count: 2, lastSeen: 1100 }));
    await assertFails(setDoc(errorRef, { ...error, count: 1, lastSeen: 900 }));
    await assertFails(setDoc(errorRef, { ...error, count: 3, lastSeen: 1200, message: 'tampered' }));
});
