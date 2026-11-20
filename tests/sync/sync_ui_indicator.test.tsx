import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
import { defaultMockUserData } from '../setup';
import { useAppStore } from '../../src/store/useAppStore';
import { clearSyncTimers } from '../../src/store/slices/createSyncSlice';
import { DB } from '../../src/lib/db';
import { commitDomainOperations, initializeLocal } from '../../src/lib/sync/localRepository';
import { renderSettledApp, querySyncIndicator, setupSyncUiTest, teardownSyncUiTest } from './syncIndicatorUiFixture';

// Each spec hoists its own external-boundary mocks before fixture module initialization.
const reloadMocks = vi.hoisted(() => ({
  requiredUpdateHardReload: vi.fn(),
  safeHardReload: vi.fn(),
}));
vi.mock('../../src/lib/sync/safeReload', () => reloadMocks);

describe('Sync UI — indicator', () => {
  beforeEach(() => setupSyncUiTest(reloadMocks));
  afterEach(teardownSyncUiTest);

    describe('R1: Full Blocking Overlay Elimination', () => {
      test('T1.1-T1.5_R1: syncing never mounts the blocking overlay or unmounts navigation', async () => {
        const { container } = await renderSettledApp();
        expect(container.querySelector('#sync-overlay')).toBeNull();
        expect(document.querySelector('#sync-overlay')).toBeNull();

        act(() => {
          useAppStore.setState({ syncing: true });
        });
        expect(container.querySelector('#sync-overlay')).toBeNull();
        expect(document.querySelector('#sync-overlay')).toBeNull();
        expect(container.querySelector('#app-container')).not.toBeNull();
        expect(container.querySelector('nav') || screen.queryByRole('navigation')).not.toBeNull();
      });
    });

    describe('R2: Non-Blocking Background Sync Indicator', () => {
      test('T1.6-T1.10_R2: status mounts with text and spinner, then unmounts after sync', async () => {
        const { container } = await renderSettledApp();
        expect(querySyncIndicator(container)).toBeNull();

        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const indicator = container.querySelector('.sync-indicator');
        expect(indicator).not.toBeNull();
        expect(screen.getByRole('status', { name: 'Salvataggio in corso' })).toBe(indicator);
        expect(screen.getByText('Salvataggio in corso...')).toBeDefined();
        expect(indicator?.querySelector('.sync-indicator-spinner')).not.toBeNull();

        act(() => {
          useAppStore.setState({ syncing: false });
        });
        expect(querySyncIndicator(container)).toBeNull();
      });

      test('T1.10a_R2: active-workout background sync stays visually quiet during set entry', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({
            syncing: true,
            syncHealth: 'saving',
            syncPresentation: 'quiet-workout',
          });
        });
        expect(querySyncIndicator(container)).toBeNull();
      });

      test('T1.10b_R2: normal final-session sync remains visible', async () => {
        await renderSettledApp();
        act(() => {
          useAppStore.setState({
            syncing: true,
            syncHealth: 'saving',
            syncPresentation: 'normal',
          });
        });
        expect(screen.getByText(/Salvataggio in corso/i)).toBeDefined();
      });

      test('T1.10c_R2: sync presentation is derived from the domain operation, not from the screen', async () => {
        await renderSettledApp();
        const workout = {
          id: 'workout-sync-presentation',
          routineName: 'Test',
          exercises: [],
        };

        let quietPromise: Promise<unknown> | undefined;
        act(() => {
          quietPromise = useAppStore.getState().dispatchDomainOperation({
            type: 'active-workout.set',
            workout,
          });
        });
        void quietPromise?.catch(() => {});
        expect(useAppStore.getState().syncPresentation).toBe('quiet-workout');

        act(() => {
          clearSyncTimers();
          useAppStore.setState({ syncing: false, syncPresentation: 'normal' });
        });

        let finalPromise: Promise<unknown> | undefined;
        act(() => {
          finalPromise = useAppStore.getState().dispatchDomainOperation({
            type: 'workout.complete',
            workout,
            expectedActiveWorkoutId: String(workout.id),
            activePains: [],
          });
        });
        void finalPromise?.catch(() => {});
        expect(useAppStore.getState().syncPresentation).toBe('normal');
      });


      test('T1.10d_R2: restart-style durable workout replay stays quiet while a workout is active', async () => {
        const { container } = await renderSettledApp();
        const owner = 'user:test-user-id';
        const workout = {
          id: 'workout-replay-quiet',
          routineName: 'Replay quiet',
          exercises: [],
        };

        const baseData = { ...defaultMockUserData, activeWorkout: null };
        await initializeLocal(owner, baseData);
        await commitDomainOperations(owner, { type: 'active-workout.set', workout }, baseData);

        useAppStore.setState({
          userData: { ...defaultMockUserData, activeWorkout: workout },
          localWorkout: workout,
          syncing: false,
          syncHealth: 'local-pending',
          syncPresentation: 'normal',
          saveError: null,
        });

        let resolveRemote!: (value: { ok: true; status: 'synced' }) => void;
        vi.mocked(DB.saveUserData).mockImplementationOnce(() => new Promise<any>(resolve => {
          resolveRemote = value => resolve(value);
        }));

        let replayPromise!: Promise<void>;
        await act(async () => {
          replayPromise = useAppStore.getState().flushPendingSyncs();
          await Promise.resolve();
        });

        expect(useAppStore.getState().syncing).toBe(true);
        expect(useAppStore.getState().syncPresentation).toBe('quiet-workout');
        expect(querySyncIndicator(container)).toBeNull();

        await act(async () => {
          resolveRemote({ ok: true, status: 'synced' });
          await replayPromise;
        });

        expect(useAppStore.getState().syncing).toBe(false);
      });
    });


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
            userData: { ...prev.userData!, profile: { height: '180' } }
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

      test('T2.7_R2: Sync indicator exposes a polite status role', async () => {
        const { container } = await renderSettledApp();
        act(() => {
          useAppStore.setState({ syncing: true });
        });
        const indicator = container.querySelector('.sync-indicator');
        expect(indicator).not.toBeNull();
        expect(indicator?.getAttribute('role')).toBe('status');
        expect(indicator?.getAttribute('aria-live')).toBe('polite');
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
});
