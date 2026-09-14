import { auth, onAuthStateChanged } from '../src/lib/firebase';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { useAppStore } from '../src/store/useAppStore';
import { clearCatalogCache, saveCatalogToCache } from '../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../src/lib/catalog/deltaResolver';
import type { UserData, Exercise, Food } from '../src/types';

const GuestTestComponent = () => {
    const { currentUser, loading, isGuest, loginAsGuest, logout } = useAuth();
    const userData = useAppStore(s => s.userData);

    return (
        <div>
            <div data-testid="auth-loading">{loading ? 'LOADING' : 'READY'}</div>
            <div data-testid="auth-mode">{isGuest ? 'GUEST' : (currentUser ? 'AUTHENTICATED' : 'ANONYMOUS')}</div>
            <div data-testid="exercise-count">{userData?.library?.length ?? 0}</div>
            <div data-testid="food-count">{userData?.customFoods?.length ?? 0}</div>
            <button data-testid="btn-guest" onClick={() => loginAsGuest()}>Guest Login</button>
            <button data-testid="btn-logout" onClick={() => logout({ mode: 'normal' })}>Logout</button>
        </div>
    );
};

describe('Milestone M2: Guest Bootstrap & Cold Start Lifecycle', () => {
    beforeEach(async () => {
        (auth as any).currentUser = null;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { callback(null); return () => {}; });
        localStorage.clear();
        if (typeof window !== 'undefined') {
            window.__INITIAL_USER_DATA__ = null;
        }
        await clearCatalogCache();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    it('M2.1: loginAsGuest() resolves the seed catalog on a fresh cold start', async () => {
        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        expect(screen.getByTestId('auth-loading').textContent).toBe('READY');

        act(() => {
            screen.getByTestId('btn-guest').click();
        });

        await waitFor(() => expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST'));
        await waitFor(() => expect(useAppStore.getState().userData).not.toBeNull());

        const state = useAppStore.getState().userData;
        expect(Array.isArray(state?.library)).toBe(true);
        expect(Array.isArray(state?.customFoods)).toBe(true);
        expect(state?.library?.length).toBe(0);
        expect(state?.customFoods?.length).toBe(0);
        expect(parseInt(screen.getByTestId('exercise-count').textContent || '0')).toBe(0);
        expect(parseInt(screen.getByTestId('food-count').textContent || '0')).toBe(0);
    });

    it('M2.2: catalog delta resolvers preserve custom entries and apply overrides', () => {
        const catalog = {
            exercises: [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
            ] as import('../src/types').CatalogExercise[],
            foods: [
                { id: 'petto-di-pollo-crudo', name: 'Petto di Pollo Crudo', kcal: 103, pro: 23, carbs: 0, fat: 1.2, isCustom: false }
            ] as import('../src/types').CatalogFood[]
        };

        const customEx: Exercise = {
            id: 'custom_biceps_curl',
            name: 'Curl Bicipiti Custom',
            setsCount: 4,
            sets: [],
            muscles: ['biceps'],
            isDefault: false
        };

        const customFood: Food = {
            id: 'custom_greek_yogurt',
            name: 'Yogurt Greco 0% Custom',
            kcal: 59,
            pro: 10.3,
            carbs: 4,
            fat: 0,
            isCustom: true
        };

        const cachedUserData: UserData = {
            profile: { height: '175' },
            library: [customEx],
            customFoods: [customFood],
            catalogOverrides: {
                exercises: {
                    'panca-piana-bilanciere': { notes: 'Pausa 2s' }
                }
            }
        };

        const resolvedLibrary = resolveEffectiveExercises(catalog.exercises, cachedUserData.library || [], cachedUserData.catalogOverrides);
        const resolvedFoods = resolveEffectiveFoods(catalog.foods, cachedUserData.customFoods || [], cachedUserData.catalogOverrides);

        expect(resolvedLibrary).toHaveLength(catalog.exercises.length + 1);
        expect(resolvedLibrary[0].id).toBe('custom_biceps_curl');
        expect(resolvedLibrary[0].isDefault).toBe(false);
        expect(resolvedLibrary.find(e => e.id === 'panca-piana-bilanciere')?.notes).toBe('Pausa 2s');
        expect(resolvedFoods).toHaveLength(catalog.foods.length + 1);
        expect(resolvedFoods[0].id).toBe('custom_greek_yogurt');
        expect(resolvedFoods[0].isCustom).toBe(true);
    });

    it('M2.3: una sessione guest non viene azzerata dal callback Firebase non autenticato', async () => {
        localStorage.setItem('logbook_is_guest', 'true');

        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        act(() => {
            screen.getByTestId('btn-guest').click();
        });

        await waitFor(() => expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST'));
        await waitFor(() => expect(useAppStore.getState().userData).not.toBeNull());
        expect(Array.isArray(useAppStore.getState().userData?.library)).toBe(true);
        expect(useAppStore.getState().userData?.library?.length).toBe(0);
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    });

    it('M2.4: il logout guest pulisce i dati e resetta lo store passando da AuthProvider', async () => {
        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        act(() => {
            screen.getByTestId('btn-guest').click();
        });

        await waitFor(() => expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST'));
        await waitFor(() => expect(useAppStore.getState().userData).not.toBeNull());

        act(() => {
            screen.getByTestId('btn-logout').click();
        });

        await waitFor(() => expect(localStorage.getItem('logbook_is_guest')).toBeNull());
        await waitFor(() => expect(useAppStore.getState().userData).toBeNull());
        expect(screen.getByTestId('exercise-count').textContent).toBe('0');
    });

    it('M2.5: loginAsGuest preserva gli elementi custom quando risolve un catalogo mancante', async () => {
        const fixtureCatalog = {
            manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
            exercises: [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
            ],
            foods: []
        } as any;
        await saveCatalogToCache(fixtureCatalog);

        const customEx: Exercise = {
            id: 'custom_lat_pull',
            name: 'Lat Machine Impugnatura Neutra',
            setsCount: 3,
            sets: [],
            isDefault: false
        };

        localStorage.setItem('logbook_is_guest', 'true');
        useAppStore.getState().setUserData({
            profile: { height: '180' },
            library: [customEx],
            customFoods: [],
            catalogOverrides: {}
        });

        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        act(() => {
            screen.getByTestId('btn-guest').click();
        });

        await waitFor(() => expect(useAppStore.getState().userData?.library?.length).toBe(2));
        const state = useAppStore.getState().userData!;
        expect(state.library?.find(e => e.id === 'custom_lat_pull')).toBeDefined();
        expect(state.library?.find(e => e.id === 'panca-piana-bilanciere')).toBeDefined();
    });
});
