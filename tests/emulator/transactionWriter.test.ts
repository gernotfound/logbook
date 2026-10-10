import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));

import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';
import { type SemanticOperation } from '../../src/lib/sync/semanticProjection';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL, FutureVersionError, LegacyVersionError } from '../../src/lib/schemaEvolution';
import { registerReplica } from './replicaHarness';

let env: RulesTestEnvironment;

beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed');
    env = await initializeTestEnvironment({ projectId: 'demo-logbook-audit', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});

beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

it('1. V3 API: writes business data, FieldStamp metadata and the current data schema marker', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');
    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'height'], value: '185', isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ];

    await applyDocumentChanges(db, 'a', ops, () => true, replica);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.height).toBe('185');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.fields['profile/height']).toMatchObject({ actorId: 's00', seq: 1, clock: { s00: 1 } });
});

it('1b. distinguishes an absent first-account document from a persisted markerless document', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');

    await applyDocumentChanges(db, 'a', [
        { docPath: '', path: ['profile', 'height'], value: '180', isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ], () => true, replica);
    expect((await getDoc(doc(db, 'users/a'))).data()?._schemaVersion).toBe(CURRENT_DATA_SCHEMA);

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), { profile: { name: 'Unsupported' } });
    });

    await expect(applyDocumentChanges(db, 'a', [
        { docPath: '', path: ['profile', 'height'], value: '181', isDelete: false, actorId: 's00', seq: 2, clock: { s00: 2 } }
    ], () => true, replica)).rejects.toThrow(LegacyVersionError);
});

it('1c. refuses a future remote schema before semantic merge or write', async () => {
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), { profile: { height: '999' }, _schemaVersion: CURRENT_DATA_SCHEMA + 1 });
    });
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');

    await expect(applyDocumentChanges(db, 'a', [
        { docPath: '', path: ['profile', 'height'], value: '180', isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ], () => true, replica)).rejects.toThrow(FutureVersionError);

    await env.withSecurityRulesDisabled(async context => {
        const saved = (await getDoc(doc(context.firestore(), 'users/a'))).data()!;
        expect(saved).toEqual({ profile: { height: '999' }, _schemaVersion: CURRENT_DATA_SCHEMA + 1 });
    });
});

it('2. V3 API: replay is idempotent', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');
    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'name'], value: 'Test', isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ];

    await applyDocumentChanges(db, 'a', ops, () => true, replica);
    await applyDocumentChanges(db, 'a', ops, () => true, replica);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.name).toBe('Test');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.fields['profile/name'].seq).toBe(1);
});

it('2b. V3 API: contention smoke test converges to the semantic operation', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');
    const writer0 = { slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation, seq: 0 };
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), {
            profile: { name: 'Initial' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: writer0 },
        });
    });

    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'name'], value: 'TestRetry', isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ];

    const promise = applyDocumentChanges(db, 'a', ops, () => true, replica);
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), {
            profile: { name: 'Interfering' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: writer0 },
        });
    });
    await promise;

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.name).toBe('TestRetry');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
});

it('3. V3 API: parent tombstone keeps an otherwise empty shard and permits causally later recreation', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');
    const createOps: SemanticOperation[] = [
        {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-13'],
            value: { date: '2026-09-13', weight: 80, meals: [] },
            isDelete: false,
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 }
        }
    ];
    await applyDocumentChanges(db, 'a', createOps, () => true, replica);

    const deleteOps: SemanticOperation[] = [
        {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-13'],
            isDelete: true,
            actorId: 's00',
            seq: 2,
            clock: { s00: 2 }
        }
    ];
    await applyDocumentChanges(db, 'a', deleteOps, () => true, replica);

    const ref = doc(db, 'users/a/nutrition_months/2026-09');
    const deleted = (await getDoc(ref)).data();
    expect(deleted).toBeDefined();
    expect(deleted!._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(deleted!['2026-09-13']).toBeUndefined();
    expect(deleted!._sync.fields['2026-09-13']).toMatchObject({ deleted: true, actorId: 's00', seq: 2 });

    const secondReplica = await registerReplica(db, 'a', 's01', 'replica-s01', { s00: 2 });
    const recreateOps: SemanticOperation[] = [
        {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-13'],
            value: { date: '2026-09-13', weight: 82, meals: [] },
            isDelete: false,
            actorId: 's01',
            seq: 1,
            clock: { s00: 2, s01: 1 }
        }
    ];
    await applyDocumentChanges(db, 'a', recreateOps, () => true, secondReplica);

    const recreated = (await getDoc(ref)).data()!;
    expect(recreated['2026-09-13'].weight).toBe(82);
    expect(recreated._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(recreated._sync.fields['2026-09-13'].deleted).toBeUndefined();
    expect(recreated._sync.fields['2026-09-13'].clock).toEqual({ s00: 2, s01: 1 });
});

it('4. V3 API: remote FieldStamp can defeat a concurrent local operation', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), {
            profile: { height: '190' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: {
                protocolVersion: CURRENT_SYNC_PROTOCOL,
                clock: { z: 1 },
                fields: {
                    'profile/height': { clock: { z: 1 }, actorId: 'z', seq: 1 }
                },
                writer: { slot: 's01', replicaId: 'remote-seed', generation: 1, seq: 1 },
            }
        });
    });

    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'height'], value: '180', isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ];

    await applyDocumentChanges(db, 'a', ops, () => true, replica);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.height).toBe('190');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.clock.s00).toBe(1);
    expect(saved._sync.protocolVersion).toBe(CURRENT_SYNC_PROTOCOL);
});

it('5. V3 API: checkDocSize receives a document that already contains schema and sync metadata', async () => {
    const db = env.authenticatedContext('a', { email_verified: true }).firestore();
    const replica = await registerReplica(db, 'a');
    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'name'], value: 'A'.repeat(500), isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 } }
    ];

    const result = await applyDocumentChanges(db, 'a', ops, () => true, replica);
    expect(result.syncMeta[''].fields['profile/name']).toBeDefined();

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.name).toHaveLength(500);
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.fields['profile/name']).toBeDefined();
});
