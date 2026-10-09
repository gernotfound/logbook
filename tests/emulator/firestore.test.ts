import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';
import { registerReplica } from './replicaHarness';

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

function protocol3Registration() {
    const now = Date.now();
    return {
        protocolVersion: CURRENT_SYNC_PROTOCOL,
        replicas: {
            s00: {
                replicaId: 'replica-s00',
                generation: 1,
                status: 'active',
                lastSeq: 0,
                checkpointAtMs: now,
                leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
                checkpointClock: {},
            },
        },
        mutation: { slot: 's00', action: 'register' },
    };
}

async function fencedWrite(db: any, path: string, business: Record<string, unknown>, replica?: any) {
    const activeReplica = replica ?? await registerReplica(db, 'a');
    const controlRef = doc(db, 'users/a/sync_control/state');
    const control = (await getDoc(controlRef)).data()!;
    const currentEntry = control.replicas[activeReplica.slot];
    const seq = currentEntry.lastSeq + 1;
    const writer = {
        slot: activeReplica.slot,
        replicaId: activeReplica.replicaId,
        generation: activeReplica.generation,
        seq,
    };
    const batch = writeBatch(db);
    batch.set(controlRef, {
        ...control,
        replicas: {
            ...control.replicas,
            [activeReplica.slot]: { ...currentEntry, lastSeq: seq },
        },
        mutation: { slot: activeReplica.slot, action: 'advance' },
    });
    batch.set(doc(db, path), {
        ...business,
        _schemaVersion: 1,
        _sync: {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: { [activeReplica.slot]: seq },
            fields: {},
            writer,
        },
    });
    await batch.commit();
    return activeReplica;
}

it('allows only Protocol 3 fenced owner writes and denies direct root deletion', async () => {
    const db = env.authenticatedContext('a').firestore();
    const ref = doc(db, 'users/a');
    const replica = await fencedWrite(db, 'users/a', { profile: { height: '175' }, nutritionPlanningOrigin: 'user-edited' });
    expect((await assertSucceeds(getDoc(ref))).data()?.profile.height).toBe('175');
    await fencedWrite(db, 'users/a', { profile: { height: '176' }, nutritionPlanningOrigin: 'user-edited' }, replica);
    expect((await assertSucceeds(getDoc(ref))).data()?.profile.height).toBe('176');
    await assertFails(deleteDoc(ref));
});

it('rejects markerless or unfenced business writes while allowing the current first-account baseline', async () => {
    const db = env.authenticatedContext('a').firestore();
    const root = doc(db, 'users/a');
    await assertFails(setDoc(root, { profile: { name: 'markerless' } }));
    await assertFails(setDoc(root, { profile: { name: 'schema-only' }, _schemaVersion: 1 }));

    const replica = await fencedWrite(db, 'users/a', { profile: { name: 'current' } });
    expect((await getDoc(root)).data()?.profile.name).toBe('current');

    for (const collection of ['history_months', 'nutrition_months']) {
        const ref = doc(db, `users/a/${collection}/2026-09`);
        await assertFails(setDoc(ref, {}));
        await assertFails(setDoc(ref, { _schemaVersion: 1 }));
        await fencedWrite(db, `users/a/${collection}/2026-09`, {}, replica);
        expect((await getDoc(ref)).data()?._schemaVersion).toBe(1);
    }
});

it('denies client-side monthly physical deletion before and after Protocol 3 registration', async () => {
    const db = env.authenticatedContext('a').firestore();
    const monthRef = doc(db, 'users/a/nutrition_months/2026-09');

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a/nutrition_months/2026-09'), {
            _schemaVersion: 1,
            _sync: { protocolVersion: 3, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'seed', generation: 1, seq: 0 } },
        });
    });
    await assertFails(deleteDoc(monthRef));

    await registerReplica(db, 'a');
    const controlRef = doc(db, 'users/a/sync_control/state');
    const control = (await getDoc(controlRef)).data()!;
    const forgedDeleteBatch = writeBatch(db);
    forgedDeleteBatch.set(controlRef, {
        ...control,
        replicas: {
            ...control.replicas,
            s00: { ...control.replicas.s00, lastSeq: control.replicas.s00.lastSeq + 1 },
        },
        mutation: { slot: 's00', action: 'advance' },
    });
    forgedDeleteBatch.delete(monthRef);

    await assertFails(forgedDeleteBatch.commit());
    expect((await getDoc(monthRef)).exists()).toBe(true);
});

