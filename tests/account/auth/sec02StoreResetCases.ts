import { describe, it, expect, vi } from 'vitest';
import type { Sec02TestContext } from './sec02_logout_cleanup.test';
import type { UserData } from '../../../src/types';

export function registerSec02StoreResetCases({
  useAppStore, storageOwner, initializeLocal, UserDataSchema, idb, idbStore,
}: Sec02TestContext): void {
  describe('volatile state without deleting durable archives', () => {
    it('cancelPendingSyncs stops debouncer and sets syncing to false to prevent race conditions during logout', () => {
        const store = useAppStore.getState();
        // Manually start a "sync"
        store.setSyncing(true);
        expect(useAppStore.getState().syncing).toBe(true);

        store.cancelPendingSyncs();

        expect(useAppStore.getState().syncing).toBe(false);
    });

    it('resetStore preserves memory state when the active deletion marker is corrupt', () => {
        const owner = storageOwner();
        localStorage.setItem(`logbook:v2:${owner}:account-deletion`, '{"startedAt":');
        useAppStore.setState({
            userData: { profile: { height: '175' } } as any,
            dataOwner: owner,
        });

        useAppStore.getState().resetStore();

        expect(useAppStore.getState().userData?.profile?.height).toBe('175');
        expect(useAppStore.getState().saveError).toContain('Cancellazione account in verifica');
    });

    it('blocks ordinary local writes while account deletion is pending', async () => {
        localStorage.setItem('logbook_is_guest', 'false');
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice(5) : 'unexpected-guest';
        localStorage.setItem(`logbook:v2:${owner}:account-deletion`, JSON.stringify({
            owner,
            uid,
            startedAt: Date.now(),
            receiptToken: 'receipt-token',
        }));
        useAppStore.setState({
            userData: {
                ...useAppStore.getState().userData,
                profile: { height: '176' },
            } as any,
            dataOwner: owner,
        });

        await expect(useAppStore.getState().dispatchDomainOperation({
            type: 'profile.patch',
            patch: { height: '177' },
        } as any)).rejects.toThrow('Cancellazione account in corso');

        expect(useAppStore.getState().userData?.profile?.height).toBe('176');
    });

    it('resetStore clears memory without erasing the durable encrypted archive', async () => {
        const owner = storageOwner();
        const key = 'logbook:v2:' + owner;
        const initial = UserDataSchema.parse({ profile: { height: '175' } }) as unknown as UserData;
        await initializeLocal(owner, initial);
        const ciphertext = idbStore[key];
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        const deletionsBeforeReset = vi.mocked(idb.del).mock.calls.length;

        useAppStore.setState({ userData: initial, dataOwner: owner });
        useAppStore.getState().resetStore();

        expect(useAppStore.getState().userData).toBeNull();
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(useAppStore.getState().syncing).toBe(false);
        expect(useAppStore.getState().saveError).toBeNull();
        expect(vi.mocked(idb.del).mock.calls).toHaveLength(deletionsBeforeReset);
        expect(idbStore[key]).toBe(ciphertext);
    });
  });
}
