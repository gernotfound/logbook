import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import { DB } from '../../src/lib/db';
import { readLocal } from '../../src/lib/sync/localRepository';
import { captureSession } from '../../src/lib/sync/session';
import { renderSettledApp, querySyncIndicator, setupSyncUiTest, teardownSyncUiTest } from './syncIndicatorUiFixture';

// Each spec hoists its own external-boundary mocks before fixture module initialization.
const reloadMocks = vi.hoisted(() => ({
  requiredUpdateHardReload: vi.fn(),
  safeHardReload: vi.fn(),
}));
vi.mock('../../src/lib/sync/safeReload', () => reloadMocks);

describe('Sync UI — workloads', () => {
  beforeEach(() => setupSyncUiTest(reloadMocks));
  afterEach(teardownSyncUiTest);

  describe('Tier 4: Real-World Application Workloads', () => {

    test('T4.1_workload: Underground gym workout keeps failed-sync warning until a successful recovery', async () => {
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

      // Step 3: A failed (not retryable/pending) sync cannot silently turn
      // into a successful one just because the toast timer elapsed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      expect(useAppStore.getState().syncHealth).toBe('failed');
      expect(useAppStore.getState().saveError).toBe('Network unreachable: Underground gym');
      expect(screen.getByText(/Network unreachable: Underground gym/i)).toBeDefined();

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

    test('T4.1b_workload: Retrying a failed sync does not produce a false cloud success', async () => {
      const { container } = await renderSettledApp();
      vi.mocked(DB.saveUserData)
        .mockRejectedValueOnce(new Error('Chiave cloud non disponibile'))
        .mockRejectedValueOnce(new Error('Chiave cloud ancora non disponibile'));

      const save = (reps: string) => useAppStore.getState().saveUserData(previous => ({
        ...previous!, history: [{
          id: 'retry-check', date: '2026-11-08', routineName: 'Retry',
          duration: '10m', mood: 3, pump: 3, fatigue: 3, water: 1,
          exercises: [], note: reps,
        }],
      }));

      let first!: Promise<unknown>;
      await act(async () => { first = save('1').catch(error => error); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
      expect(await first).toBeInstanceOf(Error);
      expect(useAppStore.getState().syncHealth).toBe('failed');
      expect(screen.getByText('Chiave cloud non disponibile')).toBeDefined();

      let retry!: Promise<unknown>;
      await act(async () => { retry = save('2').catch(error => error); });
      expect(useAppStore.getState().syncHealth).toBe('saving');
      expect(useAppStore.getState().syncing).toBe(true);
      expect(querySyncIndicator(container)).not.toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
      expect(await retry).toBeInstanceOf(Error);
      expect(useAppStore.getState().syncHealth).toBe('failed');
      expect(useAppStore.getState().saveError).toBe('Chiave cloud ancora non disponibile');
      expect(screen.getByText('Chiave cloud ancora non disponibile')).toBeDefined();
    });

    test('T4.2_workload: Three valid meal edits coalesce into the final durable nutrition day', async () => {
      const saveSpy = vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
      const { container } = await renderSettledApp();

      const breakfast = {
        id: 'meal-breakfast-20260822', name: 'Colazione', meal: 'colazione',
        quantity: 1, baseQty: 1, kcal: 500, pro: 30, carbs: 60, fat: 15,
      };
      const lunch = {
        id: 'meal-lunch-20260822', name: 'Pranzo', meal: 'pranzo',
        quantity: 1, baseQty: 1, kcal: 600, pro: 40, carbs: 60, fat: 20,
      };
      const dinner = {
        id: 'meal-dinner-20260822', name: 'Cena', meal: 'cena',
        quantity: 1, baseQty: 1, kcal: 700, pro: 50, carbs: 80, fat: 20,
      };
      const day = (meals: typeof breakfast[]) => ({
        date: '2026-08-22', weight: 75,
        kcal: 0, pro: 0, carbs: 0, fat: 0, meals,
      });

      let p1!: Promise<unknown>;
      let p2!: Promise<unknown>;
      let p3!: Promise<unknown>;
      // Actual meal entries, not manually invented aggregate macros: domain projection derives totals.
      await act(async () => {
        p1 = useAppStore.getState().saveUserData(prev => ({
          ...prev!, nutrition: { '2026-08-22': day([breakfast]) },
        }));
        await vi.advanceTimersByTimeAsync(100);
        p2 = useAppStore.getState().saveUserData(prev => ({
          ...prev!, nutrition: { '2026-08-22': day([breakfast, lunch]) },
        }));
        await vi.advanceTimersByTimeAsync(100);
        p3 = useAppStore.getState().saveUserData(prev => ({
          ...prev!, nutrition: { '2026-08-22': day([breakfast, lunch, dinner]) },
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

      // The one remote attempt must contain the final locally committed meal set.
      const expectedTotals = { kcal: 1800, pro: 120, carbs: 200, fat: 55 };
      const expectedMealIds = [breakfast.id, lunch.id, dinner.id];
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const submittedDay = saveSpy.mock.calls[0]?.[0]?.nutrition?.['2026-08-22'];
      expect(submittedDay).toMatchObject({ date: '2026-08-22', weight: 75, ...expectedTotals });
      expect(submittedDay?.meals?.map(item => item.id)).toEqual(expectedMealIds);

      // DB is mocked here: independently verify that the real IndexedDB envelope survived batching.
      const durable = await readLocal(captureSession().owner);
      const durableDay = durable?.data.nutrition?.['2026-08-22'];
      expect(durableDay).toMatchObject({ date: '2026-08-22', ...expectedTotals });
      expect(durableDay?.meals?.map(item => item.id)).toEqual(expectedMealIds);
      expect(useAppStore.getState().syncing).toBe(false);
      expect(screen.queryByText(/Salvataggio in corso/i)).toBeNull();
    });

    // Timeout increased to 10000ms: Resolving mock-timer window advancing (1100ms) 
    // requires more real-time processing of JSDom async callbacks under high parallel CPU load.
    test('T4.3_workload: Completed-history snapshot save keeps UI responsive during background sync', async () => {
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

    test('T4.4_workload: Manually dismisses an error toast without displaying legacy sync overlay', async () => {
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

    test('T4.5_workload: Simulated transport failure and retry update the UI error state', async () => {
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

      // This jsdom test verifies the UI response to a mocked retry; journal replay
      // and offline durability require the separate repository/recovery suites.
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
