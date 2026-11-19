import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { useAppStore } from '../../src/store/useAppStore';
import { DB } from '../../src/lib/db';
import type { UserData } from '../../src/types';
import { setupPwaIndexeddbTest, teardownPwaIndexeddbTest, makeUserData } from './pwaIndexeddbTestFixture';

describe('PWA debounced saves', () => {
  beforeEach(setupPwaIndexeddbTest);
  afterEach(teardownPwaIndexeddbTest);

    test('saveUserData sets syncing to true during debounce and false upon completion', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
      vi.useFakeTimers();

      const mockData: UserData = makeUserData('175');

      expect(useAppStore.getState().syncing).toBe(false);

      const savePromise = useAppStore.getState().saveUserData(mockData);

      // Immediately after triggering saveUserData, syncing should be true
      expect(useAppStore.getState().syncing).toBe(true);

      // Fast-forward past debounce timer (1000ms)
      await vi.advanceTimersByTimeAsync(1100);
      await savePromise;

      // After completion, syncing should be false
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('overlapping saveUserData calls maintain syncing=true continuously until all saves finish', async () => {
      await prepareUnlockedTestArchive('user:test-user-id');
      vi.useFakeTimers();
      const { DB } = await import('../../src/lib/db');

      const pendingResolvers: Array<(result: Awaited<ReturnType<typeof DB.saveUserData>>) => void> = [];
      let callCount = 0;
      vi.spyOn(DB, 'saveUserData').mockImplementation(() => new Promise(resolve => {
        callCount++;
        pendingResolvers.push(resolve);
      }));

      const mockData1: UserData = makeUserData('176');

      const mockData2: UserData = {
        ...mockData1,
        profile: { height: '177' }
      };

      // 1. Trigger first save
      const p1 = useAppStore.getState().saveUserData(mockData1);
      expect(useAppStore.getState().syncing).toBe(true);

      // 2. Debounce timer fires (1000ms), first DB.saveUserData is now in-flight
      await vi.advanceTimersByTimeAsync(1000);
      expect(callCount).toBe(1);
      expect(useAppStore.getState().syncing).toBe(true);

      // 3. User mutates again while first save is in-flight -> triggers second save
      const p2 = useAppStore.getState().saveUserData(mockData2);
      expect(useAppStore.getState().syncing).toBe(true);

      // 4. First network write finishes while second save is debouncing
      pendingResolvers[0]?.({ ok: true, status: 'synced' });
      await vi.advanceTimersByTimeAsync(100);

      // CRITICAL: syncing MUST remain TRUE because second save is still debouncing
      expect(useAppStore.getState().syncing).toBe(true);

      // 5. Advance timer for second debounce (1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(callCount).toBe(2);
      expect(useAppStore.getState().syncing).toBe(true);

      // 6. Second network write finishes
      pendingResolvers[1]?.({ ok: true, status: 'synced' });
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([p1, p2]);

      // 7. Now that all queued saves are finished, syncing should be false
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });

    test('resetStore cancels pending debounce timers and clears syncing state', async () => {
      vi.useFakeTimers();

      const mockData: UserData = makeUserData('178');

      // Observe the cancellation rejection rather than swallowing it.
      const canceled = expect(useAppStore.getState().saveUserData(mockData))
        .rejects.toThrow('cambio sessione');
      expect(useAppStore.getState().syncing).toBe(true);

      // Reset store before debounce fires
      useAppStore.getState().resetStore();

      expect(useAppStore.getState().syncing).toBe(false);
      expect(useAppStore.getState().userData).toBeNull();

      await canceled;
      // Advancing time should not re-trigger any save or error
      await vi.advanceTimersByTimeAsync(1500);
      expect(useAppStore.getState().syncing).toBe(false);

      vi.useRealTimers();
    });
});