it.each(['history_months', 'nutrition_months'])(
    'denies Protocol 3 registration combined with a legacy physical delete from %s in the same batch',
    async collectionName => {
        const db = env.authenticatedContext('a').firestore();
        const monthRef = doc(db, `users/a/${collectionName}/2026-09`);
        const controlRef = doc(db, 'users/a/sync_control/state');
        await env.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `users/a/${collectionName}/2026-09`), {
                _schemaVersion: 1,
                _sync: { protocolVersion: 3, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'seed', generation: 1, seq: 0 } },
            });
        });

        const batch = writeBatch(db);
        batch.set(controlRef, protocol3Registration());
        batch.delete(monthRef);

        await assertFails(batch.commit());
        expect((await getDoc(monthRef)).exists()).toBe(true);
        expect((await getDoc(controlRef)).exists()).toBe(false);
    },
);

it.each([
    ['root', 'users/a', { profile: { name: 'legacy' }, _schemaVersion: 1, _sync: { protocolVersion: 1, clock: {}, fields: {} } }],
    ['history month', 'users/a/history_months/2026-09', { _schemaVersion: 1, _sync: { protocolVersion: 1, clock: {}, fields: {} } }],
    ['nutrition month', 'users/a/nutrition_months/2026-09', { _schemaVersion: 1, _sync: { protocolVersion: 1, clock: {}, fields: {} } }],
])(
    'denies Protocol 3 registration combined with a legacy %s write in the same batch',
    async (_label, path, legacyDocument) => {
        const db = env.authenticatedContext('a').firestore();
        const controlRef = doc(db, 'users/a/sync_control/state');
        const targetRef = doc(db, path);

        const batch = writeBatch(db);
        batch.set(controlRef, protocol3Registration());
        batch.set(targetRef, legacyDocument);

        await assertFails(batch.commit());
        expect((await getDoc(controlRef)).exists()).toBe(false);
        expect((await getDoc(targetRef)).exists()).toBe(false);
    },
);

it('rejects Protocol 1/2 writes even before the account creates its Protocol 3 control', async () => {
    const db = env.authenticatedContext('a').firestore();
    for (const protocolVersion of [1, 2]) {
        const legacySync = { protocolVersion, clock: {}, fields: {} };
        await assertFails(setDoc(doc(db, 'users/a'), { profile: { name: 'legacy' }, _schemaVersion: 1, _sync: legacySync }));
        await assertFails(setDoc(doc(db, 'users/a/history_months/2026-09'), { _schemaVersion: 1, _sync: legacySync }));
        await assertFails(setDoc(doc(db, 'users/a/nutrition_months/2026-09'), { _schemaVersion: 1, _sync: legacySync }));
    }
    expect((await getDoc(doc(db, 'users/a/sync_control/state'))).exists()).toBe(false);
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

it('keeps health consent revocation server-only and fences stale-client writes without blocking export reads', async () => {
    const db = env.authenticatedContext('a').firestore();
    const anotherDb = env.authenticatedContext('b').firestore();
    const guestDb = env.unauthenticatedContext().firestore();
    const revocationRef = doc(db, 'health_consent_revocations/a');
    const replica = await fencedWrite(db, 'users/a', { profile: { height: '175' } });
    await fencedWrite(db, 'users/a/history_months/2026-09', { workout: {} }, replica);
    await fencedWrite(db, 'users/a/nutrition_months/2026-09', { day: {} }, replica);

    // Users cannot forge or reverse an authoritative revocation.
    await assertFails(setDoc(revocationRef, { revokedAt: new Date() }));
    await assertFails(getDoc(doc(anotherDb, 'health_consent_revocations/a')));
    await assertFails(getDoc(doc(guestDb, 'health_consent_revocations/a')));

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'health_consent_revocations/a'), {
            revokedAt: new Date('2026-10-09T12:00:00Z'),
            source: 'trusted-server',
        });
    });

    expect((await assertSucceeds(getDoc(revocationRef))).exists()).toBe(true);
    await assertFails(updateDoc(revocationRef, { source: 'client-forgery' }));
    await assertFails(deleteDoc(revocationRef));

    // Data previously stored remains readable solely for rights/export workflows.
    for (const path of ['users/a', 'users/a/history_months/2026-09', 'users/a/nutrition_months/2026-09']) {
        expect((await assertSucceeds(getDoc(doc(db, path)))).exists()).toBe(true);
    }
    await assertFails(fencedWrite(db, 'users/a', { profile: { height: '176' } }, replica));
    await assertFails(fencedWrite(db, 'users/a/history_months/2026-09', { workout: { latest: true } }, replica));
    await assertFails(fencedWrite(db, 'users/a/nutrition_months/2026-09', { day: { latest: true } }, replica));

    // The suspension of A must not lock down unrelated accounts.
    await fencedWrite(anotherDb, 'users/b', { profile: { height: '180' } });

    // The account-deletion barrier remains stronger than the export-read exception.
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'account_deletions/a'), { uid: 'a', status: 'requested' });
    });
    await assertFails(getDoc(revocationRef));
    await assertFails(getDoc(doc(db, 'users/a')));
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

