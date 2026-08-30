import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDocs, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');

import { DB } from '../src/lib/db';
import { auth, deleteUser } from '../src/lib/firebase';

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'user_chunk_test_123' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: {},
    getDb: vi.fn().mockReturnValue({}),
    ensureAppCheck: vi.fn().mockResolvedValue(undefined),
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
}));

describe('Challenger 2: DB.deleteAccount Chunking Stress & Adversarial Verification', () => {
    const createdBatches: any[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        createdBatches.length = 0;

        auth.currentUser = { uid: 'user_chunk_test_123' } as any;

        vi.mocked(writeBatch).mockImplementation(() => {
            const batch = {
                deletedRefs: [] as any[],
                delete: vi.fn((ref: any) => {
                    batch.deletedRefs.push(ref);
                }),
                commit: vi.fn().mockResolvedValue(undefined),
            };
            createdBatches.push(batch);
            return batch as any;
        });
    });

    it('Scenario 1: Small account (10 history + 10 nutrition = 21 total refs) -> 1 batch', async () => {
        const mockHistDocs = Array.from({ length: 10 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/history_months/2026-0${(i % 9) + 1}` }
        }));
        const mockNutDocs = Array.from({ length: 10 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/nutrition_months/2026-0${(i % 9) + 1}` }
        }));

        let callCount = 0;
        vi.mocked(getDocs).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ forEach: (cb: any) => mockHistDocs.forEach(cb) } as any);
            }
            if (callCount === 2) {
                return Promise.resolve({ forEach: (cb: any) => mockNutDocs.forEach(cb) } as any);
            }
            return Promise.resolve({ forEach: () => {} } as any);
        });

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(1);
        expect(createdBatches[0].deletedRefs).toHaveLength(21); // 10 hist + 10 nut + 1 userDoc
        expect(createdBatches[0].commit).toHaveBeenCalledTimes(1);
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 2: Boundary test at exact 400 refs (199 history + 200 nutrition + 1 user doc = 400 total refs) -> exactly 1 batch of 400', async () => {
        const mockHistDocs = Array.from({ length: 199 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/history_months/hist_${i}` }
        }));
        const mockNutDocs = Array.from({ length: 200 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/nutrition_months/nut_${i}` }
        }));

        let callCount = 0;
        vi.mocked(getDocs).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ forEach: (cb: any) => mockHistDocs.forEach(cb) } as any);
            }
            if (callCount === 2) {
                return Promise.resolve({ forEach: (cb: any) => mockNutDocs.forEach(cb) } as any);
            }
            return Promise.resolve({ forEach: () => {} } as any);
        });

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(1);
        expect(createdBatches[0].deletedRefs).toHaveLength(400);
        expect(createdBatches[0].commit).toHaveBeenCalledTimes(1);
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 3: Exceeding chunk boundary (200 history + 200 nutrition + 1 user doc = 401 total refs) -> exactly 2 batches (400 + 1)', async () => {
        const mockHistDocs = Array.from({ length: 200 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/history_months/hist_${i}` }
        }));
        const mockNutDocs = Array.from({ length: 200 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/nutrition_months/nut_${i}` }
        }));

        let callCount = 0;
        vi.mocked(getDocs).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ forEach: (cb: any) => mockHistDocs.forEach(cb) } as any);
            }
            if (callCount === 2) {
                return Promise.resolve({ forEach: (cb: any) => mockNutDocs.forEach(cb) } as any);
            }
            return Promise.resolve({ forEach: () => {} } as any);
        });

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(2);
        expect(createdBatches[0].deletedRefs).toHaveLength(400);
        expect(createdBatches[1].deletedRefs).toHaveLength(1); // the 401st item (root user doc)
        expect(createdBatches[0].commit).toHaveBeenCalledTimes(1);
        expect(createdBatches[1].commit).toHaveBeenCalledTimes(1);
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 4: Heavy legacy account with >1200 documents (600 hist + 600 nut + 1 user = 1201 refs) -> exactly 4 batches (400 + 400 + 400 + 1)', async () => {
        const mockHistDocs = Array.from({ length: 600 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/history_months/hist_${i}` }
        }));
        const mockNutDocs = Array.from({ length: 600 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/nutrition_months/nut_${i}` }
        }));

        let callCount = 0;
        vi.mocked(getDocs).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ forEach: (cb: any) => mockHistDocs.forEach(cb) } as any);
            }
            if (callCount === 2) {
                return Promise.resolve({ forEach: (cb: any) => mockNutDocs.forEach(cb) } as any);
            }
            return Promise.resolve({ forEach: () => {} } as any);
        });

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(4);
        expect(createdBatches[0].deletedRefs).toHaveLength(400);
        expect(createdBatches[1].deletedRefs).toHaveLength(400);
        expect(createdBatches[2].deletedRefs).toHaveLength(400);
        expect(createdBatches[3].deletedRefs).toHaveLength(1);
        createdBatches.forEach(b => expect(b.commit).toHaveBeenCalledTimes(1));
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 5: Partial failure during chunk commits stops execution and does NOT delete Auth user', async () => {
        const mockHistDocs = Array.from({ length: 450 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/history_months/hist_${i}` }
        }));
        const mockNutDocs = Array.from({ length: 50 }, (_, i) => ({
            ref: { path: `users/user_chunk_test_123/nutrition_months/nut_${i}` }
        }));

        let callCount = 0;
        vi.mocked(getDocs).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ forEach: (cb: any) => mockHistDocs.forEach(cb) } as any);
            }
            if (callCount === 2) {
                return Promise.resolve({ forEach: (cb: any) => mockNutDocs.forEach(cb) } as any);
            }
            return Promise.resolve({ forEach: () => {} } as any);
        });

        let batchIndex = 0;
        vi.mocked(writeBatch).mockImplementation(() => {
            batchIndex++;
            const currentIdx = batchIndex;
            const batch = {
                deletedRefs: [] as any[],
                delete: vi.fn((ref: any) => batch.deletedRefs.push(ref)),
                commit: vi.fn().mockImplementation(() => {
                    if (currentIdx === 2) {
                        return Promise.reject(new Error('Network error on batch 2'));
                    }
                    return Promise.resolve(undefined);
                }),
            };
            createdBatches.push(batch);
            return batch as any;
        });

        await expect(DB.deleteAccount()).rejects.toThrow('Network error on batch 2');
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it('Scenario 6: Permission denied on subcollection getDocs falls back gracefully to deleting user doc', async () => {
        vi.mocked(getDocs).mockRejectedValue(new Error('Missing or insufficient permissions'));

        await DB.deleteAccount();

        expect(createdBatches).toHaveLength(1);
        expect(createdBatches[0].deletedRefs).toHaveLength(1); // user doc
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it('Scenario 7: Unauthenticated call throws immediate Error', async () => {
        auth.currentUser = null;
        await expect(DB.deleteAccount()).rejects.toThrow('Nessun utente autenticato.');
    });

    it('Scenario 8: auth/requires-recent-login is caught and converted to informative security message', async () => {
        vi.mocked(getDocs).mockResolvedValue({ forEach: () => {} } as any);
        vi.mocked(deleteUser).mockRejectedValue({ code: 'auth/requires-recent-login' });

        await expect(DB.deleteAccount()).rejects.toThrow('Per motivi di sicurezza, devi ricaricare la pagina ed effettuare di nuovo il login prima di poter eliminare il tuo account.');
    });
});
