import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

vi.mock('../../src/lib/healthConsent', async () => ({
    ...(await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent')),
    getVerifiedHealthConsentRevision: () => 1,
}));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));

import { applyDocumentChanges, CloudDataIntegrityError } from '../../src/lib/sync/transactionWriter';
import { sealCloudDocument, openCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';
import { registerReplica, seedTrustedConsent, asModularFirestore } from './replicaHarness';

let env: RulesTestEnvironment;

beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed');
    env = await initializeTestEnvironment({
        projectId: 'demo-logbook-audit',
        firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    });
});

beforeEach(async () => { await env.clearFirestore(); await seedTrustedConsent(env); });
afterAll(async () => { await env?.cleanup(); });

const profileHeightOp = (seq = 1): SemanticOperation => ({
    docPath: '',
    path: ['profile', 'height'],
    value: '180',
    isDelete: false,
    actorId: 's00',
    seq,
    clock: { s00: seq },
});



it('blocks an unrelated root write instead of replacing malformed existing cloud data with a Zod fallback', async () => {
    const original = sealCloudDocument(new Uint8Array(32).fill(18), 'a', '', {
        profile: { name: 'Baseline' },
        nutritionPlanning: { weight: 'not-a-number' },
    }, { protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's01', replicaId: 'remote-seed', generation: 1, seq: 0 } });

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), 'users/a'), original);
    });

    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const replica = await registerReplica(db, 'a');
    await expect(applyDocumentChanges(db, 'a', [profileHeightOp()], () => true, replica, new Uint8Array(32).fill(18)))
        .rejects.toBeInstanceOf(CloudDataIntegrityError);

    await env.withSecurityRulesDisabled(async context => {
        const saved = (await getDoc(doc(asModularFirestore(context.firestore()), 'users/a'))).data();
        expect(saved).toEqual(original);
    });
});

it.each(['not-a-number', '9007199254740993'])(
    'blocks a monthly write when a cloud value %s would be destructively normalized',
    async (weight) => {
        const original = sealCloudDocument(new Uint8Array(32).fill(18), 'a', 'nutrition_months/2026-09', {
            '2026-09-13': {
                date: '2026-09-13', weight, meals: [], supplementsIntake: [],
            },
        }, { protocolVersion: 3, clock: {}, fields: {},
            writer: { slot: 's01', replicaId: 'remote-seed', generation: 1, seq: 0 } });

        await env.withSecurityRulesDisabled(async context => {
            await setDoc(doc(asModularFirestore(context.firestore()), 'users/a/nutrition_months/2026-09'), original);
        });

        const op: SemanticOperation = {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-14'],
            value: { date: '2026-09-14', weight: 81, meals: [], supplementsIntake: [] },
            isDelete: false,
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 },
        };

        const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
        const replica = await registerReplica(db, 'a');
        await expect(applyDocumentChanges(db, 'a', [op], () => true, replica, new Uint8Array(32).fill(18)))
            .rejects.toBeInstanceOf(CloudDataIntegrityError);

        await env.withSecurityRulesDisabled(async context => {
            const saved = (await getDoc(doc(asModularFirestore(context.firestore()), 'users/a/nutrition_months/2026-09'))).data();
            expect(saved).toEqual(original);
        });
    },
);

it('allows an explicitly lossless scalar normalization while applying the semantic operation', async () => {
    const original = sealCloudDocument(new Uint8Array(32).fill(18), 'a', 'nutrition_months/2026-09', {
        '2026-09-13': {
            date: '2026-09-13', weight: '80.5', meals: [], supplementsIntake: [],
        },
    }, { protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's01', replicaId: 'remote-seed', generation: 1, seq: 0 } });

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), 'users/a/nutrition_months/2026-09'), original);
    });

    const op: SemanticOperation = {
        docPath: 'nutrition_months/2026-09',
        path: ['2026-09-14'],
        value: { date: '2026-09-14', weight: 81, meals: [], supplementsIntake: [] },
        isDelete: false,
        actorId: 's00',
        seq: 1,
        clock: { s00: 1 },
    };

    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const replica = await registerReplica(db, 'a');
    await applyDocumentChanges(db, 'a', [op], () => true, replica, new Uint8Array(32).fill(18));

    const saved = (await getDoc(doc(db, 'users/a/nutrition_months/2026-09'))).data()!;
    const opened = openCloudDocument(new Uint8Array(32).fill(18), 'a', 'nutrition_months/2026-09', saved).business;
    expect((opened['2026-09-13'] as Record<string, unknown>).weight).toBe(80.5);
    expect((opened['2026-09-14'] as Record<string, unknown>).weight).toBe(81);
});

