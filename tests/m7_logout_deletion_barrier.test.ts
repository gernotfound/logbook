import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('uses force reset only after explicit guest/authenticated logout cleanup', () => {
    const authContext = readFileSync(resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
    const forcedResets = authContext.match(/resetStore\(\{ force: true \}\)/g) ?? [];

    // Every force reset belongs to an explicitly reviewed lifecycle path:
    // cross-tab revocation, recovery cleanup before a new guest generation,
    // a revoked tab's stale UI, guest logout, or authenticated logout.
    expect(forcedResets).toHaveLength(5);
    expect(authContext).toMatch(/const reconcileGuestSession[\s\S]*?resetStore\(\{ force: true \}\)/);
    expect(authContext).toMatch(/if \(readBrowserValueStrict\(GUEST_REVOCATION_KEY\) !== null\)[\s\S]{0,350}await DB\.purgeAllLocalUserData\('guest'\);[\s\S]{0,350}resetStore\(\{ force: true \}\)/);
    expect(authContext).toMatch(/if \(isGuestRef\.current && !isActiveGuestSession\(\)\)[\s\S]{0,300}resetStore\(\{ force: true \}\)/);
    expect(authContext).toMatch(/await DB\.purgeAllLocalUserData\('guest'\);[\s\S]{0,650}setIsGuest\(false\);[\s\S]{0,250}resetStore\(\{ force: true \}\)/);
    expect(authContext).toContain('await DB.secureLogOut();');
    expect(authContext).toMatch(/await DB\.secureLogOut\(\);[\s\S]{0,200}resetStore\(\{ force: true \}\)/);
    expect(authContext).toMatch(/setIsGuest\(false\);[\s\S]{0,200}resetStore\(\{ force: true \}\)/);
    expect(authContext).toMatch(/if \(!isGuestActive\) \{[\s\S]{0,500}clearAuthenticatedOwnerHint\(\);[\s\S]{0,300}resetStore\(\);/);
  });
});
