import { describe, expect, it } from 'vitest';
import {
    LocalCiphertextError, openLocalJson, openLocalText, sealLocalJson, sealLocalText,
    SEALED_LOCAL_PREFIX,
} from '../src/lib/sync/secureArchiveCipher';

const key = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
const owner = 'user:local-crypt-test';
const archive = 'logbook:v2:user:local-crypt-test';

describe('secure archive ciphertext primitive', () => {

    it('opens a fixed interoperable XChaCha20-Poly1305 sealed-v1 record', () => {
        // Independent HChaCha20 + IETF ChaCha20-Poly1305 reference fixture:
        // key bytes 0..31, nonce bytes 0..23, UTF-8 plaintext and owner/key/version AAD.
        // A stable fixture catches regressions hidden by same-version round trips.
        const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index);
        const sealed = 'tlb-sealed:v1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYX.8qdoHvOrrctdJ1S3uybNjGsjWsSboj0b4IiVKxA-zZ2e6lgaeByW1sTeTw';
        expect(openLocalText(dataKey, owner, archive, sealed)).toBe('legacy encrypted draft 💪');
        expect(() => openLocalText(dataKey, 'user:other', archive, sealed)).toThrow(LocalCiphertextError);
        expect(() => openLocalText(dataKey, owner, archive + ':other', sealed)).toThrow(LocalCiphertextError);
        expect(() => openLocalText(new Uint8Array(32), owner, archive, sealed)).toThrow(LocalCiphertextError);
    });

    it('round-trips typed UTF-8 JSON without storing plaintext', () => {
        const sensitive = { weight: '75', averageHeartRate: '143', notes: 'allenamento 💪', pending: [{ seq: 1 }] };
        const original = key();
        const sealed = sealLocalJson(original, owner, archive, sensitive);
        expect(sealed.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
        // Base64url ciphertext can coincidentally contain short numeric sequences.
        // Assert no serialized plaintext fragment rather than a random collision.
        expect(sealed).not.toContain('"averageHeartRate":"143"');
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

    it('decodes a stable independent XChaCha20-Poly1305 reference fixture', () => {
        // Nonce 00..17 and key 00..1f, with the archive owner/key as AAD.
        // This pinned ciphertext is independent of noble/ciphers runtime output
        // and must remain readable across cipher-library upgrades.
        const legacyKey = Uint8Array.from({ length: 32 }, (_, index) => index);
        const fixedCiphertext = 'tlb-sealed:v1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYX.5eBhEOS3_owJZkqrrDPLkWsiRsaPr22fGn4fxFjOmis6JkZ7zuzm3Fq3gnunRDIQBeiDLSJWwSgzrO79x3Pk7MKhHM2UQC_2bIs8';
        const original = '{"notes":"legacy encrypted record 🏋️","heartRate":147}';
        expect(openLocalText(legacyKey, owner, archive, fixedCiphertext)).toBe(original);
        expect(openLocalJson(legacyKey, owner, archive, fixedCiphertext)).toEqual({
            notes: 'legacy encrypted record 🏋️', heartRate: 147,
        });
        expect(() => openLocalText(legacyKey, owner, archive + ':other', fixedCiphertext)).toThrow(LocalCiphertextError);
        expect(() => openLocalText(legacyKey, 'user:other-owner', archive, fixedCiphertext)).toThrow(LocalCiphertextError);
        expect(() => openLocalText(new Uint8Array(32), owner, archive, fixedCiphertext)).toThrow(LocalCiphertextError);
        const tampered = fixedCiphertext.slice(0, -2) + (fixedCiphertext.endsWith('8') ? '9' : '8');
        expect(() => openLocalText(legacyKey, owner, archive, tampered)).toThrow(LocalCiphertextError);
    });
});
