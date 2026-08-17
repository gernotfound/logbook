import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { z } from 'zod';
import { useLocalStorage } from '../src/hooks/useLocalStorage';

describe('R4: useLocalStorage Safe Fallback & Strict Serialization Suite', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    describe('Valid JSON Retrieval', () => {
        it('returns initialValue when localStorage item is null (key not present)', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error');
            const { result } = renderHook(() => useLocalStorage('test_key_null', 'default_tab'));

            expect(result.current[0]).toBe('default_tab');
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('returns parsed string when localStorage contains valid JSON string', () => {
            window.localStorage.setItem('test_key_str', JSON.stringify('history'));

            const { result } = renderHook(() => useLocalStorage('test_key_str', 'home'));
            expect(result.current[0]).toBe('history');
        });

        it('returns parsed object when localStorage contains valid JSON object', () => {
            const mockObj = { theme: 'dark', fontSize: 16, enabled: true };
            window.localStorage.setItem('test_key_obj', JSON.stringify(mockObj));

            const { result } = renderHook(() => useLocalStorage('test_key_obj', { theme: 'light', fontSize: 14, enabled: false }));
            expect(result.current[0]).toEqual(mockObj);
        });

        it('returns parsed number and boolean when localStorage contains JSON primitives', () => {
            window.localStorage.setItem('test_key_num', JSON.stringify(42));
            window.localStorage.setItem('test_key_bool', JSON.stringify(true));

            const { result: numResult } = renderHook(() => useLocalStorage('test_key_num', 0));
            const { result: boolResult } = renderHook(() => useLocalStorage('test_key_bool', false));

            expect(numResult.current[0]).toBe(42);
            expect(boolResult.current[0]).toBe(true);
        });

        it('returns parsed array when localStorage contains valid JSON array', () => {
            const mockArr = ['routine_1', 'routine_2', 'routine_3'];
            window.localStorage.setItem('test_key_arr', JSON.stringify(mockArr));

            const { result } = renderHook(() => useLocalStorage<string[]>('test_key_arr', []));
            expect(result.current[0]).toEqual(mockArr);
        });
    });

    describe('Corrupt / Invalid JSON Fallback (Strict Parsing)', () => {
        it('returns initialValue (not corrupted raw string) when localStorage contains plain unquoted string', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            // Writing unquoted plain string "dashboard" (causes SyntaxError on JSON.parse("dashboard"))
            window.localStorage.setItem('logbook_activeTab', 'dashboard');

            const { result } = renderHook(() => useLocalStorage('logbook_activeTab', 'home'));

            // Must strictly return initialValue 'home', NEVER the raw string 'dashboard'
            expect(result.current[0]).toBe('home');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di parsing del localStorage key "logbook_activeTab":'),
                expect.any(Error)
            );
        });

        it('returns initialValue when localStorage contains malformed JSON syntax', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            window.localStorage.setItem('malformed_json_key', '{ name: "invalid", broken: ');

            const { result } = renderHook(() => useLocalStorage('malformed_json_key', { fallback: true }));

            expect(result.current[0]).toEqual({ fallback: true });
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di parsing del localStorage key "malformed_json_key":'),
                expect.any(Error)
            );
        });

        it('returns initialValue when localStorage contains "undefined" literal', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            window.localStorage.setItem('undefined_key', 'undefined');

            const { result } = renderHook(() => useLocalStorage('undefined_key', 'default_val'));

            expect(result.current[0]).toBe('default_val');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('Strict JSON Serialization on Save', () => {
        it('saves state as valid JSON.stringify string on mount and setter updates', () => {
            const { result } = renderHook(() => useLocalStorage('saved_key', 'initial_value'));

            // On initial effect mount, saved value is JSON.stringify("initial_value") -> "\"initial_value\""
            expect(window.localStorage.getItem('saved_key')).toBe(JSON.stringify('initial_value'));

            // Update state
            act(() => {
                result.current[1]('updated_value');
            });

            expect(result.current[0]).toBe('updated_value');
            expect(window.localStorage.getItem('saved_key')).toBe(JSON.stringify('updated_value'));
        });

        it('saves complex objects and arrays as valid JSON strings', () => {
            const initialData = { id: 1, items: ['a', 'b'] };
            const { result } = renderHook(() => useLocalStorage('complex_saved_key', initialData));

            expect(window.localStorage.getItem('complex_saved_key')).toBe(JSON.stringify(initialData));

            const updatedData = { id: 2, items: ['a', 'b', 'c'] };
            act(() => {
                result.current[1](updatedData);
            });

            expect(result.current[0]).toEqual(updatedData);
            expect(window.localStorage.getItem('complex_saved_key')).toBe(JSON.stringify(updatedData));
        });
    });

    describe('Resilience on LocalStorage setItem Errors', () => {
        it('logs console.error and does not crash when localStorage.setItem throws (e.g. QuotaExceededError)', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError: DOM Exception 22');
            });

            const { result } = renderHook(() => useLocalStorage('quota_test_key', 'safe_default'));

            expect(result.current[0]).toBe('safe_default');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di salvataggio nel localStorage key "quota_test_key":'),
                expect.any(Error)
            );

            // Attempting to update should also catch error safely without crashing
            act(() => {
                result.current[1]('new_val');
            });

            expect(result.current[0]).toBe('new_val');
            expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

            setItemSpy.mockRestore();
        });
    });

    describe('Zod Schema Validation (R4)', () => {
        const tabSchema = z.enum(['home', 'training', 'nutrition', 'data', 'settings']);
        const configSchema = z.object({
            theme: z.enum(['dark', 'light']),
            fontSize: z.number().min(10).max(32),
            autoSave: z.boolean()
        });

        it('returns parsed value when stored data passes enum schema validation', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn');
            const consoleErrorSpy = vi.spyOn(console, 'error');

            window.localStorage.setItem('active_tab', JSON.stringify('training'));

            const { result } = renderHook(() => useLocalStorage('active_tab', 'home', tabSchema));

            expect(result.current[0]).toBe('training');
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('returns parsed object when stored data passes complex object schema validation', () => {
            const validConfig = { theme: 'dark' as const, fontSize: 16, autoSave: true };
            window.localStorage.setItem('app_config', JSON.stringify(validConfig));

            const { result } = renderHook(() => useLocalStorage('app_config', { theme: 'light' as const, fontSize: 14, autoSave: false }, configSchema));

            expect(result.current[0]).toEqual(validConfig);
        });

        it('returns initialValue and logs console.warn when stored data violates enum schema', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const consoleErrorSpy = vi.spyOn(console, 'error');

            window.localStorage.setItem('active_tab', JSON.stringify('invalid_tab_name'));

            const { result } = renderHook(() => useLocalStorage('active_tab', 'home', tabSchema));

            expect(result.current[0]).toBe('home');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di validazione schema per localStorage key "active_tab":'),
                expect.any(z.ZodError)
            );
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('returns initialValue and logs console.warn when object schema has invalid types or missing required fields', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            // fontSize is invalid string instead of number, autoSave missing
            const invalidConfig = { theme: 'dark', fontSize: 'sixteen' };
            window.localStorage.setItem('app_config', JSON.stringify(invalidConfig));

            const fallback = { theme: 'light' as const, fontSize: 14, autoSave: false };
            const { result } = renderHook(() => useLocalStorage('app_config', fallback, configSchema));

            expect(result.current[0]).toEqual(fallback);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di validazione schema per localStorage key "app_config":'),
                expect.any(z.ZodError)
            );
        });

        it('supports schemas with transforms and applies them correctly', () => {
            const normalizedStringSchema = z.string().transform(s => s.trim().toLowerCase());
            window.localStorage.setItem('user_input', JSON.stringify('  BENCH_PRESS  '));

            const { result } = renderHook(() => useLocalStorage('user_input', 'default', normalizedStringSchema));

            expect(result.current[0]).toBe('bench_press');
        });

        it('handles syntax errors with console.error before schema validation is reached', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            window.localStorage.setItem('syntax_err_key', '{ invalid JSON syntax }');

            const { result } = renderHook(() => useLocalStorage('syntax_err_key', 'home', tabSchema));

            expect(result.current[0]).toBe('home');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di parsing del localStorage key "syntax_err_key":'),
                expect.any(Error)
            );
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('returns initialValue quietly when key is null even if schema is provided', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn');
            const consoleErrorSpy = vi.spyOn(console, 'error');

            const { result } = renderHook(() => useLocalStorage('missing_key', 'home', tabSchema));

            expect(result.current[0]).toBe('home');
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('allows updating state and persists new validated value to localStorage', () => {
            const { result } = renderHook(() => useLocalStorage('active_tab', 'home', tabSchema));

            expect(result.current[0]).toBe('home');

            act(() => {
                result.current[1]('nutrition');
            });

            expect(result.current[0]).toBe('nutrition');
            expect(window.localStorage.getItem('active_tab')).toBe(JSON.stringify('nutrition'));
        });
    });
});
