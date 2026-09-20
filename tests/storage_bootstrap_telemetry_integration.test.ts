import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as idbKeyval from 'idb-keyval';
import { createRoot } from 'react-dom/client';
import { initApp } from '../src/main';
import { useAppStore } from '../src/store/useAppStore';
import {
  STORAGE_MARKER_VERSION,
  getStorageMarker,
  updateStorageMarker,
  isAnomalyAlreadyReported,
} from '../src/lib/storageTelemetry';
import * as storageTelemetryModule from '../src/lib/storageTelemetry';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';
import { localStorageMock } from './setup';

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
    useAppStore.setState({
      userData: null,
      localWorkout: null,
      saveError: null,
      syncing: false,
      syncHealth: 'synced',
      localPersistenceBlocked: false,
    });
    vi.clearAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    localStorage.clear();
    window.__INITIAL_USER_DATA__ = null;
    vi.restoreAllMocks();
  });

  it('Flow 0: unreadable ownership storage renders a recovery barrier before IndexedDB bootstrap', async () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const getSpy = vi.spyOn(idbKeyval, 'get');

    await initApp();

    expect(getSpy).not.toHaveBeenCalled();
    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().syncHealth).toBe('failed');
    expect(useAppStore.getState().saveError).toContain('Archivio del dispositivo non disponibile');
    expect(createRoot).toHaveBeenCalledTimes(1);
  });

  it('Flow 1: Valid current cache in IndexedDB initializes store and updates marker', async () => {
    const validData = {
      profile: { name: 'Gym Athlete' },
      library: [],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
    };
    vi.spyOn(idbKeyval, 'get').mockImplementation(async key => key === 'logbook:v2:user:test-user-id' ? {
      version: CURRENT_LOCAL_ENVELOPE,
      dataSchemaVersion: CURRENT_DATA_SCHEMA,
      syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
      owner: 'user:test-user-id',
      actorId: 'actor', actorSeq: 0, clock: {}, data: validData, baseline: validData,
      pending: [], syncMetaByDocument: {}, completeMonths: [], revision: 0
    } : undefined);
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).not.toBeNull();
    expect(useAppStore.getState().userData?.profile?.name).toBe('Gym Athlete');

    const marker = getStorageMarker();
    expect(marker).not.toBeNull();
    expect(marker?.version).toBe(STORAGE_MARKER_VERSION);
    expect(typeof marker?.timestamp).toBe('number');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Flow 2: IndexedDB read_error does NOT update marker and does NOT dispatch anomaly', async () => {
    updateStorageMarker(1000)!;
    vi.spyOn(idbKeyval, 'get').mockRejectedValue(new Error('IndexedDB blocked'));
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(getStorageMarker()?.timestamp).toBe(1000);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Flow 3: Invalid cache does NOT update marker and does NOT dispatch anomaly', async () => {
    updateStorageMarker(1000)!;
    vi.spyOn(idbKeyval, 'get').mockResolvedValue('corrupted string payload' as any);
    const dispatchSpy = vi.spyOn(storageTelemetryModule, 'dispatchStorageRecoveryAnomaly');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
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
    const bootTime = 1005000;

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

    expect(isAnomalyAlreadyReported(marker)).toBe(true);
    await initApp();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
