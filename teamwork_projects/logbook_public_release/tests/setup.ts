import { vi, beforeEach } from 'vitest';

// Mock localStorage if not present
const mockStorage: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
  key: (index: number) => Object.keys(mockStorage)[index] || null,
  length: 0,
};

Object.defineProperty(localStorageMock, 'length', {
  get: () => Object.keys(mockStorage).length,
});

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});
