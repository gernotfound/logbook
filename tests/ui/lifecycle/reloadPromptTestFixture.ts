import type React from 'react';
import { vi } from 'vitest';
import { localStorageMock } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import * as pwaUpdateModule from '../../../src/lib/pwaUpdate';

// Live bindings retain the per-test mock identities consumed by the SW adapter.
export let mockSetNeedRefresh = vi.fn<(value: React.SetStateAction<boolean>) => void>();
export let mockUpdateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>();
const originalStorageGetItem = localStorageMock.getItem.getMockImplementation()!;
let serviceWorkerDescriptor: PropertyDescriptor | undefined;
let visibilityStateDescriptor: PropertyDescriptor | undefined;

export function setupReloadPromptTest() {
  serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  visibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  localStorageMock.getItem.mockImplementation(originalStorageGetItem);
  useAppStore.getState().resetStore();
  mockSetNeedRefresh = vi.fn<(value: React.SetStateAction<boolean>) => void>();
  mockUpdateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue(undefined);
  vi.clearAllMocks();
  vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockResolvedValue(undefined);
}

export function teardownReloadPromptTest() {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Restore the original descriptors, including an absent own property, so
  // one test's browser API overrides cannot change the next test's environment.
  if (serviceWorkerDescriptor) Object.defineProperty(navigator, 'serviceWorker', serviceWorkerDescriptor);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
  if (visibilityStateDescriptor) Object.defineProperty(document, 'visibilityState', visibilityStateDescriptor);
  else Reflect.deleteProperty(document, 'visibilityState');
}
