import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, renderHook, fireEvent } from '@testing-library/react';
import App from '../src/App';
import { renderWithProviders } from './setup';
import { AppTabSchema, MainTabSchema, TrainingSubTabSchema, NutritionSubTabSchema, DataSubTabSchema } from '../src/lib/schema';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
import { LOCAL_STORAGE_ACTIVE_TAB } from '../src/constants';

describe('R4: Tab Zod Schema & LocalStorage Fallback Resilience (ARCH-05)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState({}, '', '/');
        vi.clearAllMocks();
    });

    describe('Zod Schema Unit Validation', () => {
        it('validates all valid AppTab / MainTab values', () => {
            const validTabs = ['home', 'training', 'nutrition', 'data'] as const;
            for (const tab of validTabs) {
                expect(AppTabSchema.safeParse(tab).success).toBe(true);
                expect(MainTabSchema.safeParse(tab).success).toBe(true);
            }
        });

        it('rejects invalid, corrupted, and legacy settings AppTab values', () => {
            const invalidValues = ['', 'corrupted_tab', 'dashboard', 'settings', 123, null, undefined, {}, [], true, 'HOME', ' Training'];
            for (const val of invalidValues) expect(AppTabSchema.safeParse(val).success).toBe(false);
        });

        it('validates sub-tab schemas correctly', () => {
            for (const sub of ['session', 'planning', 'routines', 'exercises', 'history']) expect(TrainingSubTabSchema.safeParse(sub).success).toBe(true);
            for (const sub of ['meals', 'planning', 'archive', 'history', 'supplements']) expect(NutritionSubTabSchema.safeParse(sub).success).toBe(true);
            for (const sub of ['measurements', 'sleep', 'activity', 'context', 'biometry', 'history']) expect(DataSubTabSchema.safeParse(sub).success).toBe(true);
        });
    });

    describe('useLocalStorage Hook with Schema Validation', () => {
        it('returns default initialValue for invalid values and preserves valid main tabs', () => {
            window.localStorage.setItem('test_tab_key', JSON.stringify('settings'));
            expect(renderHook(() => useLocalStorage('test_tab_key', 'home', AppTabSchema)).result.current[0]).toBe('home');
            window.localStorage.setItem('test_tab_key_2', JSON.stringify('training'));
            expect(renderHook(() => useLocalStorage('test_tab_key_2', 'home', AppTabSchema)).result.current[0]).toBe('training');
        });
    });

    describe('App navigation compatibility', () => {
        it('falls back to Home when a legacy settings tab is stored', async () => {
            window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_TAB, JSON.stringify('settings'));
            renderWithProviders(<App />);
            const homeBtn = await screen.findByRole('button', { name: /^home$/i });
            expect(homeBtn.classList.contains('active')).toBe(true);
            expect(screen.queryByRole('button', { name: /^Impostazioni$/i })).toBeNull();
            expect(await screen.findByRole('button', { name: 'Apri impostazioni' })).toBeDefined();
        });

        it('opens settings from Home while keeping Home active', async () => {
            renderWithProviders(<App />);
            fireEvent.click(await screen.findByRole('button', { name: 'Apri impostazioni' }));
            expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeDefined();
            expect(screen.getByRole('button', { name: /^home$/i }).classList.contains('active')).toBe(true);
        });
    });
});
