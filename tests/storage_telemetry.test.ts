import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_MARKER_KEY,
  STORAGE_ANOMALY_REPORTED_KEY,
  STORAGE_MARKER_VERSION,
  getStorageMarker,
  updateStorageMarker,
  clearStorageMarker,
  isAnomalyAlreadyReported,
  markAnomalyReported,
  detectDerivedPlatform,
  isStandaloneMode,
  calculateElapsedMs,
  diagnoseStorageState,
  shouldReportAnomaly,
  createStorageRecoveryAnomalyPayload,
  dispatchStorageRecoveryAnomaly,
} from '../src/lib/storageTelemetry';
import { UserDataSchema } from '../src/lib/schema';
import * as firestoreModule from 'firebase/firestore';
import * as firebaseLib from '../src/lib/firebase';

describe('Storage Recovery Telemetry Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('R1. Versioned Storage Marker Management', () => {
    it('returns null when storage marker does not exist in localStorage', () => {
      expect(getStorageMarker()).toBeNull();
    });

    it('returns null when storage marker contains corrupted JSON or invalid data', () => {
      localStorage.setItem(STORAGE_MARKER_KEY, 'corrupted JSON string {');
      expect(getStorageMarker()).toBeNull();

      localStorage.setItem(STORAGE_MARKER_KEY, JSON.stringify({ version: 'invalid', timestamp: 'not-a-number' }));
      expect(getStorageMarker()).toBeNull();

      localStorage.setItem(STORAGE_MARKER_KEY, JSON.stringify({ version: 1, timestamp: NaN }));
      expect(getStorageMarker()).toBeNull();
    });

    it('creates and retrieves a valid versioned storage marker', () => {
      const fixedTime = 1724486400000;
      const marker = updateStorageMarker(fixedTime);
      expect(marker).toEqual({
        version: STORAGE_MARKER_VERSION,
        timestamp: fixedTime,
        schemaVersion: 1,
      });

      const retrieved = getStorageMarker();
      expect(retrieved).toEqual(marker);
      expect(JSON.parse(localStorage.getItem(STORAGE_MARKER_KEY)!)).toEqual(marker);
    });

    it('updates marker timestamp when updated with a new timestamp', () => {
      updateStorageMarker(1000);
      expect(getStorageMarker()?.timestamp).toBe(1000);

      updateStorageMarker(2000);
      expect(getStorageMarker()?.timestamp).toBe(2000);
    });

    it('clears storage marker and reporting deduplication flags on clearStorageMarker', () => {
      const marker = updateStorageMarker(5000)!;
      markAnomalyReported(marker);
      expect(localStorage.getItem(STORAGE_MARKER_KEY)).not.toBeNull();
      expect(localStorage.getItem(STORAGE_ANOMALY_REPORTED_KEY)).not.toBeNull();

      clearStorageMarker();
      expect(getStorageMarker()).toBeNull();
      expect(localStorage.getItem(STORAGE_MARKER_KEY)).toBeNull();
      expect(localStorage.getItem(STORAGE_ANOMALY_REPORTED_KEY)).toBeNull();
    });

    it('handles localStorage exceptions gracefully without throwing', () => {
      const brokenStorage = {
        getItem: vi.fn(() => { throw new Error('Quota or Access Denied'); }),
        setItem: vi.fn(() => { throw new Error('Quota or Access Denied'); }),
        removeItem: vi.fn(() => { throw new Error('Quota or Access Denied'); }),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      } as unknown as Storage;

      expect(getStorageMarker(brokenStorage)).toBeNull();
      expect(updateStorageMarker(Date.now(), brokenStorage)).toBeNull();
      expect(() => clearStorageMarker(brokenStorage)).not.toThrow();
      expect(isAnomalyAlreadyReported({ version: 1, timestamp: 12345 }, brokenStorage)).toBe(false);
      expect(() => markAnomalyReported({ version: 1, timestamp: 12345 }, brokenStorage)).not.toThrow();
    });
  });

  describe('R2. Storage Read States & Anomaly Evaluation Logic', () => {
    it('distinguishes "read_error" when IndexedDB read throws an error', () => {
      const status = diagnoseStorageState({
        cachedData: null,
        readError: new Error('IndexedDB transaction aborted'),
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      });
      expect(status).toBe('read_error');
    });

    it('distinguishes "missing" when cachedData is null but a valid marker exists', () => {
      const status = diagnoseStorageState({
        cachedData: null,
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      });
      expect(status).toBe('missing');
    });

    it('distinguishes "missing" when cachedData is undefined but a valid marker exists', () => {
      const status = diagnoseStorageState({
        cachedData: undefined,
        marker: { version: 1, timestamp: 1000 },
        isGuest: true,
      });
      expect(status).toBe('missing');
    });

    it('distinguishes "empty_guest" when cachedData is null, isGuest is true, and marker is null', () => {
      const status = diagnoseStorageState({
        cachedData: null,
        marker: null,
        isGuest: true,
      });
      expect(status).toBe('empty_guest');
    });

    it('distinguishes "missing" for initial start when cachedData is null, isGuest is false, and marker is null', () => {
      const status = diagnoseStorageState({
        cachedData: null,
        marker: null,
        isGuest: false,
      });
      expect(status).toBe('missing');
    });

    it('distinguishes "invalid" when cachedData is malformed JSON or invalid primitive/array type', () => {
      expect(diagnoseStorageState({
        cachedData: '{ broken json',
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      })).toBe('invalid');

      expect(diagnoseStorageState({
        cachedData: 12345,
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      })).toBe('invalid');

      expect(diagnoseStorageState({
        cachedData: ['array_instead_of_object'],
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      })).toBe('invalid');
    });

    it('distinguishes "valid" when cachedData contains a valid UserData structure', () => {
      const validUserData = {
        profile: { name: 'Mario Rossi' },
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
      };
      const status = diagnoseStorageState({
        cachedData: validUserData,
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      });
      expect(status).toBe('valid');
    });

    it('distinguishes "valid" when cachedData is a JSON string of a valid UserData structure', () => {
      const validUserData = {
        profile: { name: 'Mario Rossi' },
        library: [],
        routines: [],
        history: [],
      };
      const status = diagnoseStorageState({
        cachedData: JSON.stringify(validUserData),
        marker: { version: 1, timestamp: 1000 },
        isGuest: false,
      });
      expect(status).toBe('valid');
    });
  });

  describe('R2 & Acceptance: Anomaly Generation Boundaries', () => {
    it('generates anomaly event ONLY when status is "missing" AND a valid marker exists', () => {
      const marker = { version: 1, timestamp: 1724486400000 };
      expect(shouldReportAnomaly('missing', marker)).toBe(true);
    });

    it('does NOT generate anomaly for first launch (missing cache with no marker)', () => {
      expect(shouldReportAnomaly('missing', null)).toBe(false);
    });

    it('does NOT generate anomaly for empty guest user (empty_guest with no marker)', () => {
      expect(shouldReportAnomaly('empty_guest', null)).toBe(false);
    });

    it('does NOT generate anomaly for logout (no marker present)', () => {
      clearStorageMarker();
      expect(shouldReportAnomaly('missing', getStorageMarker())).toBe(false);
    });

    it('does NOT generate anomaly for valid cache read', () => {
      const marker = { version: 1, timestamp: 1724486400000 };
      expect(shouldReportAnomaly('valid', marker)).toBe(false);
    });

    it('does NOT generate anomaly for corrupted/invalid cache (status "invalid")', () => {
      const marker = { version: 1, timestamp: 1724486400000 };
      expect(shouldReportAnomaly('invalid', marker)).toBe(false);
    });

    it('does NOT generate anomaly for read error (status "read_error")', () => {
      const marker = { version: 1, timestamp: 1724486400000 };
      expect(shouldReportAnomaly('read_error', marker)).toBe(false);
    });
  });

  describe('R3. Privacy-Minimized Payload & Controlled Clock Verification', () => {
    it('calculates elapsedMs deterministically using controlled fake timers with vi.setSystemTime()', () => {
      vi.useFakeTimers();

      const markerTime = new Date('2026-08-24T08:00:00.000Z').getTime();
      const anomalyTime = new Date('2026-08-24T08:05:30.500Z').getTime(); // 5 minutes 30.5 seconds later = 330500 ms

      vi.setSystemTime(markerTime);
      const marker = updateStorageMarker(markerTime)!;

      vi.setSystemTime(anomalyTime);

      const payload = createStorageRecoveryAnomalyPayload({
        marker,
        timestamp: Date.now(),
        persisted: true,
      });

      expect(payload.type).toBe('storage_recovery_anomaly');
      expect(payload.reason).toBe('indexeddb_cache_missing_with_valid_marker');
      expect(payload.timestamp).toBe(anomalyTime);
      expect(payload.elapsedMs).toBe(330500);
      expect(payload.persisted).toBe(true);
    });

    it('handles backwards clock skew (NTP/user change) safely with elapsedMs = 0', () => {
      const marker = { version: 1, timestamp: 200000 };
      const currentTime = 150000; // time in past

      const payload = createStorageRecoveryAnomalyPayload({
        marker,
        timestamp: currentTime,
      });

      expect(payload.elapsedMs).toBe(0);
      expect(calculateElapsedMs(currentTime, marker.timestamp)).toBe(0);
    });

    it('ensures payload contains ONLY minimal metadata and strictly NO PII or full user agent', () => {
      const marker = { version: 1, timestamp: 1000 };
      const payload = createStorageRecoveryAnomalyPayload({
        marker,
        timestamp: 2000,
        persisted: false,
      });

      const allowedKeys = ['type', 'reason', 'timestamp', 'elapsedMs', 'platform', 'standalone', 'persisted'];
      expect(Object.keys(payload).sort()).toEqual(allowedKeys.sort());

      // Explicitly check that no user data or user agent leaks into payload
      expect((payload as any).userAgent).toBeUndefined();
      expect((payload as any).email).toBeUndefined();
      expect((payload as any).uid).toBeUndefined();
      expect((payload as any).userData).toBeUndefined();
      expect(['ios', 'ipados', 'other']).toContain(payload.platform);
    });

    describe('Platform derivation privacy tests', () => {
      it('derives "ios" for iPhone and iPod user agents', () => {
        const mockIphoneNav = {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPhone',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockIphoneNav)).toBe('ios');

        const mockIpodNav = {
          userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 14_0 like Mac OS X)',
          platform: 'iPod touch',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockIpodNav)).toBe('ios');
      });

      it('derives "ipados" for iPad and MacIntel with touch support', () => {
        const mockIpadNav = {
          userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPad',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockIpadNav)).toBe('ipados');

        const mockModernIpadNav = {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockModernIpadNav)).toBe('ipados');
      });

      it('derives "other" for desktop Mac, Windows, Linux, Android or missing navigator', () => {
        const mockMacDesktop = {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          platform: 'MacIntel',
          maxTouchPoints: 0,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockMacDesktop)).toBe('other');

        const mockWindows = {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          platform: 'Win32',
          maxTouchPoints: 0,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockWindows)).toBe('other');

        const mockAndroid = {
          userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
          platform: 'Linux armv8l',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockAndroid)).toBe('other');

        expect(detectDerivedPlatform(undefined)).toBe('other');
      });
    });

    describe('Standalone detection tests', () => {
      it('detects iOS standalone mode via navigator.standalone', () => {
        const mockWin = {
          navigator: { standalone: true },
          matchMedia: () => ({ matches: false }),
        } as unknown as Window;
        expect(isStandaloneMode(mockWin)).toBe(true);
      });

      it('detects standard standalone mode via matchMedia (display-mode: standalone)', () => {
        const mockWin = {
          navigator: { standalone: false },
          matchMedia: (query: string) => ({ matches: query.includes('standalone') }),
        } as unknown as Window;
        expect(isStandaloneMode(mockWin)).toBe(true);
      });

      it('returns false for standard browser tab mode', () => {
        const mockWin = {
          navigator: { standalone: false },
          matchMedia: () => ({ matches: false }),
        } as unknown as Window;
        expect(isStandaloneMode(mockWin)).toBe(false);
      });
    });
  });

  describe('R4. Non-blocking Firestore Dispatch & Deduplication', () => {
    it('deduplicates multiple anomaly reports for the same marker timestamp', () => {
      const marker = { version: 1, timestamp: 1724486400000 };

      expect(isAnomalyAlreadyReported(marker)).toBe(false);

      markAnomalyReported(marker);
      expect(isAnomalyAlreadyReported(marker)).toBe(true);

      // Another marker with different timestamp is not marked as reported
      const newMarker = { version: 1, timestamp: 1724487000000 };
      expect(isAnomalyAlreadyReported(newMarker)).toBe(false);
    });

    it('writes anomaly payload to users/{uid}/telemetry_anomalies/{eventId} when uid is available', async () => {
      const docSpy = vi.spyOn(firestoreModule, 'doc').mockImplementation((_db: any, ...pathSegments: string[]) => ({
        path: pathSegments.join('/'),
      } as any));
      const setDocSpy = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);

      const payload = createStorageRecoveryAnomalyPayload({
        marker: { version: 1, timestamp: 1724486400000 },
        timestamp: 1724486500000,
        persisted: true,
      });

      await dispatchStorageRecoveryAnomaly(payload, 'test_user_uid_123');

      expect(docSpy).toHaveBeenCalled();
      expect(setDocSpy).toHaveBeenCalledTimes(1);
      const [docRef, data] = setDocSpy.mock.calls[0];
      expect(docRef.path).toMatch(/^users\/test_user_uid_123\/telemetry_anomalies\/anomaly_1724486500000_/);
      expect(data).toEqual(payload);
    });

    it('does not throw or reject if Firestore write rejects or times out', async () => {
      vi.spyOn(firestoreModule, 'doc').mockImplementation((_db: any, ...pathSegments: string[]) => ({
        path: pathSegments.join('/'),
      } as any));
      vi.spyOn(firestoreModule, 'setDoc').mockRejectedValue(new Error('Permission denied or network failure'));

      const payload = createStorageRecoveryAnomalyPayload({
        marker: { version: 1, timestamp: 1724486400000 },
        timestamp: 1724486500000,
      });

      await expect(dispatchStorageRecoveryAnomaly(payload, 'test_user_uid_123')).resolves.not.toThrow();
    });

    it('does not throw or write to protected Firestore collection if unauthenticated/guest without uid', async () => {
      const setDocSpy = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);

      const payload = createStorageRecoveryAnomalyPayload({
        marker: { version: 1, timestamp: 1724486400000 },
        timestamp: 1724486500000,
      });

      await dispatchStorageRecoveryAnomaly(payload, '');
      expect(setDocSpy).not.toHaveBeenCalled();
    });

    it('resolves uid via onAuthStateChanged when currentUser is initially null', async () => {
      vi.spyOn(firestoreModule, 'doc').mockImplementation((_db: any, ...pathSegments: string[]) => ({
        path: pathSegments.join('/'),
      } as any));
      const setDocSpy = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);

      const unsubSpy = vi.fn();
      vi.spyOn(firebaseLib, 'onAuthStateChanged').mockImplementation((_auth: any, callback: any) => {
        // Synchronously trigger callback with authenticated user
        callback({ uid: 'async_auth_uid_456' });
        return unsubSpy;
      });

      const payload = createStorageRecoveryAnomalyPayload({
        marker: { version: 1, timestamp: 1724486400000 },
        timestamp: 1724486500000,
      });

      await dispatchStorageRecoveryAnomaly(payload, null);

      expect(setDocSpy).toHaveBeenCalledTimes(1);
      const [docRef] = setDocSpy.mock.calls[0];
      expect(docRef.path).toContain('users/async_auth_uid_456/telemetry_anomalies/');
      expect(unsubSpy).toHaveBeenCalledTimes(1);
    });

    it('probes navigator.storage.persisted dynamically when payload.persisted is null', async () => {
      vi.spyOn(firestoreModule, 'doc').mockImplementation((_db: any, ...pathSegments: string[]) => ({
        path: pathSegments.join('/'),
      } as any));
      const setDocSpy = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);

      const originalStorage = navigator.storage;
      (navigator as any).storage = {
        persisted: vi.fn().mockResolvedValue(true),
      };

      try {
        const payload = createStorageRecoveryAnomalyPayload({
          marker: { version: 1, timestamp: 1724486400000 },
          timestamp: 1724486500000,
          persisted: null,
        });

        await dispatchStorageRecoveryAnomaly(payload, 'test_user_789');

        expect(setDocSpy).toHaveBeenCalledTimes(1);
        const [, data] = setDocSpy.mock.calls[0];
        expect(data.persisted).toBe(true);
      } finally {
        (navigator as any).storage = originalStorage;
      }
    });

    it('rejects Infinity and -Infinity in getStorageMarker and calculateElapsedMs', () => {
      localStorage.setItem(STORAGE_MARKER_KEY, JSON.stringify({ version: 1, timestamp: Infinity }));
      expect(getStorageMarker()).toBeNull();

      localStorage.setItem(STORAGE_MARKER_KEY, JSON.stringify({ version: Infinity, timestamp: 1000 }));
      expect(getStorageMarker()).toBeNull();

      expect(calculateElapsedMs(Infinity, 1000)).toBe(0);
      expect(calculateElapsedMs(2000, -Infinity)).toBe(0);
    });

    it('handles non-finite timestamps gracefully in updateStorageMarker and shouldReportAnomaly', () => {
      const now = Date.now();
      const marker1 = updateStorageMarker(NaN);
      expect(marker1).not.toBeNull();
      expect(Number.isFinite(marker1!.timestamp)).toBe(true);
      expect(marker1!.timestamp).toBeGreaterThanOrEqual(now);

      const marker2 = updateStorageMarker(Infinity);
      expect(marker2).not.toBeNull();
      expect(Number.isFinite(marker2!.timestamp)).toBe(true);

      expect(shouldReportAnomaly('missing', { version: 1, timestamp: NaN })).toBe(false);
      expect(shouldReportAnomaly('missing', { version: 1, timestamp: Infinity })).toBe(false);

      expect(isAnomalyAlreadyReported({ version: 1, timestamp: NaN })).toBe(false);
      expect(() => markAnomalyReported({ version: 1, timestamp: NaN })).not.toThrow();

      const payload = createStorageRecoveryAnomalyPayload({
        marker: { version: 1, timestamp: NaN },
        timestamp: NaN,
      });
      expect(Number.isFinite(payload.timestamp)).toBe(true);
      expect(payload.elapsedMs).toBe(0);
    });
  });
});
