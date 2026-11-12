import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../../../src/hooks/useLocalStorage';
import { z } from 'zod';

describe('Local storage hostile payloads', () => {
    describe('R4 Adversarial: useLocalStorage Hostile & Corrupted Payloads', () => {
        beforeEach(() => {
            window.localStorage.clear();
            vi.clearAllMocks();
        });

        afterEach(() => {
            window.localStorage.clear();
            vi.restoreAllMocks();
        });

        const adversarialCorruptInputs: { label: string; payload: string }[] = [
            // 1. Unquoted plain strings
            { label: 'plain unquoted alphanumeric', payload: 'dashboard_tab' },
            { label: 'plain unquoted with symbols', payload: 'user:session:12345!@#' },
            { label: 'unquoted keyword undefined', payload: 'undefined' },
            { label: 'unquoted keyword NaN', payload: 'NaN' },
            { label: 'unquoted keyword Infinity', payload: 'Infinity' },
            { label: 'unquoted keyword -Infinity', payload: '-Infinity' },
            { label: 'unquoted Object toString', payload: '[object Object]' },

            // 2. Syntax errors and broken JSON structures
            { label: 'unclosed curly brace', payload: '{"active": true, "name": "workout"' },
            { label: 'unclosed square bracket', payload: '[1, 2, 3, {"incomplete": ' },
            { label: 'single-quoted JSON (invalid standard JSON)', payload: "{'theme': 'dark'}" },
            { label: 'trailing comma in object', payload: '{"key": "val",}' },
            { label: 'trailing comma in array', payload: '[1, 2, 3,]' },
            { label: 'sparse array representation', payload: '[1,,2]' },
            { label: 'unquoted key names', payload: '{name: "John", age: 30}' },
            { label: 'missing value in key-value', payload: '{"key": }' },
            { label: 'unclosed string literal', payload: '"hello world without closing quote' },

            // 3. HTML / Injection vectors
            { label: 'XSS script tag unquoted', payload: '<script>alert("hacked")</script>' },
            { label: 'SQL-like injection unquoted', payload: "1; DROP TABLE logs; --" },
            { label: 'Javascript expression unquoted', payload: 'function() { return 42; }()' },

            // 4. Corrupted unicode and binary control characters
            { label: 'unpaired high surrogate', payload: '\uD800' },
            { label: 'unpaired low surrogate', payload: '\uDFFF' },
            { label: 'binary control bytes (0x00-0x05)', payload: '\x00\x01\x02\x03\x04\x05' },
            { label: 'escape control characters', payload: '\x1B[31mRedText\x1B[0m' },

            // 5. Whitespace-only corrupt payloads
            { label: 'space-only string "   "', payload: '   ' },
            { label: 'newlines and tabs "\\n\\t\\r"', payload: '\n\t\r' }
        ];

        // Parsing depends on the raw JSON, not the erased TypeScript fallback type.
        // Exercise each hostile input once and rotate all four fallback shapes.
        const fallbackCases = [
            { name: 'String', value: 'STRICT_SAFE_DEFAULT' },
            { name: 'Object', value: { safe: true, count: 100, tags: ['a', 'b'] } },
            { name: 'Array', value: ['item1', 'item2'] },
            { name: 'Number', value: 42 },
        ];

        for (const [index, { label, payload }] of adversarialCorruptInputs.entries()) {
            const fallback = fallbackCases[index % fallbackCases.length];
            it(`CORRUPTION MATRIX [${fallback.name} fallback]: rejects ${label} and preserves the fallback`, () => {
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                const testKey = `corrupt_test_${index}`;
                window.localStorage.setItem(testKey, payload);

                const schema = z.union([
                    z.string(), z.number(), z.array(z.string()),
                    z.object({ safe: z.boolean(), count: z.number(), tags: z.array(z.string()) }),
                ]);
                const { result } = renderHook(() => useLocalStorage(testKey, fallback.value, schema));

                expect(result.current[0]).toEqual(fallback.value);
                expect(consoleErrorSpy).toHaveBeenCalledWith(
                    expect.stringContaining(`Errore di parsing del localStorage key "${testKey}":`),
                    expect.any(Error)
                );
                expect(window.localStorage.getItem(testKey)).toBe(JSON.stringify(fallback.value));
            });
        }

        it('SELF-HEALING: updates to corrupt key cleanly overwrite corrupt raw payload with valid JSON string', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const testKey = 'healing_corrupted_key';
            // Start with corrupt payload
            window.localStorage.setItem(testKey, 'bad_unquoted_value');

            const { result } = renderHook(() => useLocalStorage<string>(testKey, 'initial_default', z.string()));
            expect(result.current[0]).toBe('initial_default');

            // Call setter with new valid value
            act(() => {
                result.current[1]('healed_valid_value');
            });

            expect(result.current[0]).toBe('healed_valid_value');
            // The item in localStorage MUST now be properly serialized JSON
            expect(window.localStorage.getItem(testKey)).toBe(JSON.stringify('healed_valid_value'));

            // Re-render hook from clean storage: should parse without error
            consoleErrorSpy.mockClear();
            const { result: reloadedResult } = renderHook(() => useLocalStorage<string>(testKey, 'fallback_tab', z.string()));
            expect(reloadedResult.current[0]).toBe('healed_valid_value');
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
    });
});
