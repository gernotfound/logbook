import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_MARKER_VERSION, StorageMarkerReadError, getStorageMarker, getStorageMarkerKey,
  updateStorageMarker, clearStorageMarker, diagnoseStorageState,
} from '../../src/lib/storageIntegrity';

describe('Owner-scoped storage integrity markers', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('creates, updates and clears a marker only for its owner', () => {
    expect(getStorageMarker(undefined, 'user:a')).toBeNull();
    expect(updateStorageMarker(1000, undefined, 'user:a')).toEqual({
      version: STORAGE_MARKER_VERSION, timestamp: 1000, schemaVersion: 1,
    });
    updateStorageMarker(2000, undefined, 'user:b');
    updateStorageMarker(3000, undefined, 'user:a');
    expect(getStorageMarker(undefined, 'user:a')?.timestamp).toBe(3000);
    expect(getStorageMarker(undefined, 'user:b')?.timestamp).toBe(2000);
    clearStorageMarker(undefined, 'user:a');
    expect(getStorageMarker(undefined, 'user:a')).toBeNull();
    expect(getStorageMarker(undefined, 'user:b')?.timestamp).toBe(2000);
  });

  it('rejects malformed markers and ignores global prelaunch keys', () => {
    const key = getStorageMarkerKey('user:a');
    localStorage.setItem(key, '{broken');
    expect(() => getStorageMarker(undefined, 'user:a')).toThrow(StorageMarkerReadError);
    localStorage.setItem(key, JSON.stringify({ version: '1', timestamp: 1 }));
    expect(() => getStorageMarker(undefined, 'user:a')).toThrow(StorageMarkerReadError);
    localStorage.setItem('logbook_storage_marker', JSON.stringify({ version: 1, timestamp: 5 }));
    clearStorageMarker(undefined, 'user:a');
    expect(localStorage.getItem('logbook_storage_marker')).not.toBeNull();
  });

  it('does not treat unavailable browser storage as an existing marker', () => {
    const unavailable = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
      removeItem: vi.fn(() => { throw new Error('blocked'); }),
    } as unknown as Storage;
    expect(() => getStorageMarker(unavailable)).toThrow(StorageMarkerReadError);
    expect(updateStorageMarker(1, unavailable)).toBeNull();
    expect(() => clearStorageMarker(unavailable)).not.toThrow();
  });

  it('never mistakes an empty or incompatible present marker for a first-run guest', () => {
    const key = getStorageMarkerKey('guest');
    for (const raw of ['', 'null', '{}', JSON.stringify({ version: 1, timestamp: 1, schemaVersion: 2 })]) {
      localStorage.setItem(key, raw);
      expect(() => getStorageMarker(undefined, 'guest')).toThrow(StorageMarkerReadError);
      expect(localStorage.getItem(key)).toBe(raw);
    }
    localStorage.removeItem(key);
    expect(getStorageMarker(undefined, 'guest')).toBeNull();
  });

  it('distinguishes missing, empty guest, unreadable and invalid snapshots', () => {
    const marker = { version: 1, timestamp: 1000 };
    expect(diagnoseStorageState({ cachedData: null, readError: new Error('IDB blocked'), marker })).toBe('read_error');
    expect(diagnoseStorageState({ cachedData: null, marker })).toBe('missing');
    expect(diagnoseStorageState({ cachedData: undefined, marker, isGuest: true })).toBe('missing');
    expect(diagnoseStorageState({ cachedData: null, marker: null, isGuest: true })).toBe('empty_guest');
    expect(diagnoseStorageState({ cachedData: null, marker: null })).toBe('missing');
    expect(diagnoseStorageState({ cachedData: '{bad', marker })).toBe('invalid');
    expect(diagnoseStorageState({ cachedData: [1, 2], marker })).toBe('invalid');
    expect(diagnoseStorageState({ cachedData: 123, marker })).toBe('invalid');
  });

  it('recognizes valid business structures without changing them', () => {
    const data = { profile: { name: 'Synthetic' }, library: [], routines: [], history: [], nutrition: {}, customFoods: [] };
    expect(diagnoseStorageState({ cachedData: data, marker: null })).toBe('valid');
    expect(diagnoseStorageState({ cachedData: JSON.stringify(data), marker: null })).toBe('valid');
  });
});
