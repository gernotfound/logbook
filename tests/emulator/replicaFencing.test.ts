import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { claimReplicaCheckpoint } from '../../src/lib/sync/replicaProtocol';

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

beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

it('deduplicates concurrent first claims from tabs sharing one local actor identity', async () => {
    const uid = 'a';
    const db = env.authenticatedContext(uid).firestore();
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
    const db = env.authenticatedContext(uid).firestore();
    const controlRef = doc(db, 'users/' + uid + '/sync_control/state');
    const rootRef = doc(db, 'users/' + uid);
    const now = Date.now();

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/' + uid + '/sync_control/state'), {
            protocolVersion: 3,
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
            mutation: { slot: 's00', action: 'advance' },
        });
        batch.set(rootRef, {
            profile: { height: '180' },
            _schemaVersion: 1,
            _sync: {
                protocolVersion: 3,
                clock: { s00: seq },
                fields: {},
                writer: { slot: 's00', replicaId, generation, seq },
            },
        });
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
    const db = env.authenticatedContext(uid).firestore();
    const rootRef = doc(db, 'users/' + uid);

    for (const protocolVersion of [1, 2]) {
        await assertFails(setDoc(rootRef, {
            profile: { height: 'legacy' },
            _schemaVersion: 1,
            _sync: { protocolVersion, clock: {}, fields: {} },
        }));
    }

    await assertSucceeds(setDoc(rootRef, {
        profile: { height: '170' },
        _schemaVersion: 1,
    }));

    const now = Date.now();
    await assertSucceeds(setDoc(doc(db, 'users/' + uid + '/sync_control/state'), {
        protocolVersion: 3,
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

    for (const protocolVersion of [1, 2]) {
        await assertFails(setDoc(rootRef, {
            profile: { height: '171' },
            _schemaVersion: 1,
            _sync: { protocolVersion, clock: { legacy: 1 }, fields: {} },
        }));
    }

    expect((await getDoc(rootRef)).data()?.profile.height).toBe('170');
});
