import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('../src/lib/db');

const testUid = 'test-user-id';
const boundary = vi.hoisted(() => ({
    token: vi.fn(),
    read: vi.fn(),
    readRoot: vi.fn(),
    commit: vi.fn(),
}));

import { DB } from '../src/lib/db';
import { auth, deleteUser } from '../src/lib/firebase';

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: {
            uid: 'test-user-id',
            getIdTokenResult: () => boundary.token(),
        },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: {},
    getDb: vi.fn().mockReturnValue({}),
    ensureAppCheck: vi.fn().mockResolvedValue(undefined),
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/sync/session', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/sync/session')>('../src/lib/sync/session');
    return {
        ...actual,
        storageOwner: () => auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest',
        captureSession: () => ({ owner: auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest', epoch: 0 }),
        isCurrentSession: (session: any) => session.owner === (auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest'),
    };
});

const createdBatches: any[] = [];

vi.mock('firebase/firestore', () => ({
    collection: (_db: unknown, ...path: string[]) => path.join('/'),
    doc: (_db: unknown, ...path: string[]) => path.join('/'),
    limit: (count: number) => count,
    query: (path: string, count: number) => ({ path, count }),
    getDocsFromServer: boundary.read,
    getDocFromServer: boundary.readRoot,
    getDocs: vi.fn(),
    writeBatch: () => {
        const batch = {
            deletedRefs: [] as any[],
            delete: vi.fn((ref: any) => {
                batch.deletedRefs.push(ref);
            }),
            commit: vi.fn().mockImplementation(async () => {
                await boundary.commit(batch.deletedRefs);
            }),
        };
        createdBatches.push(batch);
        return batch as any;
    },
}));

describe('Challenger 2: DB.deleteAccount Chunking Stress & Adversarial Verification', () => {
    let documents: Set<string>;

    beforeEach(() => {
        vi.clearAllMocks();
        createdBatches.length = 0;
        documents = new Set([`users/${testUid}`]);

        boundary.token.mockResolvedValue({ authTime: new Date().toISOString() });
        auth.currentUser = {
            uid: testUid,
            getIdTokenResult: boundary.token,
        } as any;

        boundary.read.mockImplementation(async ({ path, count }: { path: string; count: number }) => {
            const docs = [...documents].filter(key => key.startsWith(path + '/')).slice(0, count).map(ref => ({ ref }));
            return { docs, empty: docs.length === 0 };
        });

        boundary.readRoot.mockImplementation(async (ref: string) => ({
            exists: () => documents.has(ref),
        }));

        boundary.commit.mockImplementation(async (refs: any[]) => {
            refs.forEach(ref => documents.delete(typeof ref === 'string' ? ref : ref.path ?? ref));
        });
    });

    it('Scenario 1: Small account (10 history + 10 nutrition = 21 total refs) -> bounded per-collection batches', async () => {
        for (let i = 0; i < 10; i++) {
            documents.add(`users/${testUid}/history_months/hist_${i}`);
            documents.add(`users/${testUid}/nutrition_months/nut_${i}`);
        }

        await DB.deleteAccount();

        // 1 batch for history (10), 1 batch for nutrition (10), 1 batch for root doc (1)
        expect(createdBatches).toHaveLength(3);
        const totalDeleted = createdBatches.reduce((sum, b) => sum + b.deletedRefs.length, 0);
        expect(totalDeleted).toBe(21); // 10 hist + 10 nut + 1 userDoc
        createdBatches.forEach(b => expect(b.commit).toHaveBeenCalledTimes(1));
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 2: Boundary test at exact 400 refs (199 history + 200 nutrition + 1 user doc = 400 total refs)', async () => {
        for (let i = 0; i < 199; i++) documents.add(`users/${testUid}/history_months/hist_${i}`);
        for (let i = 0; i < 200; i++) documents.add(`users/${testUid}/nutrition_months/nut_${i}`);

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(3);
        const totalDeleted = createdBatches.reduce((sum, b) => sum + b.deletedRefs.length, 0);
        expect(totalDeleted).toBe(400);
        expect(createdBatches.map(b => b.deletedRefs.length)).toEqual([199, 200, 1]);
        createdBatches.forEach(b => expect(b.commit).toHaveBeenCalledTimes(1));
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 3: Exceeding chunk boundary (450 history + 50 nutrition + 1 user doc = 501 total refs) -> bounded 400-doc pages', async () => {
        for (let i = 0; i < 450; i++) documents.add(`users/${testUid}/history_months/hist_${i}`);
        for (let i = 0; i < 50; i++) documents.add(`users/${testUid}/nutrition_months/nut_${i}`);

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(4);
        expect(createdBatches.map(b => b.deletedRefs.length)).toEqual([400, 50, 50, 1]);
        createdBatches.forEach(b => expect(b.commit).toHaveBeenCalledTimes(1));
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 4: Heavy legacy account with >1200 documents (600 hist + 600 nut + 1 user = 1201 refs) -> exactly 5 batches (400 + 200 + 400 + 200 + 1)', async () => {
        for (let i = 0; i < 600; i++) documents.add(`users/${testUid}/history_months/hist_${i}`);
        for (let i = 0; i < 600; i++) documents.add(`users/${testUid}/nutrition_months/nut_${i}`);

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(5);
        expect(createdBatches.map(b => b.deletedRefs.length)).toEqual([400, 200, 400, 200, 1]);
        createdBatches.forEach(b => expect(b.commit).toHaveBeenCalledTimes(1));
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 5: Partial failure during chunk commits stops execution and does NOT delete Auth user', async () => {
        for (let i = 0; i < 450; i++) documents.add(`users/${testUid}/history_months/hist_${i}`);
        for (let i = 0; i < 50; i++) documents.add(`users/${testUid}/nutrition_months/nut_${i}`);

        let batchIndex = 0;
        boundary.commit.mockImplementation(async (refs: any[]) => {
            batchIndex++;
            if (batchIndex === 2) {
                throw new Error('Network error on batch 2');
            }
            refs.forEach(ref => documents.delete(typeof ref === 'string' ? ref : ref.path ?? ref));
        });

        await expect(DB.deleteAccount()).rejects.toThrow('Network error on batch 2');
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it('Scenario 6: Permission denied on subcollection getDocs falls back safely without deleting user', async () => {
        boundary.read.mockRejectedValue(new Error('Missing or insufficient permissions'));

        await expect(DB.deleteAccount()).rejects.toThrow('Cancellazione non completata');
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it('Scenario 7: Unauthenticated call throws immediate Error', async () => {
        auth.currentUser = null;
        await expect(DB.deleteAccount()).rejects.toThrow('Nessun utente autenticato.');
    });

    it('Scenario 8: auth/requires-recent-login is caught and converted to informative security message', async () => {
        vi.mocked(deleteUser).mockRejectedValue({ code: 'auth/requires-recent-login' });

        await expect(DB.deleteAccount()).rejects.toThrow(/requires-recent-login|login/);
    });

    it('Scenario 9: Stale authentication token (>5 min) aborts deletion before any destructive operations', async () => {
        boundary.token.mockResolvedValue({ authTime: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
        await expect(DB.deleteAccount()).rejects.toThrow('Per eliminare l’account devi effettuare di nuovo il login. Nessun dato è stato cancellato.');
        expect(deleteUser).not.toHaveBeenCalled();
    });
});
