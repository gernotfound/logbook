import React from 'react';
import type { User } from 'firebase/auth';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, beforeEach, expect, it } from 'vitest';
import App from '../src/App';
import { AuthContext, defaultAuthContext } from '../src/contexts/AuthContextDef';
import { useAppStore } from '../src/store/useAppStore';
import { defaultMockUserData } from './setup';
import { LEGAL_VERSIONS } from '../src/lib/legalVersions';

const consent = {
  hasAcceptedTerms: true, hasAcceptedHealthData: true,
  acceptedAt: '2026-10-13T00:00:00.000Z',
  privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
};
const owner = (uid: string) => ({
  ...defaultAuthContext, currentUser: { uid, emailVerified: true } as User,
});
const data = () => ({ ...defaultMockUserData, legalConsent: consent });

describe('owner-bound UI mount', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null,
      syncing: false, saveError: null, localPersistenceBlocked: false });
  });

  it('does not transfer open settings to a newly authenticated owner', async () => {
    useAppStore.setState({ userData: data(), dataOwner: 'user:a' });
    const view = render(<AuthContext.Provider value={owner('a')}><App /></AuthContext.Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Apri impostazioni' }));
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeDefined();
    act(() => useAppStore.setState({ userData: data(), dataOwner: 'user:b' }));
    view.rerender(<AuthContext.Provider value={owner('b')}><App /></AuthContext.Provider>);
    expect(screen.queryByRole('heading', { name: 'Impostazioni' })).toBeNull();
    expect((await screen.findByRole('button', { name: /^home$/i })).classList.contains('active')).toBe(true);
  });

  it('retains the initial PWA shortcut when auth resolves after an anonymous bootstrap', async () => {
    window.history.replaceState({}, '', '/?tab=settings');
    const view = render(<AuthContext.Provider value={defaultAuthContext}><App /></AuthContext.Provider>);
    act(() => useAppStore.setState({ userData: data(), dataOwner: 'user:a' }));
    view.rerender(<AuthContext.Provider value={owner('a')}><App /></AuthContext.Provider>);
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeDefined();
    expect(window.location.search).toBe('');
  });
});
