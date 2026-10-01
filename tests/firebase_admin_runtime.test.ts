import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as unknown[]),
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getAuth: vi.fn(() => ({ kind: 'auth' })),
  getFirestore: vi.fn(() => ({ kind: 'db' })),
  getAppCheck: vi.fn(() => ({ kind: 'app-check' })),
}));

vi.mock('firebase-admin/app', () => ({
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: mocks.getAuth }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: mocks.getFirestore }));
vi.mock('firebase-admin/app-check', () => ({ getAppCheck: mocks.getAppCheck }));

describe('Firebase Admin runtime credential boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getApps.mockReturnValue([]);
  });

  it('always initializes Admin with Application Default Credentials', async () => {
    const runtime = await import('../functions/src/accountDeletion/firebaseAdmin');
    runtime.adminAuth();

    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp).toHaveBeenCalledWith();
  });

  it('reuses an already initialized Firebase Admin app', async () => {
    const existing = { name: '[DEFAULT]' };
    mocks.getApps.mockReturnValue([existing]);

    const runtime = await import('../functions/src/accountDeletion/firebaseAdmin');
    runtime.adminDb();

    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.getFirestore).toHaveBeenCalledWith(existing);
  });
});
