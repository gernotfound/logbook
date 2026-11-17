import { beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../../../src/lib/firebase';
import { isAccountDeletionPending, markAccountDeletion } from '../../../src/lib/sync/accountGate';
import { UserDataSchema } from '../../../src/lib/schema';
import { useAppStore } from '../../../src/store/useAppStore';

const OWNER_A = 'user:stale-account';
const OWNER_B = 'user:other-account';

function showOwnerData(owner: string): void {
  useAppStore.setState({
    userData: UserDataSchema.parse({ profile: { height: '175' } }) as any,
    dataOwner: owner,
  });
}

describe('M7 logout isolation with stale deletion receipts', () => {
  beforeEach(() => {
    localStorage.clear();
    (auth as any).currentUser = null;
    useAppStore.getState().resetStore({ force: true });
    showOwnerData(OWNER_B);
  });

  it('does not let an auth-less receipt from account A retain account B in memory', () => {
    markAccountDeletion(OWNER_A, { receiptToken: 'A'.repeat(43) });

    useAppStore.getState().resetStore();

    expect(useAppStore.getState().userData).toBeNull();
    expect(useAppStore.getState().dataOwner).toBeNull();
    expect(isAccountDeletionPending(OWNER_A)).toBe(true);
  });

  it('preserves the matching account recovery view after Auth has been removed', () => {
    showOwnerData(OWNER_A);
    markAccountDeletion(OWNER_A, { receiptToken: 'A'.repeat(43) });

    useAppStore.getState().resetStore();

    expect(useAppStore.getState().userData?.profile?.height).toBe('175');
    expect(useAppStore.getState().dataOwner).toBe(OWNER_A);
    expect(useAppStore.getState().saveError).toContain('Cancellazione account in verifica');
  });

  it('does not retain another owner view when a new authenticated user has a pending deletion', () => {
    (auth as any).currentUser = { uid: 'stale-account' };
    markAccountDeletion(OWNER_A);

    useAppStore.getState().resetStore();

    expect(useAppStore.getState().userData).toBeNull();
    expect(useAppStore.getState().dataOwner).toBeNull();
    expect(isAccountDeletionPending(OWNER_A)).toBe(true);
  });

  it('preserves an owner-matched view for a corrupt marker without destroying its bytes', () => {
    showOwnerData(OWNER_A);
    const key = 'logbook:v2:' + OWNER_A + ':account-deletion';
    localStorage.setItem(key, '{"startedAt":');

    useAppStore.getState().resetStore();

    expect(useAppStore.getState().dataOwner).toBe(OWNER_A);
    expect(useAppStore.getState().userData?.profile?.height).toBe('175');
    expect(localStorage.getItem(key)).toBe('{"startedAt":');
  });

  it('force-clears the in-memory view without deleting a matching recovery receipt', () => {
    showOwnerData(OWNER_A);
    markAccountDeletion(OWNER_A, { receiptToken: 'A'.repeat(43) });

    useAppStore.getState().resetStore({ force: true });

    expect(useAppStore.getState().userData).toBeNull();
    expect(useAppStore.getState().dataOwner).toBeNull();
    expect(isAccountDeletionPending(OWNER_A)).toBe(true);
  });
});
