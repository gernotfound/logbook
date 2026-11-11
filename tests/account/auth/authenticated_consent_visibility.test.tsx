import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import type { UserData } from '../../../src/types';
vi.mock('../../../src/lib/appCheck', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/lib/appCheck')>(),
  getLimitedUseAppCheckToken: vi.fn(async () => 'synthetic-limited-use-token'),
}));
vi.unmock('../../../src/lib/healthConsent');
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => { window.history.replaceState({}, '', '/'); });

it('removes an authenticated fitness view on another tab withdrawal before the trusted GET returns, preserving ciphertext and pending', async () => {
  // Real App + consent policy + encrypted repository. Firebase identity, trusted
  // HTTP and the browser storage-event delivery are simulated in this realm.
  // The shared setup eagerly imports the nominal store with a mocked consent
  // guard. Reacquire the complete source graph after unmocking, or the store
  // retains that no-op guard even while App observes the real policy.
  vi.resetModules();
  const [
    { default: App }, { AuthContext, defaultAuthContext }, { DB },
    { loadAuthenticatedData }, { auth }, { LEGAL_VERSIONS }, { UserDataSchema },
    { useAppStore }, { initializeLocal, commitLocal, readLocal },
    { prepareUnlockedTestArchive }, policy,
  ] = await Promise.all([
    import('../../../src/App'), import('../../../src/contexts/AuthContextDef'),
    import('../../../src/lib/db'), import('../../../src/contexts/auth/loadAuthenticatedData'),
    import('../../../src/lib/firebase'), import('../../../src/lib/legalVersions'),
    import('../../../src/lib/schema'), import('../../../src/store/useAppStore'),
    import('../../../src/lib/sync/localRepository'), import('../../secureVaultFixture'),
    import('../../../src/lib/healthConsent'),
  ]);
  const {
    beginHealthConsentVerification, refreshHealthConsent,
    isHealthConsentWritable, isHealthConsentCloudWritable, subscribeHealthConsent,
  } = policy;
  expect(vi.isMockFunction(policy.requireHealthConsentWritable)).toBe(false);
  useAppStore.getState().resetStore({ force: true });
  const actor = auth.currentUser!;
  const owner = 'user:' + actor.uid;
  await prepareUnlockedTestArchive(owner);
  const base = UserDataSchema.parse({
    profile: { height: '181' },
    legalConsent: {
      hasAcceptedTerms: true, hasAcceptedHealthData: true,
      acceptedAt: '2026-11-05T10:00:00.000Z',
      privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
    },
  }) as UserData;
  await initializeLocal(owner, base);
  const fetchMock = vi.fn(async () => Response.json({
    status: 'active', revision: 1, acceptedAt: base.legalConsent!.acceptedAt,
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
  }));
  vi.stubGlobal('fetch', fetchMock);
  beginHealthConsentVerification(actor.uid);
  expect(await refreshHealthConsent(actor)).toBe('active');
  expect(isHealthConsentCloudWritable(owner)).toBe(true);
  const edited = { ...base, profile: { ...base.profile, height: '183' } };
  await commitLocal(owner, edited, base);
  const original = (await readLocal(owner))!;
  expect(original.consentRevision).toBe(1);
  expect(original.pending.length).toBeGreaterThan(0);
  const ciphertext = await get('logbook:v2:' + owner);
  expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
  expect(ciphertext).not.toContain('"height":"183"');
  useAppStore.setState({ userData: original.data, dataOwner: owner, syncing: false, localWorkout: null });
  window.history.replaceState({}, '', '/?tab=data');
  // This scenario targets consent while data is already visible. Resolve the
  // real lazy view before mounting, independently of CI module-transform time.
  await import('../../../src/components/Data/DataView');
  const view = render(
    <AuthContext.Provider value={{ ...defaultAuthContext, currentUser: actor, loading: false }}>
      <App />
    </AuthContext.Provider>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Biometria' }));
  expect((await screen.findByLabelText(/Altezza/) as HTMLInputElement).value).toBe('183');

  let releaseCloud!: (payload: Awaited<ReturnType<typeof DB.loadCloudPayload>>) => void;
  vi.mocked(DB.loadCloudPayload).mockReturnValueOnce(new Promise(resolve => { releaseCloud = resolve; }));
  let loading!: ReturnType<typeof loadAuthenticatedData>;
  act(() => {
    loading = loadAuthenticatedData({
      user: actor, isGuestActive: () => false,
      setSyncing: vi.fn(), setSaveError: vi.fn(),
    });
  });
  await waitFor(() => expect(DB.loadCloudPayload).toHaveBeenCalledOnce());

  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const marker = 'logbook:v2:' + owner + ':health-consent-withdrawal';
  act(() => {
    localStorage.setItem(marker, 'withdrawn');
    window.dispatchEvent(new StorageEvent('storage', { key: marker, oldValue: null, newValue: 'withdrawn' }));
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await screen.findByRole('heading', { name: 'Accesso a TheLogBook sospeso' });
  expect(screen.queryByLabelText(/Altezza/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Salva profilo biometrico' })).toBeNull();
  expect(isHealthConsentWritable(owner)).toBe(false);
  expect(isHealthConsentCloudWritable(owner)).toBe(false);
  await act(async () => {
    releaseCloud({ data: { ...original.data, profile: { height: '199' } }, completeMonths: [], cloudDocuments: new Map() });
    expect(await loading).toBe('blocked');
  });
  await expect(useAppStore.getState().dispatchDomainOperation({
    type: 'profile.patch', patch: { height: '199' },
  })).rejects.toThrow('Accesso fitness sospeso');
  expect(await get('logbook:v2:' + owner)).toBe(ciphertext);
  expect(await readLocal(owner)).toEqual(original);

  let unsubscribe = () => {};
  const published = new Promise<void>(resolve => { unsubscribe = subscribeHealthConsent(resolve); });
  await act(async () => {
    finish(Response.json({ status: 'withdrawn', revision: 2 }));
    await published;
  });
  unsubscribe();
  expect(await get('logbook:v2:' + owner)).toBe(ciphertext);
  expect(await readLocal(owner)).toEqual(original);
  view.unmount();
});
