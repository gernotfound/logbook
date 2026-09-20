import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));

import { applyDocumentChanges, CloudDataIntegrityError } from '../../src/lib/sync/transactionWriter';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';

let env: RulesTestEnvironment;

beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed');
    env = await initializeTestEnvironment({
        projectId: 'demo-logbook-audit',
        firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    });
});

beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

const profileHeightOp = (seq = 1): SemanticOperation => ({
    docPath: '',
    path: ['profile', 'height'],
    value: '180',
    isDelete: false,
    actorId: 'A',
    seq,
    clock: { A: seq },
});

it('blocks an unrelated root write instead of replacing malformed existing cloud data with a Zod fallback', async () => {
    const original = {
        profile: { name: 'Baseline' },
        nutritionPlanning: { weight: 'not-a-number' },
    };

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a'), original);
    });

    const db = env.authenticatedContext('a').firestore();
    await expect(applyDocumentChanges(db, 'a', [profileHeightOp()], () => true))
        .rejects.toBeInstanceOf(CloudDataIntegrityError);

    await env.withSecurityRulesDisabled(async context => {
        const saved = (await getDoc(doc(context.firestore(), 'users/a'))).data();
        expect(saved).toEqual(original);
    });
});

it('blocks a monthly write when another entity in the same shard would be destructively sanitized', async () => {
    const original = {
        '2026-09-13': {
            date: '2026-09-13',
            weight: 'not-a-number',
            meals: [],
            supplementsIntake: [],
        },
    };

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a/nutrition_months/2026-09'), original);
    });

    const op: SemanticOperation = {
        docPath: 'nutrition_months/2026-09',
        path: ['2026-09-14'],
        value: { date: '2026-09-14', weight: 81, meals: [], supplementsIntake: [] },
        isDelete: false,
        actorId: 'A',
        seq: 1,
        clock: { A: 1 },
    };

    const db = env.authenticatedContext('a').firestore();
    await expect(applyDocumentChanges(db, 'a', [op], () => true))
        .rejects.toBeInstanceOf(CloudDataIntegrityError);

    await env.withSecurityRulesDisabled(async context => {
        const saved = (await getDoc(doc(context.firestore(), 'users/a/nutrition_months/2026-09'))).data();
        expect(saved).toEqual(original);
    });
});

it('allows an explicitly lossless scalar normalization while applying the semantic operation', async () => {
    const original = {
        '2026-09-13': {
            date: '2026-09-13',
            weight: '80.5',
            meals: [],
            supplementsIntake: [],
        },
    };

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users/a/nutrition_months/2026-09'), original);
    });

    const op: SemanticOperation = {
        docPath: 'nutrition_months/2026-09',
        path: ['2026-09-14'],
        value: { date: '2026-09-14', weight: 81, meals: [], supplementsIntake: [] },
        isDelete: false,
        actorId: 'A',
        seq: 1,
        clock: { A: 1 },
    };

    const db = env.authenticatedContext('a').firestore();
    await applyDocumentChanges(db, 'a', [op], () => true);

    const saved = (await getDoc(doc(db, 'users/a/nutrition_months/2026-09'))).data()!;
    expect(saved['2026-09-13'].weight).toBe(80.5);
    expect(saved['2026-09-14'].weight).toBe(81);
});
