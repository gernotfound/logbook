import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));

import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';
import { type SemanticOperation } from '../../src/lib/sync/semanticProjection';
import { CURRENT_DATA_SCHEMA, FutureVersionError } from '../../src/lib/schemaEvolution';

let env: RulesTestEnvironment;

beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed');
    env = await initializeTestEnvironment({ projectId: 'demo-logbook-audit', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});

beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

it('1. V3 API: writes business data, FieldStamp metadata and the current data schema marker', async () => {
    const db = env.authenticatedContext('a').firestore();
    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'height'], value: '185', isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ];

    await applyDocumentChanges(db, 'a', ops, () => true);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.height).toBe('185');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.fields['profile/height']).toMatchObject({ actorId: 'A', seq: 1, clock: { A: 1 } });
});

it('1b. accepts an unversioned schema-1 document and lazily marks it on the next legitimate write', async () => {
    const db = env.authenticatedContext('a').firestore();
    await setDoc(doc(db, 'users/a'), { profile: { name: 'Baseline' } });

    await applyDocumentChanges(db, 'a', [
        { docPath: '', path: ['profile', 'height'], value: '180', isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ], () => true);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile).toMatchObject({ name: 'Baseline', height: '180' });
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
});

it('1c. refuses a future remote schema before semantic merge or write', async () => {
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), { profile: { height: '999' }, _schemaVersion: CURRENT_DATA_SCHEMA + 1 });
    });
    const db = env.authenticatedContext('a').firestore();

    await expect(applyDocumentChanges(db, 'a', [
        { docPath: '', path: ['profile', 'height'], value: '180', isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ], () => true)).rejects.toThrow(FutureVersionError);

    await env.withSecurityRulesDisabled(async context => {
        const saved = (await getDoc(doc(context.firestore(), 'users/a'))).data()!;
        expect(saved).toEqual({ profile: { height: '999' }, _schemaVersion: CURRENT_DATA_SCHEMA + 1 });
    });
});

it('2. V3 API: replay is idempotent', async () => {
    const db = env.authenticatedContext('a').firestore();
    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'name'], value: 'Test', isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ];

    await applyDocumentChanges(db, 'a', ops, () => true);
    await applyDocumentChanges(db, 'a', ops, () => true);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.name).toBe('Test');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.fields['profile/name'].seq).toBe(1);
});

it('2b. V3 API: contention smoke test converges to the semantic operation', async () => {
    const db = env.authenticatedContext('a').firestore();
    await setDoc(doc(db, 'users/a'), { profile: { name: 'Initial' } });

    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'name'], value: 'TestRetry', isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ];

    const promise = applyDocumentChanges(db, 'a', ops, () => true);
    await setDoc(doc(db, 'users/a'), { profile: { name: 'Interfering' } });
    await promise;

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.name).toBe('TestRetry');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
});

it('3. V3 API: parent tombstone keeps an otherwise empty shard and permits causally later recreation', async () => {
    const db = env.authenticatedContext('a').firestore();
    const createOps: SemanticOperation[] = [
        {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-13'],
            value: { date: '2026-09-13', weight: 80, meals: [] },
            isDelete: false,
            actorId: 'A',
            seq: 1,
            clock: { A: 1 }
        }
    ];
    await applyDocumentChanges(db, 'a', createOps, () => true);

    const deleteOps: SemanticOperation[] = [
        {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-13'],
            isDelete: true,
            actorId: 'A',
            seq: 2,
            clock: { A: 2 }
        }
    ];
    await applyDocumentChanges(db, 'a', deleteOps, () => true);

    const ref = doc(db, 'users/a/nutrition_months/2026-09');
    const deleted = (await getDoc(ref)).data();
    expect(deleted).toBeDefined();
    expect(deleted!._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(deleted!['2026-09-13']).toBeUndefined();
    expect(deleted!._sync.fields['2026-09-13']).toMatchObject({ deleted: true, actorId: 'A', seq: 2 });

    const recreateOps: SemanticOperation[] = [
        {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-13'],
            value: { date: '2026-09-13', weight: 82, meals: [] },
            isDelete: false,
            actorId: 'B',
            seq: 1,
            clock: { A: 2, B: 1 }
        }
    ];
    await applyDocumentChanges(db, 'a', recreateOps, () => true);

    const recreated = (await getDoc(ref)).data()!;
    expect(recreated['2026-09-13'].weight).toBe(82);
    expect(recreated._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(recreated._sync.fields['2026-09-13'].deleted).toBeUndefined();
    expect(recreated._sync.fields['2026-09-13'].clock).toEqual({ A: 2, B: 1 });
});

it('4. V3 API: remote FieldStamp can defeat a concurrent local operation', async () => {
    const db = env.authenticatedContext('a').firestore();

    await setDoc(doc(db, 'users/a'), {
        profile: { height: '190' },
        _sync: {
            protocolVersion: 1,
            clock: { B: 1 },
            fields: {
                'profile/height': { clock: { B: 1 }, actorId: 'B', seq: 1 }
            }
        }
    });

    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'height'], value: '180', isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ];

    await applyDocumentChanges(db, 'a', ops, () => true);

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.height).toBe('190');
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.clock.A).toBe(1);
});

it('5. V3 API: checkDocSize receives a document that already contains schema and sync metadata', async () => {
    const db = env.authenticatedContext('a').firestore();
    const ops: SemanticOperation[] = [
        { docPath: '', path: ['profile', 'name'], value: 'A'.repeat(500), isDelete: false, actorId: 'A', seq: 1, clock: { A: 1 } }
    ];

    const result = await applyDocumentChanges(db, 'a', ops, () => true);
    expect(result.syncMeta[''].fields['profile/name']).toBeDefined();

    const saved = (await getDoc(doc(db, 'users/a'))).data()!;
    expect(saved.profile.name).toHaveLength(500);
    expect(saved._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
    expect(saved._sync.fields['profile/name']).toBeDefined();
});
