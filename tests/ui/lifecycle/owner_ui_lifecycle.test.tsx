import React from 'react';
import type { User } from 'firebase/auth';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, beforeEach, expect, it } from 'vitest';
import App from '../../../src/App';
import { AuthContext, defaultAuthContext } from '../../../src/contexts/AuthContextDef';
import { useAppStore } from '../../../src/store/useAppStore';
import { defaultMockUserData } from '../../setup';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';

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
    fireEvent.click(await screen.findByRole('button', { name: 'Apri impostazioni' }, { timeout: 10000 }));
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeDefined();
    act(() => useAppStore.setState({ userData: data(), dataOwner: 'user:b' }));
    view.rerender(<AuthContext.Provider value={owner('b')}><App /></AuthContext.Provider>);
    expect(screen.queryByRole('heading', { name: 'Impostazioni' })).toBeNull();
    expect((await screen.findByRole('button', { name: /^home$/i })).classList.contains('active')).toBe(true);
  });

  it('hides the previous owners private foods while the next account is still hydrating', async () => {
    const food = (id: string, name: string) => ({
      id, name, unit: 'g', baseQty: 100, kcal: 100, carbs: 10, pro: 10, fat: 1,
    });
    useAppStore.setState({
      userData: { ...data(), customFoods: [food('private-a', 'Alimento riservato account A')] },
      dataOwner: 'user:a',
    });
    const view = render(<AuthContext.Provider value={owner('a')}><App /></AuthContext.Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Nutrizione' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Alimenti' }));
    expect(await screen.findByText('Alimento riservato account A')).toBeDefined();

    // Firebase resolves B before the A snapshot has been evicted from Zustand.
    // This is deliberately a mismatched but still-owned transitional snapshot.
    view.rerender(<AuthContext.Provider value={owner('b')}><App /></AuthContext.Provider>);
    expect(useAppStore.getState().dataOwner).toBe('user:a');
    expect(useAppStore.getState().userData?.customFoods?.[0]?.id).toBe('private-a');
    expect(screen.getByRole('status', { name: 'Preparazione account in corso' })).toBeDefined();
    expect(screen.queryByText('Alimento riservato account A')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nutrizione' })).toBeNull();

    act(() => useAppStore.setState({
      userData: { ...data(), customFoods: [food('private-b', 'Alimento riservato account B')] },
      dataOwner: 'user:b',
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nutrizione' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Alimenti' }));
    expect(await screen.findByText('Alimento riservato account B')).toBeDefined();
    expect(screen.queryByText('Alimento riservato account A')).toBeNull();
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
