import type React from 'react';
import { vi } from 'vitest';
import { localStorageMock } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import * as pwaUpdateModule from '../../../src/lib/pwaUpdate';

// Live bindings retain the per-test mock identities consumed by the SW adapter.
export let mockSetNeedRefresh = vi.fn<(value: React.SetStateAction<boolean>) => void>();
export let mockUpdateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>();
const originalServiceWorker = navigator.serviceWorker;
const originalStorageGetItem = localStorageMock.getItem.getMockImplementation()!;

export function setupReloadPromptTest() {
  localStorageMock.getItem.mockImplementation(originalStorageGetItem);
  useAppStore.getState().resetStore();
  mockSetNeedRefresh = vi.fn<(value: React.SetStateAction<boolean>) => void>();
  mockUpdateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue(undefined);
  vi.clearAllMocks();
  vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockResolvedValue(undefined);
}

export function teardownReloadPromptTest() {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'serviceWorker', {
    value: originalServiceWorker,
    writable: true,
    configurable: true,
  });
}
