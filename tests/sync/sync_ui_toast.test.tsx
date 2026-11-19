import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import { renderSettledApp, querySyncErrorToast, setupSyncUiTest, teardownSyncUiTest } from './syncIndicatorUiFixture';

// Each spec hoists its own external-boundary mocks before fixture module initialization.
const reloadMocks = vi.hoisted(() => ({
  requiredUpdateHardReload: vi.fn(),
  safeHardReload: vi.fn(),
}));
vi.mock('../../src/lib/sync/safeReload', () => reloadMocks);

describe('Sync UI — toast', () => {
  beforeEach(() => setupSyncUiTest(reloadMocks));
  afterEach(teardownSyncUiTest);

    describe('R3: Auto-Dismissing Error Toast', () => {
      test('T1.11-T1.15_R3: transient error alert mounts, can be dismissed, and unmounts', async () => {
        const { container } = await renderSettledApp();
        expect(querySyncErrorToast(container)).toBeNull();

        const errorMsg = 'Errore sincronizzazione. Verifica la connessione.';
        act(() => {
          useAppStore.setState({ saveError: errorMsg });
        });
        const toast = container.querySelector('.sync-error-toast');
        expect(toast).not.toBeNull();
        expect(screen.getByRole('alert')).toBe(toast);
        expect(toast?.querySelector('.sync-error-text')?.textContent).toBe(errorMsg);
        expect(toast?.querySelector('.sync-error-close')).not.toBeNull();

        act(() => {
          useAppStore.setState({ saveError: null });
        });
        expect(querySyncErrorToast(container)).toBeNull();
      });

      test('T1.11a_R3: durable offline workout pending state does not distract during set entry', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({
            syncing: false,
            syncHealth: 'local-pending',
            syncPresentation: 'quiet-workout',
            saveError: 'Salvato localmente. Sincronizzazione in attesa.',
          });
        });
        expect(querySyncErrorToast(container)).toBeNull();
      });

      test('T1.11b_R3: rejected workout writes still surface even in quiet mode', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({
            syncing: false,
            syncHealth: 'rejected',
            syncPresentation: 'quiet-workout',
            saveError: 'Sincronizzazione rifiutata dal server.',
          });
        });
        expect(querySyncErrorToast(container)).not.toBeNull();
        expect(screen.getByText(/Sincronizzazione rifiutata dal server/i)).toBeDefined();
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

        // A cancelled timeout cannot remove a later warning before its own deadline.
        act(() => { vi.advanceTimersByTime(2500); });
        act(() => { useAppStore.setState({ saveError: 'Nuovo errore indipendente' }); });
        act(() => { vi.advanceTimersByTime(2900); });
        expect(useAppStore.getState().saveError).toBe('Nuovo errore indipendente');
        expect(screen.getByText('Nuovo errore indipendente')).toBeDefined();
        act(() => { vi.advanceTimersByTime(2100); });
        expect(useAppStore.getState().saveError).toBeNull();
      });

      test('T2.13b_R3: Local persistence failure remains visible and cannot be dismissed', async () => {
        const { container } = await renderSettledApp();
        const message = 'Archivio locale non leggibile: riapri TheLogBook.';

        act(() => {
          useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            saveError: message,
          });
        });

        expect(screen.getByText(message)).toBeDefined();
        expect(container.querySelector('.sync-error-close')).toBeNull();

        act(() => {
          vi.advanceTimersByTime(10_000);
        });

        expect(useAppStore.getState().saveError).toBe(message);
        expect(screen.getByText(message)).toBeDefined();
      });

      test('T2.13e_R3: Failed cloud key sync stays visible until verified recovery, without an integrity fence', async () => {
        const { container } = await renderSettledApp();
        const message = 'Chiave cloud non disponibile: sincronizzazione sospesa. I dati locali sono conservati.';

        act(() => {
          useAppStore.setState({
            syncing: false,
            syncHealth: 'failed',
            cloudIntegrityBlocked: false,
            localPersistenceBlocked: false,
            saveError: message,
          });
        });

        const toast = querySyncErrorToast(container);
        expect(toast).not.toBeNull();
        expect(toast?.querySelector('.sync-error-close')).toBeNull();

        act(() => { vi.advanceTimersByTime(10_000); });
        expect(useAppStore.getState().saveError).toBe(message);
        expect(screen.getByText(message)).toBeDefined();

        // Returning online alone is not proof that the remote operation succeeded.
        act(() => { window.dispatchEvent(new Event('online')); });
        expect(screen.getByText(message)).toBeDefined();

        // The confirmed hydrate/ACK paths clear both fields together.
        act(() => { useAppStore.setState({ syncHealth: 'synced', saveError: null }); });
        expect(querySyncErrorToast(container)).toBeNull();

        // Subsequent transient errors still use the ordinary five-second timer.
        act(() => { useAppStore.setState({ saveError: 'Messaggio temporaneo' }); });
        act(() => { vi.advanceTimersByTime(5_100); });
        expect(useAppStore.getState().saveError).toBeNull();
      });

      test('T2.13d_R3: Cloud-integrity failure remains visible and cannot be dismissed', async () => {
        const { container } = await renderSettledApp();
        const message = 'Snapshot cloud incompleto: copia locale preservata.';

        act(() => {
          useAppStore.setState({ cloudIntegrityBlocked: true, syncHealth: 'failed', saveError: message });
        });
        expect(screen.getByText(message)).toBeDefined();
        expect(container.querySelector('.sync-error-close')).toBeNull();

        act(() => { vi.advanceTimersByTime(10_000); });
        expect(useAppStore.getState().saveError).toBe(message);
      });

      test('T2.13c_R3: Update-required reload surfaces a device snapshot failure instead of swallowing it', async () => {
        await renderSettledApp();
        reloadMocks.requiredUpdateHardReload.mockRejectedValueOnce(new Error('quota update snapshot'));

        act(() => {
          useAppStore.setState({
            localWorkout: { id: 'active-update', exercises: [] } as any,
            compatibilityStatus: 'update-required',
            compatibilityError: 'Versione dati futura.',
          });
        });

        const reloadButton = screen.getByRole('button', { name: /Ricarica TheLogBook/i });
        fireEvent.click(reloadButton);
        await act(async () => {
          await Promise.resolve();
        });

        expect(reloadMocks.requiredUpdateHardReload).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/quota update snapshot/i)).toBeDefined();
        expect((reloadButton as HTMLButtonElement).disabled).toBe(false);
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
        expect(container.querySelector('.sync-error-toast') || screen.queryByText(/Errore riga 1/i)).not.toBeNull();

        act(() => {
          useAppStore.setState({ saveError: '' });
        });
        expect(container.querySelector('.sync-error-toast')).toBeNull();
      });
    });
});
