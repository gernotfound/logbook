import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as unknown[]),
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  cert: vi.fn((value: unknown) => ({ credential: value })),
  getAuth: vi.fn(() => ({ kind: 'auth' })),
  getFirestore: vi.fn(() => ({ kind: 'db' })),
  getAppCheck: vi.fn(() => ({ kind: 'app-check' })),
}));

vi.mock('firebase-admin/app', () => ({
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
  cert: mocks.cert,
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: mocks.getAuth }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: mocks.getFirestore }));
vi.mock('firebase-admin/app-check', () => ({ getAppCheck: mocks.getAppCheck }));

const keys = [
  'FIREBASE_CONFIG',
  'FIREBASE_ADMIN_PROJECT_ID',
  'FIREBASE_ADMIN_CLIENT_EMAIL',
  'FIREBASE_ADMIN_PRIVATE_KEY',
] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

function clearRuntimeEnv() {
  for (const key of keys) delete process.env[key];
}

describe('Firebase Admin runtime credential boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    clearRuntimeEnv();
    mocks.getApps.mockReturnValue([]);
  });

  afterEach(() => {
    clearRuntimeEnv();
    for (const key of keys) {
      if (original[key] !== undefined) process.env[key] = original[key];
    }
  });

  it('forces ADC in Firebase-managed runtime even if legacy key envs are accidentally present', async () => {
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'firebase-project' });
    process.env.FIREBASE_ADMIN_PROJECT_ID = 'legacy-project';
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL = 'legacy@example.invalid';
    process.env.FIREBASE_ADMIN_PRIVATE_KEY = 'legacy-private-key';

    const runtime = await import('../functions/src/accountDeletion/firebaseAdmin');
    runtime.adminAuth();

    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp).toHaveBeenCalledWith();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('retains the temporary certificate adapter outside Firebase for legacy Vercel', async () => {
    process.env.FIREBASE_ADMIN_PROJECT_ID = 'legacy-project';
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL = 'legacy@example.invalid';
    process.env.FIREBASE_ADMIN_PRIVATE_KEY = 'line1\\nline2';

    const runtime = await import('../functions/src/accountDeletion/firebaseAdmin');
    runtime.adminDb();

    expect(mocks.cert).toHaveBeenCalledWith({
      projectId: 'legacy-project',
      clientEmail: 'legacy@example.invalid',
      privateKey: 'line1\nline2',
    });
    expect(mocks.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'legacy-project',
      credential: expect.anything(),
    }));
  });

  it('still permits local ADC when neither Firebase-managed config nor legacy key envs exist', async () => {
    const runtime = await import('../functions/src/accountDeletion/firebaseAdmin');
    runtime.adminAppCheck();

    expect(mocks.initializeApp).toHaveBeenCalledWith();
    expect(mocks.cert).not.toHaveBeenCalled();
  });
});