it.each([
    ['anonymous', null],
    ['owner', 'a'],
    ['other user', 'b'],
])('keeps account_deletion_devices server-only for %s clients', async (_label, uid) => {
    const db = uid === null ? env.unauthenticatedContext().firestore() : env.authenticatedContext(uid).firestore();
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'account_deletion_devices/a'), {
            uid: 'a',
            tokenHashes: ['0'.repeat(64)],
            registeredAt: new Date(),
            updatedAt: new Date(),
        });
    });

    const existingRef = doc(db, 'account_deletion_devices/a');
    const createRef = doc(db, 'account_deletion_devices/new-device');
    await assertFails(getDoc(existingRef));
    await assertFails(setDoc(createRef, { uid: 'new-device', tokenHashes: [] }));
    await assertFails(updateDoc(existingRef, { updatedAt: new Date() }));
    await assertFails(deleteDoc(existingRef));
});

it('rejects unknown root fields, invalid origin and malformed month paths inside fenced writes', async () => {
    const db = env.authenticatedContext('a').firestore();
    const replica = await registerReplica(db, 'a');
    await assertFails(fencedWrite(db, 'users/a', { unknown: true }, replica));
    await assertFails(fencedWrite(db, 'users/a', { nutritionPlanningOrigin: 'injected' }, replica));
    for (const name of ['history_months', 'nutrition_months']) {
        await assertFails(fencedWrite(db, `users/a/${name}/2026-13`, {}, replica));
        await fencedWrite(db, `users/a/${name}/2026-09`, {}, replica);
    }
});

it('rejects malformed sync envelopes while allowing the current structural contract', async () => {
    const db = env.authenticatedContext('a').firestore();
    const root = doc(db, 'users/a');
    const legacySync = { protocolVersion: 1, clock: {}, fields: {} };

    await assertFails(setDoc(root, { profile: { name: 'legacy' }, _schemaVersion: 1, _sync: legacySync }));

    const replica = await registerReplica(db, 'a');
    const controlRef = doc(db, 'users/a/sync_control/state');
    const writer = { slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation, seq: 1 };
    const validSync = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 1 }, fields: {}, writer };
    const authorizedWrite = async (sync: any, name: string, seq = 1) => {
        const control = (await getDoc(controlRef)).data()!;
        const batch = writeBatch(db);
        batch.set(controlRef, {
            ...control,
            replicas: {
                ...control.replicas,
                s00: { ...control.replicas.s00, lastSeq: seq },
            },
            mutation: { slot: 's00', action: 'advance' },
        });
        batch.set(root, { profile: { name }, _schemaVersion: 1, _sync: sync });
        await batch.commit();
    };

    await assertSucceeds(authorizedWrite(validSync, 'valid'));
    await assertFails(setDoc(root, { profile: { name: 'downgrade' }, _schemaVersion: 1, _sync: legacySync }));

    const nextWriter = { ...writer, seq: 2 };
    await assertFails(authorizedWrite({ ...validSync, protocolVersion: CURRENT_SYNC_PROTOCOL + 1, writer: nextWriter }, 'wrong protocol', 2));
    await assertFails(authorizedWrite({ protocolVersion: CURRENT_SYNC_PROTOCOL, fields: {}, writer: nextWriter }, 'missing clock', 2));
    await assertFails(authorizedWrite({ protocolVersion: CURRENT_SYNC_PROTOCOL, clock: [], fields: {}, writer: nextWriter }, 'bad clock', 2));
    await assertFails(authorizedWrite({ protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 2 }, fields: [], writer: nextWriter }, 'bad fields', 2));
    await assertFails(authorizedWrite({ ...validSync, clock: { s00: 2 }, writer: nextWriter, unexpected: true }, 'extra sync key', 2));
});

