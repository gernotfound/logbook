import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { SyncMeta } from '../../src/lib/sync/semanticProjection';

const catalog = vi.hoisted(() => ({ exercises: [], foods: [] }));
const firebaseHarness = vi.hoisted(() => ({
    auth: { currentUser: { uid: 'a' } as { uid: string } | null },
    db: undefined as unknown as Firestore,
}));
const acknowledgeHarness = vi.hoisted(() => ({
    before: undefined as ((owner: string, expectedSeq: number) => Promise<void>) | undefined,
    after: undefined as ((owner: string, expectedSeq: number, syncMeta?: Record<string, SyncMeta>) => Promise<void>) | undefined,
}));

vi.mock('../../src/lib/firebase', () => ({
    auth: firebaseHarness.auth,
    getDb: () => firebaseHarness.db,
    ensureAppCheck: async () => {},
    waitForPendingWrites: async () => {},
}));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => catalog }));
vi.mock('../../src/lib/sync/localRepository', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/sync/localRepository')>('../../src/lib/sync/localRepository');
    return {
        ...actual,
        acknowledgeThrough: async (...args: Parameters<typeof actual.acknowledgeThrough>) => {
            await acknowledgeHarness.before?.(args[0], args[1]);
            await actual.acknowledgeThrough(...args);
            await acknowledgeHarness.after?.(args[0], args[1], args[5]);
        },
    };
});

import type { UserData } from '../../src/types';
import { UserDataSchema } from '../../src/lib/schema';
import {
    commitLocal,
    initializeLocal,
    readLocal,
    type LocalEnvelope,
} from '../../src/lib/sync/localRepository';
import { replicateJournal, waitForJournalIdle } from '../../src/lib/sync/replicateJournal';
import { invalidateSession } from '../../src/lib/sync/session';
import { projectDocuments, type DocumentData } from '../../src/lib/sync/documentProjection';
import { diffDocuments } from '../../src/lib/sync/semanticProjection';
import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';

const owner = 'user:a';
const remoteActor = 'remote-actor';

function data(height: number, name?: string): UserData {
    return UserDataSchema.parse({
        profile: {
            height: String(height),
            ...(name ? { name } : {}),
        },
    }) as unknown as UserData;
}

let env: RulesTestEnvironment;

beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed');
    vi.stubGlobal('navigator', { onLine: true });
    env = await initializeTestEnvironment({
        projectId: 'demo-logbook-audit',
        firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    });
});

beforeEach(async () => {
    await clear();
    await env.clearFirestore();
    invalidateSession();
    firebaseHarness.auth.currentUser = { uid: 'a' };
    firebaseHarness.db = env.authenticatedContext('a').firestore();
    acknowledgeHarness.before = undefined;
    acknowledgeHarness.after = undefined;
    await initializeLocal(owner, data(170));
});

afterEach(async () => {
    await waitForJournalIdle(owner);
    acknowledgeHarness.before = undefined;
    acknowledgeHarness.after = undefined;
    vi.restoreAllMocks();
});

afterAll(async () => {
    await env?.cleanup();
    vi.unstubAllGlobals();
});

