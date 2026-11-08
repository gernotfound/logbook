import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
vi.mock('../../src/lib/healthConsent', async () => ({
    ...(await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent')),
    getVerifiedHealthConsentRevision: () => 1,
}));
import { claimReplicaCheckpoint, retireExpiredReplicas } from '../../src/lib/sync/replicaProtocol';
import { sealCloudDocument, openCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import { seedTrustedConsent, asModularFirestore } from './replicaHarness';

let env: RulesTestEnvironment;

beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
        throw new Error('Only the isolated local emulator is allowed');
    }
    env = await initializeTestEnvironment({
        projectId: 'demo-logbook-audit',
        firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    });
});

beforeEach(async () => { await env.clearFirestore(); await seedTrustedConsent(env); });
afterAll(async () => { await env?.cleanup(); });


it('rejects a checkpoint if the requesting session is stale after the control read', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    const controlRef = doc(db, 'users/' + uid + '/sync_control/state');
    let guards = 0;
    const guard = () => {
        guards += 1;
        // Simulate a session invalidation while the Firestore transaction read is in flight.
        return guards < 3;
    };

    await expect(claimReplicaCheckpoint(db, uid, null, {}, 0, 'stale-first-claim', guard))
        .rejects.toThrow('Sessione cambiata');
    expect(guards).toBeGreaterThanOrEqual(3);
    expect((await getDoc(controlRef)).exists()).toBe(false);
});

it('rejects a stale existing-replica checkpoint without changing its remote clock', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    const first = await claimReplicaCheckpoint(db, uid, null, { s00: 1 }, 0, 'current-device');
    const controlRef = doc(db, 'users/' + uid + '/sync_control/state');
    const before = (await getDoc(controlRef)).data()!;
    let guards = 0;

    await expect(claimReplicaCheckpoint(db, uid, first.identity, { s00: 100 }, 0, undefined,
        () => ++guards < 3)).rejects.toThrow('Sessione cambiata');
    expect(guards).toBeGreaterThanOrEqual(3);
    expect((await getDoc(controlRef)).data()).toEqual(before);
});

it('rejects stale session during replica retirement without modifying the remote registry', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    const controlRef = doc(db, 'users/' + uid + '/sync_control/state');
    const now = Date.now();
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), 'users/' + uid + '/sync_control/state'), {
            protocolVersion: 3, consentRevision: 1,
            replicas: {
                s00: {
                    replicaId: 'retirement-candidate', generation: 1, status: 'active', lastSeq: 3,
                    checkpointAtMs: now - 370 * 24 * 60 * 60 * 1000,
                    leaseUntilMs: now - 2 * 24 * 60 * 60 * 1000, checkpointClock: { s00: 3 },
                },
            },
            mutation: { slot: 's00', action: 'checkpoint' },
        });
    });
    const before = (await getDoc(controlRef)).data()!;
    let guards = 0;
    await expect(retireExpiredReplicas(db, uid, now, () => ++guards < 4))
        .rejects.toThrow('Sessione cambiata');
    expect(guards).toBeGreaterThanOrEqual(4);
    expect((await getDoc(controlRef)).data()).toEqual(before);
});

it('refuses stale session before starting either replica maintenance operation', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    await expect(claimReplicaCheckpoint(db, uid, null, {}, 0, 'blocked', () => false))
        .rejects.toThrow('Sessione cambiata');
    await expect(retireExpiredReplicas(db, uid, Date.now(), () => false))
        .rejects.toThrow('Sessione cambiata');
    expect((await getDoc(doc(db, 'users/' + uid + '/sync_control/state'))).exists()).toBe(false);
});

it('deduplicates concurrent first claims from tabs sharing one local actor identity', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    const candidate = 'shared-local-actor';
    const [left, right] = await Promise.all([
        claimReplicaCheckpoint(db, uid, null, {}, 0, candidate),
        claimReplicaCheckpoint(db, uid, null, {}, 0, candidate),
    ]);
    expect(left.identity.slot).toBe(right.identity.slot);
    expect(left.identity.replicaId).toBe(candidate);
    expect(right.identity.replicaId).toBe(candidate);
    expect(left.identity.generation).toBe(1);
    expect(right.identity.generation).toBe(1);
    const control = (await getDoc(doc(db, 'users/' + uid + '/sync_control/state'))).data()!;
    expect(Object.keys(control.replicas)).toEqual(['s00']);
});