it('permits public catalog reads but denies client writes', async () => {
    for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext('a').firestore()]) {
        const ref = doc(db, 'global_catalog/manifest');
        await assertSucceeds(getDoc(ref));
        await assertFails(setDoc(ref, { version: 'tampered' }));
    }
});

it('rejects untyped root fields inside a valid fenced write', async () => {
    const db = env.authenticatedContext('a').firestore();
    const replica = await registerReplica(db, 'a');
    await assertFails(fencedWrite(db, 'users/a', { profile: 'invalid-profile' }, replica));
});

it('accepts bounded owner telemetry and rejects malformed payloads', async () => {
    const db = env.authenticatedContext('a').firestore();
    const expireAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
    const eventRef = doc(db, 'users/a/telemetry_events/e1');
    const errorRef = doc(db, 'users/a/telemetry_errors/err1');
    const anomalyRef = doc(db, 'users/a/telemetry_anomalies/a1');

    const event = {
        timestamp: 1000,
        type: 'workout_started',
        context: telemetryContext,
        userId: 'a',
        sessionId: 'session-a',
        details: { offline: false, routineId: 'routine-1' },
        expireAt,
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
        expireAt,
    };
    const anomaly = {
        type: 'storage_recovery_anomaly',
        reason: 'indexeddb_cache_missing_with_valid_marker',
        timestamp: 1000,
        elapsedMs: 50,
        platform: 'other',
        standalone: false,
        persisted: null,
        expireAt,
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

it('allows bounded telemetry expiry, supports legacy expiry upgrade, and prevents expiry removal', async () => {
    const db = env.authenticatedContext('a').firestore();
    const validExpireAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
    const tooFarExpireAt = new Date(Date.now() + (32 * 24 * 60 * 60 * 1000));

    const event = {
        timestamp: 1000,
        type: 'schema_fallback',
        context: telemetryContext,
        userId: 'a',
        sessionId: 'session-a',
    };
    const eventRef = doc(db, 'users/a/telemetry_events/ttl-event');
    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/missing-expiry'), event));
    await assertSucceeds(setDoc(eventRef, { ...event, expireAt: validExpireAt }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/bad-expiry-type'), { ...event, expireAt: '2099-01-01' }));
    await assertFails(setDoc(doc(db, 'users/a/telemetry_events/bad-expiry-window'), { ...event, expireAt: tooFarExpireAt }));

    const legacyEventRef = doc(db, 'users/a/telemetry_events/legacy-event');
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a/telemetry_events/legacy-event'), event);
    });
    await assertSucceeds(setDoc(legacyEventRef, { ...event, expireAt: validExpireAt }));
    await assertFails(setDoc(legacyEventRef, { ...event, type: 'tampered', expireAt: validExpireAt }));

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
        expireAt: validExpireAt,
    };
    const errorRef = doc(db, 'users/a/telemetry_errors/ttl-error');
    await assertSucceeds(setDoc(errorRef, error));
    await assertSucceeds(setDoc(errorRef, { count: 2, lastSeen: 1100 }, { merge: true }));
    await assertFails(setDoc(errorRef, { ...error, count: 2, lastSeen: 1100, expireAt: tooFarExpireAt }));
    const { expireAt: _removedExpiry, ...withoutExpiry } = error;
    await assertFails(setDoc(errorRef, { ...withoutExpiry, count: 2, lastSeen: 1100 }));
});

it('makes telemetry events/anomalies immutable and error aggregation monotonic', async () => {
    const db = env.authenticatedContext('a').firestore();
    const expireAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
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
        expireAt,
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
        expireAt,
    };
    const anomaly = {
        type: 'storage_recovery_anomaly',
        reason: 'indexeddb_cache_missing_with_valid_marker',
        timestamp: 1000,
        elapsedMs: 50,
        platform: 'other',
        standalone: false,
        persisted: false,
        expireAt,
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