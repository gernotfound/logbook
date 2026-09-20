import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateId } from '../src/lib/utils/date';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('secure ID generation', () => {
    it('uses crypto.randomUUID when available', () => {
        const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000');
        vi.stubGlobal('crypto', { randomUUID } as unknown as Crypto);

        expect(generateId('actor')).toBe('actor_123e4567-e89b-42d3-a456-426614174000');
        expect(randomUUID).toHaveBeenCalledTimes(1);
    });

    it('uses crypto.getRandomValues to build an RFC 4122 v4 UUID when randomUUID is unavailable', () => {
        const getRandomValues = vi.fn((array: Uint8Array) => {
            for (let index = 0; index < array.length; index++) array[index] = index;
            return array;
        });
        vi.stubGlobal('crypto', { getRandomValues } as unknown as Crypto);

        expect(generateId('actor')).toBe('actor_00010203-0405-4607-8809-0a0b0c0d0e0f');
        expect(getRandomValues).toHaveBeenCalledTimes(1);
    });

    it('fails closed instead of falling back to Math.random or wall-clock entropy', () => {
        const randomSpy = vi.spyOn(Math, 'random');
        vi.stubGlobal('crypto', undefined);

        expect(() => generateId('actor')).toThrow('Generazione ID sicura non disponibile');
        expect(randomSpy).not.toHaveBeenCalled();
    });
});
