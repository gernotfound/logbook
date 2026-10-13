import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, renderHook, fireEvent, act, waitFor } from '@testing-library/react';
import App from '../src/App';
import HeaderDashboard from '../src/components/Home/widgets/HeaderDashboard';
import { defaultMockUserData, renderWithProviders } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { LEGAL_VERSIONS } from '../src/lib/legalVersions';
import { 
    AppTabSchema, 
    MainTabSchema, 
    TrainingSubTabSchema, 
    NutritionSubTabSchema, 
    DataSubTabSchema 
} from '../src/lib/schema';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
import { LOCAL_STORAGE_ACTIVE_TAB, LOCAL_STORAGE_TRAINING_TAB } from '../src/constants';
import { ownerUiPreferenceKey } from '../src/lib/uiPreferenceKeys';
import { refreshHealthConsent } from '../src/lib/healthConsent';
const accountTabKey = ownerUiPreferenceKey('user:test-user-id', LOCAL_STORAGE_ACTIVE_TAB);

describe('R4: Tab Zod Schema & LocalStorage Fallback Resilience (ARCH-05)', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        vi.clearAllMocks();
        await prepareUnlockedTestArchive();
    });

    describe('Zod Schema Unit Validation', () => {
        it('validates all valid AppTab / MainTab values', () => {
            const validTabs = ['home', 'training', 'nutrition', 'data'] as const;
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
                'settings',
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
            const valid = ['measurements', 'sleep', 'activity', 'biometry', 'history'];
            for (const sub of valid) {
                expect(DataSubTabSchema.safeParse(sub).success).toBe(true);
            }
            expect(DataSubTabSchema.safeParse('context').success).toBe(false);
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
        it('issues only one consent check when focus returns to a mounted App', async () => {
            renderWithProviders(<App />);
            await screen.findByRole('button', { name: /^home$/i });
            const beforeFocus = vi.mocked(refreshHealthConsent).mock.calls.length;
            await act(async () => { window.dispatchEvent(new Event('focus')); });
            await waitFor(() => expect(vi.mocked(refreshHealthConsent).mock.calls.length).toBe(beforeFocus + 1));
        });

        it('never adopts legacy or another account navigation preferences', async () => {
            window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_TAB, JSON.stringify('training'));
            window.localStorage.setItem(LOCAL_STORAGE_TRAINING_TAB, JSON.stringify('exercises'));
            window.localStorage.setItem(ownerUiPreferenceKey('user:other-account', LOCAL_STORAGE_ACTIVE_TAB), JSON.stringify('training'));
            window.localStorage.setItem(ownerUiPreferenceKey('user:other-account', LOCAL_STORAGE_TRAINING_TAB), JSON.stringify('exercises'));

            renderWithProviders(<App />);
            const home = await screen.findByRole('button', { name: /^home$/i });
            expect(home.classList.contains('active')).toBe(true);
            fireEvent.click(screen.getByRole('button', { name: /allenamento/i }));
            const session = await screen.findByRole('tab', { name: 'Sessione' });
            expect(session.getAttribute('aria-selected')).toBe('true');
            expect(window.localStorage.getItem(ownerUiPreferenceKey('user:test-user-id', LOCAL_STORAGE_TRAINING_TAB))).toBe(JSON.stringify('session'));
        });

        it('falls back to "home" tab when localStorage has a corrupted tab string', async () => {
            window.localStorage.setItem(accountTabKey, JSON.stringify('corrupted_tab_xyz'));
            
            renderWithProviders(<App />);

            const homeBtn = await screen.findByRole('button', { name: /home/i });
            expect(homeBtn.classList.contains('active')).toBe(true);
        });

        it('falls back to "home" tab when localStorage has an empty string or invalid JSON', async () => {
            window.localStorage.setItem(accountTabKey, JSON.stringify(''));
            
            renderWithProviders(<App />);

            const homeBtn = await screen.findByRole('button', { name: /home/i });
            expect(homeBtn.classList.contains('active')).toBe(true);
        });

        it('preserves valid primary tab when localStorage is valid', async () => {
            window.localStorage.setItem(accountTabKey, JSON.stringify('training'));
            
            renderWithProviders(<App />);

            const trainingBtn = await screen.findByRole('button', { name: /^allenamento$/i });
            expect(trainingBtn.classList.contains('active')).toBe(true);
        });

        it('falls back to Home when localStorage contains the legacy settings tab', async () => {
            window.localStorage.setItem(accountTabKey, JSON.stringify('settings'));
            
            renderWithProviders(<App />);

            const homeBtn = await screen.findByRole('button', { name: /^home$/i });
            expect(homeBtn.classList.contains('active')).toBe(true);
            expect(screen.queryByRole('button', { name: /^impostazioni$/i })).toBeNull();
        });

        it('opens the legacy settings shortcut as a secondary Home surface while keeping Home active', async () => {
            window.history.replaceState({}, '', '/?tab=settings');
            renderWithProviders(<App />, {
                userData: {
                    ...defaultMockUserData,
                    legalConsent: {
                        hasAcceptedTerms: true,
                        hasAcceptedHealthData: true,
                        acceptedAt: '2026-09-30T00:00:00.000Z',
                        privacyVersion: LEGAL_VERSIONS.privacy,
                        termsVersion: LEGAL_VERSIONS.terms,
                    },
                },
            });

            expect(await screen.findByRole('heading', { name: 'Impostazioni' }, { timeout: 5000 })).toBeDefined();
            expect(screen.getByRole('button', { name: /^home$/i }).classList.contains('active')).toBe(true);
        });

        it('makes a settings PWA shortcut override a previously saved training tab at startup', async () => {
            window.localStorage.setItem(accountTabKey, JSON.stringify('training'));
            window.history.replaceState({}, '', '/?tab=settings');

            renderWithProviders(<App />, {
                userData: {
                    ...defaultMockUserData,
                    legalConsent: {
                        hasAcceptedTerms: true,
                        hasAcceptedHealthData: true,
                        acceptedAt: '2026-09-30T00:00:00.000Z',
                        privacyVersion: LEGAL_VERSIONS.privacy,
                        termsVersion: LEGAL_VERSIONS.terms,
                    },
                },
            });

            expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeDefined();
            expect(screen.getByRole('button', { name: /^home$/i }).classList.contains('active')).toBe(true);
            expect(window.localStorage.getItem(accountTabKey)).toBe(JSON.stringify('home'));
            expect(window.location.search).toBe('');
        });

        it('exposes the settings control in the Home header', () => {
            const onOpenSettings = vi.fn();
            renderWithProviders(<HeaderDashboard streak={3} totalWorkouts={12} onOpenSettings={onOpenSettings} />);

            fireEvent.click(screen.getByRole('button', { name: 'Apri impostazioni' }));
            expect(onOpenSettings).toHaveBeenCalledTimes(1);
        });
    });
});

