import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as idbKeyval from 'idb-keyval';
import { createRoot } from 'react-dom/client';
import { initApp } from '../src/main';
import { useAppStore } from '../src/store/useAppStore';
import {
  getStorageMarker,
  updateStorageMarker,
} from '../src/lib/storageIntegrity';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';
import { localStorageMock } from './setup';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
    unmount: vi.fn(),
  })),
}));

describe('Storage bootstrap and owner integrity checks', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('logbook_authenticated_owner', 'user:test-user-id');
    window.__INITIAL_USER_DATA__ = null;
    useAppStore.setState({
      userData: null,
      localWorkout: null,
      saveError: null,
      syncing: false,
      syncHealth: 'synced',
      localPersistenceBlocked: false,
      compatibilityStatus: 'ok',
      compatibilityError: null,
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
    const rendered = vi.mocked(vi.mocked(createRoot).mock.results[0].value.render).mock.calls[0][0] as {
      props: { children: { props: { id: string; role: string } } };
    };
    expect(rendered.props.children.props.id).toBe('storage-unavailable');
    expect(rendered.props.children.props.role).toBe('alert');
  });

  it('Flow 1: unverified owner hint cannot expose health data from IndexedDB', async () => {
    const validData = {
      profile: { height: '180' },
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
    const ownerRead = vi.spyOn(idbKeyval, 'get');

    await initApp();

    expect(ownerRead.mock.calls.some(([key]) => key === 'logbook:v2:user:test-user-id')).toBe(false);
    // Firebase has not verified this hint. The owner data is inaccessible here.
    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(useAppStore.getState().userData).toBeNull();
    expect(getStorageMarker()).toBeNull();
  });

  it('Flow 2: do not read account IndexedDB merely because an owner hint exists', async () => {
    updateStorageMarker(1000)!;
    vi.spyOn(idbKeyval, 'get').mockRejectedValue(new Error('IndexedDB blocked'));

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(vi.mocked(idbKeyval.get).mock.calls.some(([key]) => key === 'logbook:v2:user:test-user-id')).toBe(false);
    expect(getStorageMarker()?.timestamp).toBe(1000);
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    expect(useAppStore.getState().syncHealth).toBe('synced');
    expect(useAppStore.getState().saveError).toBeNull();
  });

  it('Flow 2b: account version cannot be inspected before verified authentication', async () => {
    vi.spyOn(idbKeyval, 'get').mockResolvedValue({
      version: CURRENT_LOCAL_ENVELOPE + 1,
      ownerV2: 'user:test-user-id',
    } as any);

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(useAppStore.getState().compatibilityStatus).toBe('ok');
    expect(useAppStore.getState().compatibilityError).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    expect(useAppStore.getState().saveError).toBeNull();
    expect(createRoot).toHaveBeenCalledTimes(1);
  });

  it('Flow 3: An invalid cache does not update the marker', async () => {
    updateStorageMarker(1000)!;
    vi.spyOn(idbKeyval, 'get').mockResolvedValue('corrupted string payload' as any);

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(getStorageMarker()?.timestamp).toBe(1000);
  });

  it('Flow 4: First launch without a marker or cache remains empty', async () => {
    vi.spyOn(idbKeyval, 'get').mockResolvedValue(null);

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(getStorageMarker()).toBeNull();
  });


});