it('fences an old replica generation after an expired slot is reused', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    const controlRef = doc(db, 'users/' + uid + '/sync_control/state');
    const rootRef = doc(db, 'users/' + uid);
    const now = Date.now();

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), 'users/' + uid + '/sync_control/state'), {
            protocolVersion: 3,
            consentRevision: 1,
            replicas: {
                s00: {
                    replicaId: 'old-replica',
                    generation: 1,
                    status: 'active',
                    lastSeq: 0,
                    checkpointAtMs: now - 400 * 24 * 60 * 60 * 1000,
                    leaseUntilMs: now - 24 * 60 * 60 * 1000,
                    checkpointClock: {},
                },
            },
            mutation: { slot: 's00', action: 'checkpoint' },
        });
    });

    const newReplica = {
        replicaId: 'new-replica',
        generation: 2,
        status: 'active',
        lastSeq: 0,
        checkpointAtMs: Date.now(),
        leaseUntilMs: Date.now() + 360 * 24 * 60 * 60 * 1000,
        checkpointClock: {},
    };

    await assertSucceeds(setDoc(controlRef, {
        protocolVersion: 3,
        consentRevision: 1,
        replicas: { s00: newReplica },
        mutation: { slot: 's00', action: 'reuse-expired' },
    }));

    const currentControl = (await getDoc(controlRef)).data()!;
    const writeWithGeneration = (generation: number, replicaId: string, seq: number) => {
        const batch = writeBatch(db);
        batch.set(controlRef, {
            ...currentControl,
            replicas: {
                ...currentControl.replicas,
                s00: { ...currentControl.replicas.s00, lastSeq: seq },
            },
            mutation: { slot: 's00', action: 'advance', batchId: `test-${crypto.randomUUID()}` },
        });
        batch.set(rootRef, sealCloudDocument(new Uint8Array(32).fill(18), uid, '',
            { profile: { height: '180' } }, {
                protocolVersion: 3, clock: { s00: seq }, fields: {},
                writer: { slot: 's00', replicaId, generation, seq, consentRevision: 1 },
            }));
        return batch.commit();
    };

    await assertFails(writeWithGeneration(1, 'old-replica', 1));
    expect((await getDoc(rootRef)).exists()).toBe(false);

    await assertSucceeds(writeWithGeneration(2, 'new-replica', 1));
    expect((await getDoc(rootRef)).data()?._sync.writer).toMatchObject({
        slot: 's00',
        replicaId: 'new-replica',
        generation: 2,
        seq: 1,
    });
});

it('rejects Protocol 1/2 writers both before and after the account creates its replica-control barrier', async () => {
    const uid = 'a';
    const db = asModularFirestore(env.authenticatedContext(uid, { email_verified: true }).firestore());
    const rootRef = doc(db, 'users/' + uid);

    for (const protocolVersion of [1, 2]) {
        await assertFails(setDoc(rootRef, {
            profile: { height: 'legacy' },
            _schemaVersion: 1,
            _sync: { protocolVersion, clock: {}, fields: {} },
        }));
    }

    const now = Date.now();
    const controlRef = doc(db, 'users/' + uid + '/sync_control/state');
    await assertSucceeds(setDoc(controlRef, {
        protocolVersion: 3,
        consentRevision: 1,
        replicas: {
            s00: {
                replicaId: 'current-replica',
                generation: 1,
                status: 'active',
                lastSeq: 0,
                checkpointAtMs: now,
                leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
                checkpointClock: {},
            },
        },
        mutation: { slot: 's00', action: 'register' },
    }));

    const control = (await getDoc(controlRef)).data()!;
    const baselineBatch = writeBatch(db);
    baselineBatch.set(controlRef, {
        ...control,
        replicas: {
            ...control.replicas,
            s00: { ...control.replicas.s00, lastSeq: 1 },
        },
        mutation: { slot: 's00', action: 'advance', batchId: `test-${crypto.randomUUID()}` },
    });
    baselineBatch.set(rootRef, sealCloudDocument(new Uint8Array(32).fill(18), uid, '',
        { profile: { height: '170' } }, {
            protocolVersion: 3, clock: { s00: 1 }, fields: {},
            writer: { slot: 's00', replicaId: 'current-replica', generation: 1, consentRevision: 1, seq: 1 },
        }));
    await assertSucceeds(baselineBatch.commit());

    for (const protocolVersion of [1, 2]) {
        const current = (await getDoc(controlRef)).data()!;
        const legacyBatch = writeBatch(db);
        legacyBatch.set(controlRef, {
            ...current,
            replicas: {
                ...current.replicas,
                s00: { ...current.replicas.s00, lastSeq: 2 },
            },
            mutation: { slot: 's00', action: 'advance', batchId: `test-${crypto.randomUUID()}` },
        });
        legacyBatch.set(rootRef, {
            profile: { height: '171' },
            _schemaVersion: 1,
            _sync: {
                protocolVersion,
                clock: { s00: 2 },
                fields: {},
                writer: { slot: 's00', replicaId: 'current-replica', generation: 1, consentRevision: 1, seq: 2 },
            },
        });
        await assertFails(legacyBatch.commit());
    }

    expect(openCloudDocument(new Uint8Array(32).fill(18), uid, '', (await getDoc(rootRef)).data()).business.profile)
        .toMatchObject({ height: '170' });
});


