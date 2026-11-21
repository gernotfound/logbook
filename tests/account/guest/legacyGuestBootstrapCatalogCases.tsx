import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { LegacyGuestBootstrapContext } from './guest_bootstrap_lifecycle.test';
import type { UserData, Exercise, Food } from '../../../src/types';

export function registerLegacyGuestBootstrapCatalogCases({
    AuthProvider, GuestTestComponent, confirmRealGuestVault, getSeedCatalog,
    getInMemoryCatalog, idbSet, useAppStore, resolveEffectiveExercises,
    resolveEffectiveFoods, saveCatalogToCache, GUEST_SESSION_KEY,
    activateGuestSession,
}: LegacyGuestBootstrapContext): void {
    describe('legacy guest bootstrap, catalog and custom entries', () => {
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
        await confirmRealGuestVault();

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

    it('recovers a persisted global catalog instead of publishing an in-memory empty seed during guest activation', async () => {
        // The prior bootstrap may have exposed a seed after a transient IDB
        // failure. The guest UI must recheck durable cache before using it.
        const seed = getSeedCatalog();
        const persisted = {
            ...seed,
            manifest: { ...seed.manifest, version: 'durable-guest-v7', itemCounts: { exercises: 1, foods: 1 } },
            exercises: [{ id: 'durable-ex', name: 'Esercizio disponibile offline', trackingType: 'weight_reps' as const }],
            foods: [{ id: 'durable-food', name: 'Alimento disponibile offline', kcal: 100, pro: 5, carbs: 15, fat: 2 }],
        };
        await idbSet('logbook_cached_global_catalog', persisted);
        expect(getInMemoryCatalog()?.exercises).toEqual([]);

        render(
            <AuthProvider>
                <GuestTestComponent />
            </AuthProvider>,
        );

        act(() => { screen.getByTestId('btn-guest').click(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST'));
        await waitFor(() => expect(screen.getByTestId('exercise-count').textContent).toBe('1'));
        expect(screen.getByTestId('food-count').textContent).toBe('1');
        expect(useAppStore.getState().userData?.library?.map(item => item.id)).toEqual(['durable-ex']);
        expect(useAppStore.getState().userData?.customFoods?.map(item => item.id)).toEqual(['durable-food']);
    });


    it('M2.2: catalog delta resolvers preserve custom entries and apply overrides', () => {
        const catalog = {
            exercises: [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
            ] as import('../../../src/types').CatalogExercise[],
            foods: [
                { id: 'petto-di-pollo-crudo', name: 'Petto di Pollo Crudo', kcal: 103, pro: 23, carbs: 0, fat: 1.2, isCustom: false }
            ] as import('../../../src/types').CatalogFood[]
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
        await confirmRealGuestVault();

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
        await confirmRealGuestVault();

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

        localStorage.setItem(GUEST_SESSION_KEY, 'fixture-guest');
        localStorage.setItem('logbook_is_guest', 'true');
        activateGuestSession('fixture-guest');
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

        await confirmRealGuestVault();
        await waitFor(() => expect(useAppStore.getState().userData?.library?.length).toBe(2));
        const state = useAppStore.getState().userData!;
        expect(state.library?.find(e => e.id === 'custom_lat_pull')).toBeDefined();
        expect(state.library?.find(e => e.id === 'panca-piana-bilanciere')).toBeDefined();
    });
    });
}
