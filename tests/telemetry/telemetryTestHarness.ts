import { afterEach, beforeEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import * as firebaseLib from '../../src/lib/firebase';
import { telemetryHub } from '../../src/lib/telemetryHub';

export let mockSetDoc: any;
export const originalNavigator = { ...globalThis.navigator };

export function installTelemetryTestHarness(): void {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {
      return { path: pathSegments.join('/') } as any;
    });
    vi.spyOn(firebaseLib, 'ensureAppCheck').mockResolvedValue({
      success: true,
      appCheck: {} as any,
      isFallbackOffline: false,
      disabled: false,
      phase: 'token-ready',
      providerInitialized: true,
      tokenAvailable: true,
    });
    vi.spyOn(firebaseLib, 'getDb').mockReturnValue({} as any);

    if (telemetryHub && typeof telemetryHub.reset === 'function') {
      telemetryHub.reset();
      telemetryHub.setUserId('test-user');
    }
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    if (telemetryHub && typeof telemetryHub.reset === 'function') {
      telemetryHub.reset();
      telemetryHub.setUserId('test-user');
    }
  });
}
