import { describe, expect, it } from 'vitest';
import {
    LocalCiphertextError, openLocalJson, openLocalText, sealLocalJson, sealLocalText,
    SEALED_LOCAL_PREFIX,
} from '../src/lib/sync/secureArchiveCipher';

const key = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
const owner = 'user:local-crypt-test';
const archive = 'logbook:v2:user:local-crypt-test';

describe('secure archive ciphertext primitive', () => {
    it('round-trips typed UTF-8 JSON without storing plaintext', () => {
        const sensitive = { weight: '75', averageHeartRate: '143', notes: 'allenamento 💪', pending: [{ seq: 1 }] };
        const original = key();
        const sealed = sealLocalJson(original, owner, archive, sensitive);
        expect(sealed.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
        expect(sealed).not.toContain('143');
        expect(sealed).not.toContain('allenamento');
        expect(openLocalJson(original, owner, archive, sealed)).toEqual(sensitive);
    });

    it('uses a fresh nonce on each identical write', () => {
        const original = key();
        const left = sealLocalText(original, owner, archive, 'private fitness draft');
        const right = sealLocalText(original, owner, archive, 'private fitness draft');
        expect(left).not.toBe(right);
        expect(openLocalText(original, owner, archive, left)).toBe('private fitness draft');
        expect(openLocalText(original, owner, archive, right)).toBe('private fitness draft');
    });

    it('binds ciphertext authentication to owner and storage key', () => {
        const original = key();
        const sealed = sealLocalText(original, owner, archive, 'private');
        expect(() => openLocalText(original, 'user:another', archive, sealed)).toThrow(LocalCiphertextError);
        expect(() => openLocalText(original, owner, archive + ':draft', sealed)).toThrow(LocalCiphertextError);
        expect(() => openLocalText(key(), owner, archive, sealed)).toThrow(LocalCiphertextError);
    });

    it('fails closed for plaintext, unknown version, malformed payload and edited authenticated data', () => {
        const original = key();
        const sealed = sealLocalText(original, owner, archive, 'private');
        const text = sealed.split('.');
        expect(() => openLocalText(original, owner, archive, 'private')).toThrow(LocalCiphertextError);
        expect(() => openLocalText(original, owner, archive, sealed.replace(SEALED_LOCAL_PREFIX, 'tlb-sealed:v2:'))).toThrow(LocalCiphertextError);
        expect(() => openLocalText(original, owner, archive, 'tlb-sealed:v1:abc.invalid.')).toThrow(LocalCiphertextError);
        expect(() => openLocalText(original, owner, archive, text[0] + '.' + text[1].slice(0, -1) + (text[1].endsWith('A') ? 'B' : 'A'))).toThrow(LocalCiphertextError);
        expect(() => openLocalText(original, owner, archive, sealed.slice(0, -9))).toThrow(LocalCiphertextError);
    });

    it('refuses unsupported key material and invalid record identity', () => {
        expect(() => sealLocalText(new Uint8Array(31), owner, archive, 'private')).toThrow();
        expect(() => sealLocalText(key(), '', archive, 'private')).toThrow();
        expect(() => sealLocalJson(key(), owner, archive, undefined)).toThrow();
    });
});