it.each([
    {
        label: 'unmapped root field',
        path: '',
        business: { profile: { name: 'Baseline' } },
        field: ['unmappedBusiness'],
        value: { note: 'must survive or reject' },
    },
    {
        label: 'root scalar fallback',
        path: '',
        business: { profile: { name: 'Baseline' }, nutritionPlanning: { weight: 80 } },
        field: ['nutritionPlanning', 'weight'],
        value: 'not-a-number',
    },
    {
        label: 'nutrition scalar fallback',
        path: 'nutrition_months/2026-09',
        business: { '2026-09-13': { date: '2026-09-13', weight: 80, meals: [], supplementsIntake: [] } },
        field: ['2026-09-13', 'weight'],
        value: 'not-a-number',
    },
    {
        label: 'history scalar fallback',
        path: 'history_months/2026-09',
        business: { workout: { id: 'workout', date: '2026-09-13', globalEndTime: 123, exercises: [] } },
        field: ['workout', 'globalEndTime'],
        value: 'not-a-number',
    },
])('rejects a lossy post-merge $label without committing business or replica progress', async ({ path, business, field, value }) => {
    const key = new Uint8Array(32).fill(18);
    const original = sealCloudDocument(key, 'a', path, business, {
        protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's01', replicaId: 'remote-seed', generation: 1, seq: 0 },
    });
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), 'users/a' + (path ? '/' + path : '')), original);
    });
    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const replica = await registerReplica(db, 'a');
    const controlRef = doc(db, 'users/a/sync_control/state');
    const control = (await getDoc(controlRef)).data();
    const operation: SemanticOperation = {
        docPath: path, path: field, value, isDelete: false,
        actorId: 's00', seq: 1, clock: { s00: 1 },
    };
    const source = structuredClone(operation);

    await expect(applyDocumentChanges(db, 'a', [operation], () => true, replica, key))
        .rejects.toBeInstanceOf(CloudDataIntegrityError);

    expect(operation).toEqual(source);
    expect((await getDoc(doc(db, 'users/a' + (path ? '/' + path : '')))).data()).toEqual(original);
    expect((await getDoc(controlRef)).data()).toEqual(control);
});

it('does not create any business document or advance the replica when a later document in the batch is lossy', async () => {
    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const replica = await registerReplica(db, 'a');
    const controlRef = doc(db, 'users/a/sync_control/state');
    const control = (await getDoc(controlRef)).data();
    const operations: SemanticOperation[] = [
        profileHeightOp(),
        {
            docPath: 'nutrition_months/2026-09', path: ['2026-09-13'],
            value: { date: '2026-09-13', weight: 'not-a-number', meals: [], supplementsIntake: [] },
            isDelete: false, actorId: 's00', seq: 2, clock: { s00: 2 },
        },
    ];
    const source = structuredClone(operations);
    await expect(applyDocumentChanges(db, 'a', operations, () => true, replica, new Uint8Array(32).fill(18)))
        .rejects.toBeInstanceOf(CloudDataIntegrityError);
    expect(operations).toEqual(source);
    expect((await getDoc(doc(db, 'users/a'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'users/a/nutrition_months/2026-09'))).exists()).toBe(false);
    expect((await getDoc(controlRef)).data()).toEqual(control);
});

it('returns the exact normalized business sealed in Firestore for acknowledgement and replay', async () => {
    const key = new Uint8Array(32).fill(18);
    const db = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
    const replica = await registerReplica(db, 'a');
    const operations: SemanticOperation[] = [
        profileHeightOp(),
        {
            docPath: 'nutrition_months/2026-09', path: ['2026-09-13'],
            value: { date: '2026-09-13', weight: '80.5', meals: [], supplementsIntake: [] },
            isDelete: false, actorId: 's00', seq: 2, clock: { s00: 2 },
        },
    ];
    const source = structuredClone(operations);
    const first = await applyDocumentChanges(db, 'a', operations, () => true, replica, key);
    for (const [path, business] of first.documents) {
        const saved = (await getDoc(doc(db, 'users/a' + (path ? '/' + path : '')))).data()!;
        const opened = openCloudDocument(key, 'a', path, saved);
        expect(business).toEqual(opened.business);
        expect(first.syncMeta[path]).toEqual(opened.sync);
    }
    expect(first.documents.get('')?.nutritionPlanning).toBeNull();
    expect((first.documents.get('nutrition_months/2026-09')?.['2026-09-13'] as Record<string, unknown>).weight).toBe(80.5);
    const replay = await applyDocumentChanges(db, 'a', operations, () => true, replica, key);
    expect(replay.documents).toEqual(first.documents);
    expect(replay.syncMeta).toEqual(first.syncMeta);
    expect(operations).toEqual(source);
});
