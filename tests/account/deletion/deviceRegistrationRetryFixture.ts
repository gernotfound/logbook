import { afterEach, beforeEach, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  auth: { currentUser: null as any },
  ensureAppCheck: vi.fn(async () => undefined),
}));
const appCheck = vi.hoisted(() => ({
  getLimitedUseAppCheckToken: vi.fn(async () => 'app-check-token'),
}));

// The subject lazy-imports App Check after awaits. Static mocks stay registered
// across vi.resetModules and cannot accidentally fall back to a real provider.
vi.mock('../../../src/lib/firebase', () => firebase);
vi.mock('../../../src/lib/appCheck', () => appCheck);
export const deviceRegistrationMocks = { firebase, appCheck };

export function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

export function user(uid = 'user-a') {
  return {
    uid,
    getIdToken: vi.fn(async () => 'id-token'),
  } as any;
}

export async function loadSubject() {
  vi.resetModules();
  // This suite replaces firebase.ts with a plain fixture. Install that
  // provider's live identity in the same newly reset module graph as the
  // production recovery/session code; never bypass the owner/session guard.
  const { authenticatedIdentitySource } =
    await import('../../../src/lib/sync/authenticatedIdentitySource');
  authenticatedIdentitySource.install(() => firebase.auth.currentUser);
  // The shared UI harness suppresses incidental registration; this dedicated
  // suite must exercise the real device-recovery code instead.
  vi.doUnmock('../../../src/lib/deletionDeviceRecovery');
  return import('../../../src/lib/deletionDeviceRecovery');
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  firebase.auth.currentUser = null;
  firebase.ensureAppCheck.mockClear();
  appCheck.getLimitedUseAppCheckToken.mockClear();
  setOnline(true);
});

afterEach(() => {
  firebase.auth.currentUser = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

