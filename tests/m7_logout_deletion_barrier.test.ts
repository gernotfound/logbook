import { beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../src/lib/firebase';
import { isAccountDeletionPending, markAccountDeletion } from '../src/lib/sync/accountGate';
import { useAppStore } from '../src/store/useAppStore';

describe('M7 logout isolation with stale deletion receipts', () => {
  beforeEach(() => {
    localStorage.clear();
    (auth as any).currentUser = null;
    useAppStore.getState().resetStore({ force: true });
    useAppStore.setState({ userData: { profile: { name: 'other owner view' } } as any });
  });

  it('preserves auth-less deletion recovery by default but force-clears an explicitly purged logout view', () => {
    markAccountDeletion('user:stale-account', { receiptToken: 'A'.repeat(43) });

    useAppStore.getState().resetStore();
    expect(useAppStore.getState().userData).not.toBeNull();
    expect(isAccountDeletionPending('user:stale-account')).toBe(true);

    useAppStore.getState().resetStore({ force: true });
    expect(useAppStore.getState().userData).toBeNull();
    expect(isAccountDeletionPending('user:stale-account')).toBe(true);
  });

});
