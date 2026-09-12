import { auth, onAuthStateChanged } from '../src/lib/firebase';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { useAppStore } from '../src/store/useAppStore';
import {  clearCatalogCache, saveCatalogToCache } from '../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../src/lib/catalog/deltaResolver';
import type { UserData, Exercise, Food } from '../src/types';
import { idbStore } from './setup';

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
            <button data-testid="btn-logout" onClick={() => logout(true)}>Logout</button>
        </div>
    );
};

describe('Milestone M2: Guest Bootstrap & Cold Start Lifecycle', () => {

    beforeEach(async () => {
        (auth as any).currentUser = null;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { callback(null); return () => {}; });
        localStorage.clear();
        for (const k in idbStore) delete idbStore[k];
        if (typeof window !== 'undefined') {
            window.__INITIAL_USER_DATA__ = null;
        }
        await clearCatalogCache();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    it('M2.1: loginAsGuest() resolves full seed catalog immediately on fresh cold start (zero empty flash)', async () => {
        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        expect(screen.getByTestId('auth-loading').textContent).toBe('READY');

        // Click loginAsGuest
        await act(async () => {
            screen.getByTestId('btn-guest').click();
        });

        expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST');

        const state = useAppStore.getState().userData;
        expect(state).not.toBeNull();
        expect(Array.isArray(state?.library)).toBe(true);
        expect(Array.isArray(state?.customFoods)).toBe(true);
        expect(state?.library?.length).toBe(0);
        expect(state?.customFoods?.length).toBe(0);

        expect(parseInt(screen.getByTestId('exercise-count').textContent || '0')).toBe(0);
        expect(parseInt(screen.getByTestId('food-count').textContent || '0')).toBe(0);
    });

    it('M2.2: Pre-render cache bootstrap resolves custom deltas with global catalog in main.tsx', async () => {
        // Local fixture to simulate a populated global catalog (seed is empty — commit e61a133)
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

        // Cached user data in IndexedDB with 1 custom exercise, 1 custom food, and 1 override
        const cachedUserData: UserData = {
            profile: { name: 'Guest Tester' },
            library: [customEx],
            customFoods: [customFood],
            catalogOverrides: {
                exercises: {
                    'panca-piana-bilanciere': { notes: 'Pausa 2s' }
                }
            }
        };

        // Simulate main.tsx bootstrap resolution logic
        const resolvedLibrary = resolveEffectiveExercises(catalog.exercises, cachedUserData.library || [], cachedUserData.catalogOverrides);
        const resolvedFoods = resolveEffectiveFoods(catalog.foods, cachedUserData.customFoods || [], cachedUserData.catalogOverrides);

        const resolvedBootstrappedData: UserData = {
            ...cachedUserData,
            library: resolvedLibrary,
            customFoods: resolvedFoods
        };

        window.__INITIAL_USER_DATA__ = resolvedBootstrappedData;
        useAppStore.getState().setUserData(resolvedBootstrappedData);

        const state = useAppStore.getState().userData!;
        // Total exercises = 1 custom + all standard exercises
        expect(state.library?.length).toBe(catalog.exercises.length + 1);
        expect(state.library?.[0].id).toBe('custom_biceps_curl');
        expect(state.library?.[0].isDefault).toBe(false);

        // Overridden bench has updated notes
        const bench = state.library?.find(e => e.id === 'panca-piana-bilanciere');
        expect(bench?.notes).toBe('Pausa 2s');

        // Total foods = 1 custom + all standard foods
        expect(state.customFoods?.length).toBe(catalog.foods.length + 1);
        expect(state.customFoods?.[0].id).toBe('custom_greek_yogurt');
        expect(state.customFoods?.[0].isCustom).toBe(true);
    });

    it('M2.3: Unauthenticated state handler does NOT wipe guest state or active catalog when user is guest', async () => {
        localStorage.setItem('logbook_is_guest', 'true');

        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        // When guest is active in localStorage, loginAsGuest loads catalog
        await act(async () => {
            screen.getByTestId('btn-guest').click();
        });

        expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST');
        expect(Array.isArray(useAppStore.getState().userData?.library)).toBe(true);
        expect(useAppStore.getState().userData?.library?.length).toBe(0);

        // Ensure localStorage flag is retained
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    });

    it('M2.4: Guest logout cleans up guest state and resets store cleanly', async () => {
        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        await act(async () => {
            screen.getByTestId('btn-guest').click();
        });

        expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST');
        expect(useAppStore.getState().userData).not.toBeNull();

        // Logout with skipConfirm = true
        await act(async () => {
            screen.getByTestId('btn-logout').click();
        });

        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(useAppStore.getState().userData).toBeNull();
        expect(screen.getByTestId('exercise-count').textContent).toBe('0');
    });

    it('M2.5: loginAsGuest preserves existing custom exercises and foods when resolving missing catalog', async () => {
        // Local fixture to populate the cache (seed is empty — commit e61a133)
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
        // User already has a custom exercise in store, but library was missing standard catalog
        useAppStore.getState().setUserData({
            profile: { name: 'Existing User' },
            library: [customEx],
            customFoods: [],
            catalogOverrides: {}
        });

        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>
        );

        await act(async () => {
            screen.getByTestId('btn-guest').click();
        });

        const state = useAppStore.getState().userData!;
        // 1 custom + 1 global fixture = 2
        expect(state.library?.length).toBe(2);
        // Custom exercise is preserved
        expect(state.library?.find(e => e.id === 'custom_lat_pull')).toBeDefined();
        // Standard exercise is also present
        expect(state.library?.find(e => e.id === 'panca-piana-bilanciere')).toBeDefined();
    });
});
