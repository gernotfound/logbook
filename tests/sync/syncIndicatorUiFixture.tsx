import { vi, type Mock } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders, defaultMockUserData, type RenderOptions } from '../setup';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { useAppStore } from '../../src/store/useAppStore';
import { clearSyncTimers } from '../../src/store/slices/createSyncSlice';
import { DB } from '../../src/lib/db';
import App from '../../src/App';
import ReloadPrompt from '../../src/components/UI/ReloadPrompt';

type ReloadBoundaryMocks = { requiredUpdateHardReload: Mock; safeHardReload: Mock };

export async function setupSyncUiTest(reloadMocks: ReloadBoundaryMocks) {
  await prepareUnlockedTestArchive();
  vi.useFakeTimers();
  clearSyncTimers();
  vi.mocked(DB.saveUserData).mockReset();
  vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
  for (const mock of [reloadMocks.requiredUpdateHardReload, reloadMocks.safeHardReload]) {
    mock.mockReset();
    mock.mockResolvedValue(undefined);
  }
  useAppStore.setState({
    userData: { ...defaultMockUserData },
    localWorkout: null,
    syncing: false,
    syncHealth: 'synced',
    syncPresentation: 'normal',
    saveError: null,
  });
  vi.clearAllMocks();
}

export function teardownSyncUiTest() {
  act(() => {
    clearSyncTimers();
    useAppStore.getState().resetStore();
  });
  vi.mocked(DB.saveUserData).mockReset();
  vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
  vi.useRealTimers();
  vi.restoreAllMocks();
}

export async function renderSettledApp(options: RenderOptions = {}) {
  const result = renderWithProviders(<><ReloadPrompt /><App /></>, options);
  await act(async () => { await Promise.resolve(); });
  return result;
}

export function querySyncErrorToast(container: HTMLElement) {
  return container.querySelector('.sync-error-toast') || document.querySelector('.sync-error-toast');
}

export function querySyncIndicator(container: HTMLElement) {
  return container.querySelector('.sync-indicator') || document.querySelector('.sync-indicator');
}
