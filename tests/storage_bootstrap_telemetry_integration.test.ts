import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as idbKeyval from 'idb-keyval';
import { initApp } from '../src/main';
import { useAppStore } from '../src/store/useAppStore';
import {
  STORAGE_MARKER_VERSION,
  getStorageMarker,
  updateStorageMarker,
  isAnomalyAlreadyReported,
} from '../src/lib/storageTelemetry';
import * as storageTelemetryModule from '../src/lib/storageTelemetry';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
    unmount: vi.fn(),
  })),
}));

describe('Storage Bootstrap & Telemetry Integration Flow', () => {
  beforeEach(() => {
    localStorage.clear();
    window.__INITIAL_USER_DATA__ = null;
    useAppStore.setState({ userData: null, localWorkout: null, saveError: null, syncing: false });
    vi.clearAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    localStorage.clear();
    window.__INITIAL_USER_DATA__ = null;
    vi.restoreAllMocks();
  });

  it('Flow 1: Valid cache in IndexedDB initializes store and updates marker', async () => {
    const validData = {
      profile: { name: 'Gym Athlete' },
      library: [],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
    };
    vi.spyOn(idbKeyval, 'get').mockImplementation(async key => key === 'logbook:v2:user:test-user-id' ? { version: 3, owner: 'user:test-user-id', actorId: 'actor', actorSeq: 0, clock: {}, data: validData, baseline: validData, pending: [], syncMetaByDocument: {}, completeMonths: [], revision: 0 } : undefined);
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    // Verify initial user data was set and parsed
    expect(window.__INITIAL_USER_DATA__).not.toBeNull();
    expect(useAppStore.getState().userData?.profile?.name).toBe('Gym Athlete');

    // Verify marker was updated
    const marker = getStorageMarker();
    expect(marker).not.toBeNull();
    expect(marker?.version).toBe(STORAGE_MARKER_VERSION);
    expect(typeof marker?.timestamp).toBe('number');

    // No anomaly dispatched
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Flow 2: IndexedDB read_error does NOT update marker and does NOT dispatch anomaly', async () => {
    // Set a previous marker
updateStorageMarker(1000)!;
    vi.spyOn(idbKeyval, 'get').mockRejectedValue(new Error('IndexedDB blocked'));
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    // Marker timestamp should remain unchanged from priorMarker, not updated to new time
    expect(getStorageMarker()?.timestamp).toBe(1000);
    // Read error should NOT trigger anomaly dispatch
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Flow 3: Invalid cache does NOT update marker and does NOT dispatch anomaly', async () => {
updateStorageMarker(1000)!;
    // Return corrupted non-object data
    vi.spyOn(idbKeyval, 'get').mockResolvedValue('corrupted string payload' as any);
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    // Marker timestamp should remain unchanged
    expect(getStorageMarker()?.timestamp).toBe(1000);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Flow 4: First launch or clean state (no marker, missing cache) does NOT dispatch anomaly', async () => {
    vi.spyOn(idbKeyval, 'get').mockResolvedValue(null);
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(getStorageMarker()).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Flow 5: Anomaly Detected when valid marker exists in localStorage but cache in IndexedDB is missing', async () => {
    vi.useFakeTimers();
    const markerTime = 1000000;
    const bootTime = 1005000; // 5000ms later

    vi.setSystemTime(markerTime);
    const marker = updateStorageMarker(markerTime)!;

    vi.setSystemTime(bootTime);
    vi.spyOn(idbKeyval, 'get').mockResolvedValue(null);
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly').mockResolvedValue();

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const payload = dispatchSpy.mock.calls[0][0];
    expect(payload.type).toBe('storage_recovery_anomaly');
    expect(payload.reason).toBe('indexeddb_cache_missing_with_valid_marker');
    expect(payload.timestamp).toBe(bootTime);
    expect(payload.elapsedMs).toBe(5000);

    // Verify deduplication flag was set
    expect(isAnomalyAlreadyReported(marker)).toBe(true);

    // Subsequent boot with the same missing state does NOT dispatch duplicate event
    await initApp();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