it('rejects malformed checkpoint coordinates before they can influence causal GC', async () => {
    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const controlRef = doc(db, 'users/a/sync_control/state');
    const now = Date.now();
    const entry = {
        replicaId: 'checkpoint-replica', generation: 1, status: 'active',
        lastSeq: 0, checkpointAtMs: now,
        leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        checkpointClock: {},
    };
    const registration = (checkpointClock: Record<string, unknown>) => ({
        protocolVersion: 3,
        consentRevision: 1,
        replicas: { s00: { ...entry, checkpointClock } },
        mutation: { slot: 's00', action: 'register' },
    });

    for (const clock of [
        { injectedActor: 1 },
        { s00: -1 },
        { s00: '1' },
        { s00: 1.5 },
        { s00: 9007199254740992 },
    ]) {
        await assertFails(setDoc(controlRef, registration(clock)));
    }
    expect((await getDoc(controlRef)).exists()).toBe(false);
    await assertSucceeds(setDoc(controlRef, registration({ s00: 0, s15: 3 })));
    const current = (await getDoc(controlRef)).data()!;
    for (const clock of [{ injectedActor: 1 }, { s01: -1 }, { s01: '4' }]) {
        await assertFails(setDoc(controlRef, {
            ...current,
            replicas: { s00: { ...current.replicas.s00, checkpointClock: clock } },
            mutation: { slot: 's00', action: 'checkpoint' },
        }));
    }
    expect((await getDoc(controlRef)).data()?.replicas.s00.checkpointClock).toEqual({ s00: 0, s15: 3 });
});

it('rejects replica generation and sequence counters outside the safe-integer range', async () => {
    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const controlRef = doc(db, 'users/a/sync_control/state');
    const now = Date.now();
    const entry = {
        replicaId: 'bounded-replica', generation: 1, status: 'active',
        lastSeq: 0, checkpointAtMs: now,
        leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        checkpointClock: {},
    };
    const registration = (candidate: typeof entry) => ({
        protocolVersion: 3, consentRevision: 1,
        replicas: { s00: candidate },
        mutation: { slot: 's00', action: 'register' },
    });

    for (const invalid of [
        { ...entry, generation: Number.MAX_SAFE_INTEGER + 1 },
        { ...entry, lastSeq: Number.MAX_SAFE_INTEGER + 1 },
    ]) await assertFails(setDoc(controlRef, registration(invalid)));
    expect((await getDoc(controlRef)).exists()).toBe(false);
    await assertSucceeds(setDoc(controlRef, registration({
        ...entry, lastSeq: Number.MAX_SAFE_INTEGER,
    })));
    expect((await getDoc(controlRef)).data()?.replicas.s00.lastSeq).toBe(Number.MAX_SAFE_INTEGER);
});

it('retires an expired replica without dropping the verified consent generation', async () => {
    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const controlRef = doc(db, 'users/a/sync_control/state');
    const now = Date.now();
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), 'users/a/sync_control/state'), {
            protocolVersion: 3, consentRevision: 1,
            replicas: {
                s00: {
                    replicaId: 'expired', generation: 1, status: 'active', lastSeq: 7,
                    checkpointAtMs: now - 370 * 24 * 60 * 60 * 1000,
                    leaseUntilMs: now - 2 * 24 * 60 * 60 * 1000,
                    checkpointClock: { s00: 7 },
                },
            },
            mutation: { slot: 's00', action: 'checkpoint' },
        });
    });
    await retireExpiredReplicas(db, 'a');
    const retired = (await getDoc(controlRef)).data()!;
    expect(retired.consentRevision).toBe(1);
    expect(retired.replicas.s00).toMatchObject({ status: 'retired', lastSeq: 7, checkpointClock: { s00: 7 } });
    await retireExpiredReplicas(db, 'a');
    expect((await getDoc(controlRef)).data()).toEqual(retired);
});
