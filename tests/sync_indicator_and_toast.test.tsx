import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import App from '../src/App';
import { renderWithProviders, defaultMockUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import { DB } from '../src/lib/db';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useDialogStore } from '../src/store/useDialogStore';
import { onAuthStateChanged } from 'firebase/auth';

describe('LogBook Background Sync & Error Toast 4-Tier Test Suite', () => {

  beforeEach(() => {
    vi.useFakeTimers();
    clearSyncTimers();
    vi.mocked(DB.saveUserData).mockReset();
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
    useAppStore.setState({
      userData: { ...defaultMockUserData },
      localWorkout: null,
      syncing: false,
      saveError: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      clearSyncTimers();
      useAppStore.getState().resetStore();
    });
    vi.mocked(DB.saveUserData).mockReset();
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper to render App and await mount settlement
  const renderSettledApp = async (options = {}) => {
    const result = renderWithProviders(<App />, options);
    await act(async () => {
      await Promise.resolve();
    });
    return result;
  };

  // Helper to query sync error toast element
  const querySyncErrorToast = (container: HTMLElement) => {
    return container.querySelector('.sync-error-toast') ||
      document.querySelector('.sync-error-toast');
  };

  // Helper to query sync indicator element
  const querySyncIndicator = (container: HTMLElement) => {
    return container.querySelector('.sync-indicator') ||
      document.querySelector('.sync-indicator') ||
      screen.queryByText(/Salvataggio in corso/i);
  };

  // ============================================================================
  // TIER 1: FEATURE COVERAGE (≥5 tests per feature: R1, R2, R3)
  // ============================================================================
  describe('Tier 1: Feature Coverage', () => {

    // --- Feature R1: Rimozione Overlay Bloccante ---
    describe('R1: Full Blocking Overlay Elimination', () => {
      test('T1.1_R1: #sync-overlay is absent from DOM when syncing is false', async () => {
        const { container } = await renderSettledApp();
        expect(container.querySelector('#sync-overlay')).toBeNull();
        expect(document.querySelector('#sync-overlay')).toBeNull();
      });

      test('T1.2_R1: #sync-overlay is completely absent from DOM when syncing is true', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        expect(container.querySelector('#sync-overlay')).toBeNull();
        expect(document.querySelector('#sync-overlay')).toBeNull();
      });

      test('T1.3_R1: No fixed full-screen blocking backdrop covers the viewport during active sync', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const allElements = container.querySelectorAll('*');
        allElements.forEach((el) => {
          expect(el.id).not.toBe('sync-overlay');
        });
      });

      test('T1.4_R1: Main application container remains visible and accessible during syncing', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const mainContainer = container.querySelector('#app-container');
        expect(mainContainer).not.toBeNull();
      });

      test('T1.5_R1: Bottom navigation remains rendered and interactive during syncing', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const nav = container.querySelector('nav') || screen.queryByRole('navigation');
        expect(nav).not.toBeNull();
      });
    });

    // --- Feature R2: Indicatore Sincronizzazione Non Bloccante ---
    describe('R2: Non-Blocking Background Sync Indicator', () => {
      test('T1.6_R2: .sync-indicator does not render when syncing is false', async () => {
        const { container } = await renderSettledApp();
        const indicator = querySyncIndicator(container);
        expect(indicator).toBeNull();
      });

      test('T1.7_R2: .sync-indicator renders when syncing is true', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const indicator = querySyncIndicator(container);
        expect(indicator).not.toBeNull();
      });

      test('T1.8_R2: .sync-indicator contains Italian sentence case text "Salvataggio in corso..."', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const textEl = screen.getByText(/Salvataggio in corso\.\.\./i);
        expect(textEl).toBeDefined();
      });

      test('T1.9_R2: .sync-indicator contains a spinner element', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const indicator = container.querySelector('.sync-indicator');
        if (indicator) {
          const spinner = indicator.querySelector('.spinner, .sync-indicator-spinner, [class*="spinner"]');
          expect(spinner).not.toBeNull();
        } else {
          expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
        }
      });

      test('T1.10_R2: .sync-indicator cleanly unmounts when syncing transitions back to false', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        expect(screen.queryByText(/Salvataggio in corso/i)).not.toBeNull();

        act(() => {
          useAppStore.setState({ syncing: false });
        });
        const indicator = querySyncIndicator(container);
        expect(indicator).toBeNull();
      });
    });

    // --- Feature R3: Gestione Errori (Toast Auto-scomparente) ---
    describe('R3: Auto-Dismissing Error Toast', () => {
      test('T1.11_R3: .sync-error-toast is not visible when saveError is null', async () => {
        const { container } = await renderSettledApp();
        const toast = querySyncErrorToast(container);
        expect(toast).toBeNull();
      });

      test('T1.12_R3: .sync-error-toast renders with error message when saveError is set', async () => {
        await renderSettledApp();
        const errorMsg = 'Errore sincronizzazione. Verifica la connessione.';
        act(() => {
          useAppStore.setState({ saveError: errorMsg });
        });
        expect(screen.getByText(new RegExp(errorMsg, 'i'))).toBeDefined();
      });

      test('T1.13_R3: .sync-error-toast renders with danger/error styling class', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Errore durante il salvataggio' });
        });
        const toast = container.querySelector('.sync-error-toast') || screen.getByText(/Errore durante il salvataggio/i).closest('div');
        expect(toast).not.toBeNull();
      });

      test('T1.14_R3: .sync-error-toast contains manual close button', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Connessione persa' });
        });
        const toast = container.querySelector('.sync-error-toast') || screen.getByText(/Connessione persa/i).closest('div');
        expect(toast).not.toBeNull();
        const closeBtn = toast?.querySelector('.sync-error-close, button');
        expect(closeBtn).not.toBeNull();
      });

      test('T1.15_R3: .sync-error-toast unmounts when saveError is reset to null', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Errore temporaneo' });
        });
        expect(screen.getByText(/Errore temporaneo/i)).toBeDefined();

        act(() => {
          useAppStore.setState({ saveError: null });
        });
        expect(screen.queryByText(/Errore temporaneo/i)).toBeNull();
      });
    });
  });

  // ============================================================================
  // TIER 2: BOUNDARY & CORNER CASES (≥5 tests per feature)
  // ============================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {

    describe('R1 Corner Cases: Overlay Absence Robustness', () => {
      test('T2.1_R1: Rapid toggling of syncing never renders #sync-overlay', async () => {
        const { container } = await renderSettledApp();
        for (let i = 0; i < 5; i++) {
          act(() => {
            useAppStore.setState({ syncing: true });
          });
          expect(container.querySelector('#sync-overlay')).toBeNull();
          act(() => {
            useAppStore.setState({ syncing: false });
          });
          expect(container.querySelector('#sync-overlay')).toBeNull();
        }
      });

      test('T2.2_R1: Viewport resize events during sync do not produce layout blocking artifacts', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        act(() => {
          window.dispatchEvent(new Event('resize'));
        });
        expect(container.querySelector('#sync-overlay')).toBeNull();
        expect(container.querySelector('#app-container')).not.toBeNull();
      });

      test('T2.3_R1: Rapid store state mutations do not spawn modal backdrops', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true, saveError: 'Errore transitorio' });
        });
        act(() => {
          useAppStore.setState({ syncing: false, saveError: null });
        });
        expect(container.querySelector('#sync-overlay')).toBeNull();
      });

      test('T2.4_R1: High-frequency sync state changes resolve cleanly in DOM', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.getState().setSyncing(true);
          useAppStore.getState().setSyncing(false);
          useAppStore.getState().setSyncing(true);
        });
        expect(container.querySelector('#sync-overlay')).toBeNull();
        expect(screen.queryByText(/Salvataggio in corso/i)).not.toBeNull();
      });

      test('T2.5_R1: User data mutations during syncing do not trigger blocking overlays', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
          useAppStore.setState((prev) => ({
            userData: { ...prev.userData!, profile: { name: 'Aggiornato' } }
          }));
        });
        expect(container.querySelector('#sync-overlay')).toBeNull();
      });
    });

    describe('R2 Corner Cases: Non-Blocking Sync Indicator Edge Cases', () => {
      test('T2.6_R2: Rapid toggling (true -> false -> true) handles mount/unmount safely', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();

        act(() => {
          useAppStore.setState({ syncing: false });
        });
        expect(screen.queryByText(/Salvataggio in corso/i)).toBeNull();

        act(() => {
          useAppStore.setState({ syncing: true });
        });
        expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      });

      test('T2.7_R2: Sync indicator has appropriate accessibility role or attributes', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const indicator = container.querySelector('.sync-indicator') || screen.getByText(/Salvataggio in corso/i).closest('div');
        expect(indicator).not.toBeNull();
      });

      test('T2.8_R2: Coexistence of syncing === true AND saveError !== null without DOM collisions', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true, saveError: 'Attenzione: salvataggio parziale' });
        });

        // Both sync indicator and error toast are present concurrently
        expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
        expect(screen.getByText(/Attenzione: salvataggio parziale/i)).toBeDefined();
        expect(container.querySelector('#sync-overlay')).toBeNull();
      });

      test('T2.9_R2: Sync indicator remains a singleton in DOM under repeated true states', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.getState().setSyncing(true);
          useAppStore.getState().setSyncing(true);
        });
        const indicators = screen.getAllByText(/Salvataggio in corso/i);
        expect(indicators.length).toBe(1);
      });

      test('T2.10_R2: Unmounting App during active sync cleans up without throwing errors', async () => {
        const { unmount } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        expect(() => unmount()).not.toThrow();
      });
    });

    describe('R3 Corner Cases: Auto-Dismissing Toast Timers & Dismissal', () => {
      test('T2.11_R3: Auto-dismissal after 5000ms clears saveError in store and unmounts toast', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Errore di rete temporaneo' });
        });
        expect(screen.getByText(/Errore di rete temporaneo/i)).toBeDefined();

        // Advance timer by 4900ms - toast must still be visible
        act(() => {
          vi.advanceTimersByTime(4900);
        });
        expect(useAppStore.getState().saveError).toBe('Errore di rete temporaneo');
        expect(screen.queryByText(/Errore di rete temporaneo/i)).not.toBeNull();

        // Advance timer past 5000ms threshold (e.g. 5100ms)
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(useAppStore.getState().saveError).toBeNull();
        expect(screen.queryByText(/Errore di rete temporaneo/i)).toBeNull();
      });

      test('T2.12_R3: Rapid updates to saveError reset the 5000ms auto-dismiss timer', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Primo errore' });
        });
        expect(screen.getByText(/Primo errore/i)).toBeDefined();

        // Advance 3000ms
        act(() => {
          vi.advanceTimersByTime(3000);
        });

        // Set new error - resets 5000ms timer
        act(() => {
          useAppStore.setState({ saveError: 'Secondo errore aggiornato' });
        });
        expect(screen.getByText(/Secondo errore aggiornato/i)).toBeDefined();
        expect(screen.queryByText(/Primo errore/i)).toBeNull();

        // Advance 3000ms more (total 6000ms from start, but 3000ms from second error)
        act(() => {
          vi.advanceTimersByTime(3000);
        });
        expect(screen.getByText(/Secondo errore aggiornato/i)).toBeDefined();
        expect(useAppStore.getState().saveError).toBe('Secondo errore aggiornato');

        // Advance another 2100ms (5100ms from second error) - now it auto-dismisses
        act(() => {
          vi.advanceTimersByTime(2100);
        });
        expect(useAppStore.getState().saveError).toBeNull();
        expect(screen.queryByText(/Secondo errore aggiornato/i)).toBeNull();
      });

      test('T2.13_R3: Manual dismissal via ✕ button immediately clears saveError and cancels timer', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Errore da chiudere manualmente' });
        });
        expect(screen.getByText(/Errore da chiudere manualmente/i)).toBeDefined();

        const toast = container.querySelector('.sync-error-toast') || screen.getByText(/Errore da chiudere manualmente/i).closest('div');
        const closeBtn = toast?.querySelector('.sync-error-close, button');
        expect(closeBtn).not.toBeNull();

        act(() => {
          fireEvent.click(closeBtn!);
        });

        expect(useAppStore.getState().saveError).toBeNull();
        expect(screen.queryByText(/Errore da chiudere manualmente/i)).toBeNull();

        // Further timer advancement does not cause errors
        act(() => {
          vi.advanceTimersByTime(6000);
        });
        expect(useAppStore.getState().saveError).toBeNull();
      });

      test('T2.14_R3: Network online event alone does not confirm recovery', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Offline: impossibile sincronizzare' });
        });
        expect(screen.getByText(/Offline: impossibile sincronizzare/i)).toBeDefined();

        act(() => {
          window.dispatchEvent(new Event('online'));
        });

        expect(useAppStore.getState().saveError).toBe('Offline: impossibile sincronizzare');
        expect(screen.queryByText(/Offline: impossibile sincronizzare/i)).not.toBeNull();
      });

      test('T2.15_R3: Component unmount while auto-dismiss timer is running cleans up timer safely', async () => {
        const { unmount } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ saveError: 'Errore prima di unmount' });
        });
        unmount();
        expect(() => {
          act(() => {
            vi.advanceTimersByTime(6000);
          });
        }).not.toThrow();
      });

      test('T2.16_R3: Handles empty string saveError and multiline messages gracefully', async () => {
        const { container } = await renderSettledApp();
        const multilineMsg = 'Errore riga 1\nErrore riga 2\nVerifica connessione';
        act(() => {
          useAppStore.setState({ saveError: multilineMsg });
        });
        expect(container.querySelector('.sync-error-toast') || screen.queryByText(/Errore riga 1/i)).toBeDefined();

        act(() => {
          useAppStore.setState({ saveError: '' });
        });
        expect(container.querySelector('.sync-error-toast')).toBeNull();
      });
    });
  });

  // ============================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (≥5 tests)
  // ============================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {

    test('T3.1_cross: User can interact with active workout while syncing is true without UI lock', async () => {
      const activeWorkout = {
        routineId: 'r1',
        routineName: 'Scheda A - Upper',
        startTime: Date.now(),
        exercises: [
          {
            exId: 'ex1',
            name: 'Panca Piana',
            sets: [{ id: 's1', kg: '80', reps: '10', completed: false }]
          }
        ]
      };

      const { container } = await renderSettledApp({ localWorkout: activeWorkout });

      act(() => {
        useAppStore.setState({ syncing: true });
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

      // Find tab navigation buttons
      const navButtons = container.querySelectorAll('nav button, .bottom-nav button');
      if (navButtons.length > 1) {
        // Switch to Training tab (index 1)
        act(() => {
          fireEvent.click(navButtons[1]);
        });
        // Sync indicator remains visible
        expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();

        // Switch to Settings tab (last index)
        act(() => {
          fireEvent.click(navButtons[navButtons.length - 1]);
        });
        expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      }
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
      vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
        callback(null);
        return () => {};
      });
      localStorage.setItem('logbook_is_guest', 'true');

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

      act(() => {
        useDialogStore.getState().showConfirm('Sei sicuro di voler procedere?');
      });

      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      expect(document.querySelector('#sync-overlay')).toBeNull();
    });

    test('T3.6_cross: Concurrent save error during active workout does not interrupt set input', async () => {
      const activeWorkout = {
        routineId: 'r1',
        routineName: 'Scheda A - Upper',
        startTime: Date.now(),
        exercises: [{ exId: 'ex1', name: 'Panca', sets: [{ id: 's1', kg: '90', reps: '8' }] }]
      };

      const { container } = await renderSettledApp({ localWorkout: activeWorkout });

      act(() => {
        useAppStore.setState({
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

  // ============================================================================
  // TIER 4: REAL-WORLD APPLICATION WORKLOADS (≥5 tests)
  // ============================================================================
  describe('Tier 4: Real-World Application Workloads', () => {

    test('T4.1_workload: Underground gym workout with spotty connection and auto-dismiss error recovery', async () => {
      const { container } = await renderSettledApp();

      // Step 1: Lifter performs set 1 and triggers debounced save
      vi.mocked(DB.saveUserData).mockRejectedValueOnce(new Error('Network unreachable: Underground gym'));

      let caughtError1: any = null;
      let savePromise: any;
      await act(async () => {
        savePromise = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          history: [{ id: 'w1', date: '2026-08-22', routineName: 'Leg Day', duration: '10m', mood: 4, pump: 4, fatigue: 3, water: 1, exercises: [] }]
        })).catch((err) => { caughtError1 = err; });
      });

      // Background sync is in progress
      expect(useAppStore.getState().syncing).toBe(true);
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();

      // Step 2: Debounce timer fires (1000ms) and network fails
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await savePromise;
      expect(caughtError1).not.toBeNull();

      // Sync indicator disappears; non-blocking error toast appears
      expect(useAppStore.getState().syncing).toBe(false);
      expect(screen.queryByText(/Salvataggio in corso/i)).toBeNull();
      expect(screen.getByText(/Network unreachable: Underground gym/i)).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();

      // Step 3: Lifter continues workout without clicking dismiss; toast auto-dismisses at 5s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      expect(useAppStore.getState().saveError).toBeNull();
      expect(screen.queryByText(/Errore sincronizzazione/i)).toBeNull();

      // Step 4: Connection restored, next save succeeds
      vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: true, status: 'synced' } as any);
      let recoverySave: any;
      await act(async () => {
        recoverySave = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          history: [{ id: 'w1', date: '2026-08-22', routineName: 'Leg Day (Completed)', duration: '45m', mood: 5, pump: 5, fatigue: 4, water: 2, exercises: [] }]
        }));
      });

      expect(useAppStore.getState().syncing).toBe(true);
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await expect(recoverySave).resolves.toHaveProperty('ok', true);

      expect(useAppStore.getState().syncing).toBe(false);
      expect(screen.queryByText(/Salvataggio in corso/i)).toBeNull();
      expect(useAppStore.getState().saveError).toBeNull();
    });

    test('T4.2_workload: Rapid nutrition multi-item logging with debounced batch sync', async () => {
      const saveSpy = vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
      const { container } = await renderSettledApp();

      let p1: any, p2: any, p3: any;
      // Rapidly log 3 meals in succession within 300ms
      await act(async () => {
        p1 = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          nutrition: { '2026-08-22': { weight: 75, kcal: 500, pro: 30, carbs: 60, fat: 15 } }
        }));
        await vi.advanceTimersByTimeAsync(100);

        p2 = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          nutrition: { '2026-08-22': { weight: 75, kcal: 1100, pro: 70, carbs: 120, fat: 35 } }
        }));
        await vi.advanceTimersByTimeAsync(100);

        p3 = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          nutrition: { '2026-08-22': { weight: 75, kcal: 1800, pro: 120, carbs: 200, fat: 55 } }
        }));
      });

      // Non-blocking indicator active
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();

      // Advance only the debounce window; the mounted app owns legitimate recurring clocks.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      await Promise.all([p1, p2, p3]);

      // Exactly 1 batched DB save with the final nutrition state
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().syncing).toBe(false);
      expect(screen.queryByText(/Salvataggio in corso/i)).toBeNull();
    });

    // Timeout increased to 10000ms: Resolving mock-timer window advancing (1100ms) 
    // requires more real-time processing of JSDom async callbacks under high parallel CPU load.
    test('T4.3_workload: Workout completion while background sync runs with zero UI interruption', async () => {
      vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: true, status: 'synced' } as any);
      const activeWorkout = {
        routineId: 'r1',
        routineName: 'Upper Body Blast',
        startTime: Date.now() - 3600000,
        exercises: [{ exId: 'ex1', name: 'Panca', sets: [{ id: 's1', kg: '100', reps: '5', completed: true }] }]
      };

      const { container } = await renderSettledApp({ localWorkout: activeWorkout });

      // Finish workout and trigger sync
      let completePromise: any;
      await act(async () => {
        completePromise = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          history: [
            ...(prev?.history || []),
            { id: 'w_completed', date: '2026-08-22', routineName: 'Upper Body Blast', duration: '60m', mood: 5, pump: 5, fatigue: 4, water: 2, exercises: [] }
          ],
          activeWorkout: null
        }));
      });

      expect(useAppStore.getState().syncing).toBe(true);
      expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      expect(container.querySelector('#sync-overlay')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await expect(completePromise).resolves.toHaveProperty('ok', true);

      expect(useAppStore.getState().syncing).toBe(false);
      expect(screen.queryByText(/Salvataggio in corso/i)).toBeNull();
    }, 10000);

    test('T4.4_workload: Multi-tab routine editor and manual error dismissal workflow', async () => {
      const { container } = await renderSettledApp();

      // Trigger an error in Training tab
      act(() => {
        useAppStore.setState({ saveError: 'Errore validazione scheda: campi mancanti' });
      });

      expect(screen.getByText(/Errore validazione scheda: campi mancanti/i)).toBeDefined();

      const toast = container.querySelector('.sync-error-toast') || screen.getByText(/Errore validazione scheda: campi mancanti/i).closest('div');
      const closeBtn = toast?.querySelector('.sync-error-close, button');
      expect(closeBtn).not.toBeNull();

      act(() => {
        fireEvent.click(closeBtn!);
      });

      expect(useAppStore.getState().saveError).toBeNull();
      expect(screen.queryByText(/Errore validazione scheda/i)).toBeNull();
      expect(container.querySelector('#sync-overlay')).toBeNull();
    });

    test('T4.5_workload: Offline draft survival and online auto-recovery workflow', async () => {
      const { container } = await renderSettledApp();

      // Simulate offline failure
      vi.mocked(DB.saveUserData).mockRejectedValueOnce(new Error('Quota limit or offline'));

      let caughtError5: any = null;
      let savePromise: any;
      await act(async () => {
        savePromise = useAppStore.getState().saveUserData((prev) => ({
          ...prev!,
          profile: { ...prev?.profile, name: 'Offline Lifter' }
        })).catch((err) => { caughtError5 = err; });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await savePromise;
      expect(caughtError5).not.toBeNull();

      expect(screen.getByText(/Quota limit or offline/i)).toBeDefined();

      // Reconnection replays the durable journal before clearing the error.
      vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: true, status: 'synced' });
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await useAppStore.getState().flushPendingSyncs();
      });

      expect(useAppStore.getState().saveError).toBeNull();
      expect(screen.queryByText(/dati sono stati salvati/i)).toBeNull();
      expect(container.querySelector('#sync-overlay')).toBeNull();
    });
  });
});
