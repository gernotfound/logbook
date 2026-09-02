import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, renderHook } from '@testing-library/react';
import App from '../src/App';
import { renderWithProviders } from './setup';
import { 
    AppTabSchema, 
    MainTabSchema, 
    TrainingSubTabSchema, 
    NutritionSubTabSchema, 
    DataSubTabSchema 
} from '../src/lib/schema';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
import { LOCAL_STORAGE_ACTIVE_TAB } from '../src/constants';

describe('R4: Tab Zod Schema & LocalStorage Fallback Resilience (ARCH-05)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.clearAllMocks();
    });

    describe('Zod Schema Unit Validation', () => {
        it('validates all valid AppTab / MainTab values', () => {
            const validTabs = ['home', 'training', 'nutrition', 'data', 'settings'] as const;
            for (const tab of validTabs) {
                const parseApp = AppTabSchema.safeParse(tab);
                const parseMain = MainTabSchema.safeParse(tab);
                expect(parseApp.success).toBe(true);
                expect(parseMain.success).toBe(true);
                if (parseApp.success) expect(parseApp.data).toBe(tab);
            }
        });

        it('rejects invalid or corrupted AppTab values', () => {
            const invalidValues = [
                '',
                'corrupted_tab',
                'dashboard',
                123,
                null,
                undefined,
                {},
                [],
                true,
                'HOME',
                ' Training'
            ];

            for (const val of invalidValues) {
                const result = AppTabSchema.safeParse(val);
                expect(result.success).toBe(false);
            }
        });

        it('validates TrainingSubTabSchema correctly', () => {
            const valid = ['session', 'planning', 'routines', 'exercises', 'history'];
            for (const sub of valid) {
                expect(TrainingSubTabSchema.safeParse(sub).success).toBe(true);
            }
            expect(TrainingSubTabSchema.safeParse('invalid_subtab').success).toBe(false);
            expect(TrainingSubTabSchema.safeParse('').success).toBe(false);
            expect(TrainingSubTabSchema.safeParse(123).success).toBe(false);
        });

        it('validates NutritionSubTabSchema correctly', () => {
            const valid = ['meals', 'planning', 'archive', 'history', 'supplements'];
            for (const sub of valid) {
                expect(NutritionSubTabSchema.safeParse(sub).success).toBe(true);
            }
            expect(NutritionSubTabSchema.safeParse('invalid_subtab').success).toBe(false);
            expect(NutritionSubTabSchema.safeParse(null).success).toBe(false);
        });

        it('validates DataSubTabSchema correctly', () => {
            const valid = ['measurements', 'sleep', 'biometry', 'history'];
            for (const sub of valid) {
                expect(DataSubTabSchema.safeParse(sub).success).toBe(true);
            }
            expect(DataSubTabSchema.safeParse('analytics').success).toBe(false);
            expect(DataSubTabSchema.safeParse({}).success).toBe(false);
        });
    });

    describe('useLocalStorage Hook with Schema Validation', () => {
        it('returns default initialValue when localStorage contains invalid tab value', () => {
            window.localStorage.setItem('test_tab_key', JSON.stringify('corrupted_tab_value'));
            const { result } = renderHook(() => useLocalStorage('test_tab_key', 'home', AppTabSchema));
            expect(result.current[0]).toBe('home');
        });

        it('returns default initialValue when localStorage contains non-string JSON', () => {
            window.localStorage.setItem('test_tab_key', JSON.stringify(12345));
            const { result } = renderHook(() => useLocalStorage('test_tab_key', 'home', AppTabSchema));
            expect(result.current[0]).toBe('home');
        });

        it('returns stored valid value when localStorage contains valid tab name', () => {
            window.localStorage.setItem('test_tab_key', JSON.stringify('training'));
            const { result } = renderHook(() => useLocalStorage('test_tab_key', 'home', AppTabSchema));
            expect(result.current[0]).toBe('training');
        });
    });

    describe('App Component Fallback on Corrupted LocalStorage', () => {
        it('falls back to "home" tab when localStorage has a corrupted tab string', async () => {
            window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_TAB, JSON.stringify('corrupted_tab_xyz'));
            
            renderWithProviders(<App />);

            const homeBtn = await screen.findByRole('button', { name: /home/i });
            expect(homeBtn.classList.contains('active')).toBe(true);
        });

        it('falls back to "home" tab when localStorage has an empty string or invalid JSON', async () => {
            window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_TAB, JSON.stringify(''));
            
            renderWithProviders(<App />);

            const homeBtn = await screen.findByRole('button', { name: /home/i });
            expect(homeBtn.classList.contains('active')).toBe(true);
        });

        it('preserves valid tab when localStorage is valid', async () => {
            window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_TAB, JSON.stringify('settings'));
            
            renderWithProviders(<App />);

            const settingsBtn = await screen.findByRole('button', { name: /impostazioni/i });
            expect(settingsBtn.classList.contains('active')).toBe(true);
        });
    });
});

