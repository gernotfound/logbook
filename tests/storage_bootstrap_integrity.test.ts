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
import { idbStore, localStorageMock } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { isVaultUnlocked, lockAllVaults, lockVault, vaultControlKey } from '../src/lib/sync/secureArchiveSession';
import { initializeLocal } from '../src/lib/sync/localRepository';
import { UserDataSchema } from '../src/lib/schema';
import { deviceVaultKeyId } from '../src/lib/sync/secureArchiveKeys';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../src/lib/sync/session';

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
    // A spy on this shared mocked function can retain an earlier test's
    // implementation. The real test IDB map must back vault provisioning.
    vi.mocked(idbKeyval.get).mockImplementation(async key => idbStore[String(key)]);
    vi.useRealTimers();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    lockAllVaults();
    localStorage.clear();
    invalidateSession();
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

  it('Flow 3: corrupted encrypted guest storage is read, rejected and preserved', async () => {
    localStorage.removeItem('logbook_authenticated_owner');
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'storage-integrity-guest');
    activateGuestSession('storage-integrity-guest');
    await prepareUnlockedTestArchive('guest');
    updateStorageMarker(1000, undefined, 'guest')!;

    const corruptBytes = 'corrupted string payload';
    await idbKeyval.set('logbook:v2:guest', corruptBytes);
    const getSpy = vi.spyOn(idbKeyval, 'get');

    await initApp();

    expect(getSpy.mock.calls.some(([key]) => key === 'logbook:v2:guest')).toBe(true);
    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(getStorageMarker(undefined, 'guest')?.timestamp).toBe(1000);
    expect(await idbKeyval.get('logbook:v2:guest')).toBe(corruptBytes);
  });

  it('Flow 3b: a cold guest boot rejects tampered authenticated ciphertext without replacing vault or data', async () => {
    localStorage.removeItem('logbook_authenticated_owner');
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'storage-integrity-guest');
    activateGuestSession('storage-integrity-guest');
    await prepareUnlockedTestArchive('guest');
    await initializeLocal('guest', UserDataSchema.parse({}));
    updateStorageMarker(1000, undefined, 'guest');

    const archiveKey = 'logbook:v2:guest';
    const original = await idbKeyval.get<string>(archiveKey);
    expect(original).toMatch(/^tlb-sealed:v1:/);
    const dot = original!.lastIndexOf('.');
    expect(dot).toBeGreaterThan(0);
    const payload = original![dot + 1];
    const tampered = original!.slice(0, dot + 1)
      + (payload === 'A' ? 'B' : 'A') + original!.slice(dot + 2);
    await idbKeyval.set(archiveKey, tampered);
    const control = localStorage.getItem(vaultControlKey('guest'));
    const wrappingKey = await idbKeyval.get(deviceVaultKeyId('guest'));

    lockVault('guest');
    expect(isVaultUnlocked('guest')).toBe(false);
    const getSpy = vi.spyOn(idbKeyval, 'get');

    await initApp();

    expect(isVaultUnlocked('guest')).toBe(true);
    expect(getSpy.mock.calls.some(([key]) => key === deviceVaultKeyId('guest'))).toBe(true);
    expect(getSpy.mock.calls.some(([key]) => key === archiveKey)).toBe(true);
    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(useAppStore.getState().userData).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(getStorageMarker(undefined, 'guest')?.timestamp).toBe(1000);
    expect(await idbKeyval.get(archiveKey)).toBe(tampered);
    expect(localStorage.getItem(vaultControlKey('guest'))).toBe(control);
    expect(await idbKeyval.get(deviceVaultKeyId('guest'))).toBe(wrappingKey);
  });

  it('blocks guest cold boot when an existing integrity marker is unreadable and the cache is absent', async () => {
    localStorage.removeItem('logbook_authenticated_owner');
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-marker-recovery');
    activateGuestSession('guest-marker-recovery');
    await prepareUnlockedTestArchive('guest');
    // Use the owner-scoped key computed by production, not the old global marker.
    const { getStorageMarkerKey } = await import('../src/lib/storageIntegrity');
    localStorage.setItem(getStorageMarkerKey('guest'), '{not-json');
    const original = localStorage.getItem(getStorageMarkerKey('guest'));
    const originalArchive = await idbKeyval.get('logbook:v2:guest');

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(localStorage.getItem(getStorageMarkerKey('guest'))).toBe(original);
    expect(await idbKeyval.get('logbook:v2:guest')).toBe(originalArchive);
    expect(createRoot).toHaveBeenCalledTimes(1);
  });

  it('Flow 4: First launch without a marker or cache remains empty', async () => {
    vi.spyOn(idbKeyval, 'get').mockResolvedValue(null);

    await initApp();

    expect(window.__INITIAL_USER_DATA__).toBeNull();
    expect(getStorageMarker()).toBeNull();
  });


});
