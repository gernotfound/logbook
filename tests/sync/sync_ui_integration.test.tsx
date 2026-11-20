import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { screen, fireEvent, act, within } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import { useRegisterSW } from '../../src/lib/pwaRegistration';
import { useDialogStore } from '../../src/store/useDialogStore';
import { onAuthStateChanged } from 'firebase/auth';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../src/lib/sync/session';
import { renderSettledApp, setupSyncUiTest, teardownSyncUiTest } from './syncIndicatorUiFixture';

// Each spec hoists its own external-boundary mocks before fixture module initialization.
const reloadMocks = vi.hoisted(() => ({
  requiredUpdateHardReload: vi.fn(),
  safeHardReload: vi.fn(),
}));
vi.mock('../../src/lib/sync/safeReload', () => reloadMocks);

describe('Sync UI — integration', () => {
  beforeEach(() => setupSyncUiTest(reloadMocks));
  afterEach(teardownSyncUiTest);

  describe('Tier 3: Cross-Feature Combinations', () => {

    test('T3.1_cross: Active workout state remains available while syncing without UI lock', async () => {
      const activeWorkout = {
        routineId: 'r1',
        routineName: 'Scheda A - Upper',
        startTime: Date.now(),
        exercises: [
          {
            exId: 'ex1',
            name: 'Panca Piana', sessionNote: '',
            sets: [{ id: 's1', kg: '80', reps: '10', completed: false }]
          }
        ]
      };

      const { container } = await renderSettledApp();

      // This is a presentation test: apply the visible workout after auth
      // hydration, rather than racing it with the AuthProvider bootstrap.
      act(() => {
        useAppStore.setState({ localWorkout: activeWorkout, syncing: true });
      });

      // UI is not blocked by sync overlay
      expect(container.querySelector('#sync-overlay')).toBeNull();
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();

      // Workout data in store remains intact and active
      const state = useAppStore.getState();
      expect(state.localWorkout).toEqual(activeWorkout);
      expect(state.syncing).toBe(true);
    });

    test('T3.2_cross: Tab navigation works instantly and preserves .sync-indicator across tab switches', async () => {
      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({ syncing: true });
      });

      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();

      const navigation = screen.getByRole('navigation', { name: 'Navigazione principale' });
      const training = within(navigation).getByRole('button', { name: 'Allenamento' });
      const data = within(navigation).getByRole('button', { name: 'Dati e statistiche' });
      act(() => { fireEvent.click(training); });
      expect(training.getAttribute('aria-current')).toBe('page');
      expect(screen.getByRole('status', { name: 'Salvataggio in corso' })).toBeDefined();

      act(() => { fireEvent.click(data); });
      expect(data.getAttribute('aria-current')).toBe('page');
      expect(training.getAttribute('aria-current')).toBeNull();
      expect(screen.getByRole('status', { name: 'Salvataggio in corso' })).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();
    });

    test('T3.3_cross: PWA ReloadPrompt banner and background sync indicator coexist seamlessly', async () => {
      vi.mocked(useRegisterSW).mockReturnValue({
        needRefresh: [true, vi.fn()],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: vi.fn(),
      });

      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({ syncing: true });
      });

      // Both ReloadPrompt and SyncIndicator are rendered simultaneously
      expect(screen.getByText(/Nuova versione disponibile/i)).toBeDefined();
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();
    });

    test('T3.4_cross: Guest mode banner, sync indicator, and error toast stack cleanly', async () => {
      // Mock unauthenticated auth state to keep isGuest active
      vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth: any, callback: any) => {
        _auth.currentUser = null;
        callback(null);
        return () => {};
      });
      localStorage.setItem('logbook_is_guest', 'true');
      localStorage.setItem(GUEST_SESSION_KEY, 'sync-indicator-guest-generation');
      activateGuestSession('sync-indicator-guest-generation');

      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({
          syncing: true,
          saveError: 'Salvataggio locale: memoria quasi piena'
        });
      });

      // Guest banner at top (using getAllByText to avoid multiple matches from SettingsView)
      expect(screen.getAllByText(/Modalità locale/i).length).toBeGreaterThan(0);
      // Sync indicator at bottom-right
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      // Error toast
      expect(screen.getByText(/Salvataggio locale: memoria quasi piena/i)).toBeDefined();

      expect(container.querySelector('#sync-overlay')).toBeNull();
      localStorage.removeItem('logbook_is_guest');
    });

    test('T3.5_cross: GlobalDialog modal and background sync operate independently', async () => {
      await renderSettledApp();

      act(() => {
        useAppStore.setState({ syncing: true });
      });

      await act(async () => {
        await useDialogStore.getState().showConfirm('Sei sicuro di voler procedere?');
      });

      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      expect(document.querySelector('#sync-overlay')).toBeNull();
    });

    test('T3.6_cross: Concurrent save error does not discard active workout state', async () => {
      const activeWorkout = {
        routineId: 'r1',
        routineName: 'Scheda A - Upper',
        startTime: Date.now(),
        exercises: [{ exId: 'ex1', name: 'Panca', sessionNote: '', sets: [{ id: 's1', kg: '90', reps: '8' }] }]
      };

      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({
          localWorkout: activeWorkout,
          syncing: false,
          saveError: 'Timeout connessione Firestore'
        });
      });

      expect(screen.getByText(/Timeout connessione Firestore/i)).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();

      // Auto-dismisses at 5000ms while workout remains intact
      act(() => {
        vi.advanceTimersByTime(5100);
      });

      expect(screen.queryByText(/Timeout connessione Firestore/i)).toBeNull();
      expect(useAppStore.getState().localWorkout).toEqual(activeWorkout);
    });
  });
});