describe('remote commit to local acknowledgement reconciliation', () => {
    it('keeps the remote causal baseline, replays a concurrent local edit, and converges on the next acknowledgement', async () => {
        const initial = data(170);
        const remoteDesired = data(170, 'remote-device');
        const db = firebaseHarness.db;
        const userRef = doc(db, 'users/a');

        await setDoc(userRef, projectDocuments(initial, catalog).get('')!);
        const remoteSeedOps = diffDocuments(
            projectDocuments(initial, catalog),
            projectDocuments(remoteDesired, catalog),
            remoteActor,
            1,
            { [remoteActor]: 1 },
        );
        const seeded = await applyDocumentChanges(db, 'a', remoteSeedOps, () => true);
        expect(seeded.syncMeta[''].fields['profile/name']).toMatchObject({
            actorId: remoteActor,
            seq: 1,
            clock: { [remoteActor]: 1 },
        });

        await commitLocal(owner, data(171), initial);
        const seqOneEnvelope = await readLocal(owner);
        expect(seqOneEnvelope).toBeDefined();
        expect(seqOneEnvelope?.actorSeq).toBe(1);
        expect(seqOneEnvelope?.pending.length).toBeGreaterThan(0);
        expect(seqOneEnvelope?.pending.every(operation => operation.seq === 1)).toBe(true);
        const localActor = seqOneEnvelope!.actorId;

        let injected = false;
        let firstAckEnvelope: LocalEnvelope | undefined;
        let firstAckCloud: DocumentData | undefined;
        let firstOutcomeSyncMeta: Record<string, SyncMeta> | undefined;

        acknowledgeHarness.before = async (_owner, expectedSeq) => {
            if (expectedSeq !== 1 || injected) return;
            injected = true;
            const current = await readLocal(owner);
            if (!current) throw new Error('Missing local envelope before acknowledgement');
            const next = UserDataSchema.parse({
                ...current.data,
                profile: { ...(current.data.profile ?? {}), height: '172' },
            }) as unknown as UserData;
            await commitLocal(owner, next, current.data);
        };

        acknowledgeHarness.after = async (_owner, expectedSeq, syncMeta) => {
            if (expectedSeq !== 1 || firstAckEnvelope) return;
            const current = await readLocal(owner);
            if (!current) throw new Error('Missing local envelope after acknowledgement');
            firstAckEnvelope = structuredClone(current);
            firstAckCloud = structuredClone((await getDoc(userRef)).data() as DocumentData);
            firstOutcomeSyncMeta = structuredClone(syncMeta ?? {});
        };

        const result = await replicateJournal(owner);
        if (!result.ok) throw result.error;
        expect(result.status).toBe('synced');
        expect(injected).toBe(true);

        expect(firstAckCloud?.profile).toMatchObject({ height: '171', name: 'remote-device' });
        expect(firstOutcomeSyncMeta?.[''].fields['profile/name']).toMatchObject({ actorId: remoteActor, seq: 1 });
        expect(firstOutcomeSyncMeta?.[''].fields['profile/height']).toMatchObject({ actorId: localActor, seq: 1 });

        expect(firstAckEnvelope?.baseline.profile).toMatchObject({ height: '171', name: 'remote-device' });
        expect(firstAckEnvelope?.data.profile).toMatchObject({ height: '172', name: 'remote-device' });
        expect(firstAckEnvelope?.pending.length).toBeGreaterThan(0);
        expect(firstAckEnvelope?.pending.every(operation => operation.seq === 2)).toBe(true);
        expect(firstAckEnvelope?.pending.some(operation => operation.seq === 1)).toBe(false);

        const pendingIdentities = firstAckEnvelope!.pending.map(operation => JSON.stringify([
            operation.actorId,
            operation.seq,
            operation.docPath,
            operation.path,
            operation.isDelete,
        ]));
        expect(new Set(pendingIdentities).size).toBe(pendingIdentities.length);

        const reconciledMeta = firstAckEnvelope!.syncMetaByDocument[''];
        expect(reconciledMeta.clock).toMatchObject({ [remoteActor]: 1, [localActor]: 2 });
        expect(reconciledMeta.fields['profile/name']).toMatchObject({ actorId: remoteActor, seq: 1 });
        expect(reconciledMeta.fields['profile/height']).toMatchObject({ actorId: localActor, seq: 2 });

        const finalEnvelope = await readLocal(owner);
        const finalCloud = (await getDoc(userRef)).data()!;

        expect(finalEnvelope?.pending).toEqual([]);
        expect(finalEnvelope?.baseline.profile).toMatchObject({ height: '172', name: 'remote-device' });
        expect(finalEnvelope?.data.profile).toMatchObject({ height: '172', name: 'remote-device' });
        expect(finalEnvelope?.clock).toMatchObject({ [remoteActor]: 1, [localActor]: 2 });
        expect(finalEnvelope?.syncMetaByDocument[''].fields['profile/name']).toMatchObject({ actorId: remoteActor, seq: 1 });
        expect(finalEnvelope?.syncMetaByDocument[''].fields['profile/height']).toMatchObject({ actorId: localActor, seq: 2 });
        expect(finalCloud.profile).toMatchObject({ height: '172', name: 'remote-device' });
        expect(finalCloud._sync).toEqual(finalEnvelope?.syncMetaByDocument['']);
    });
});
