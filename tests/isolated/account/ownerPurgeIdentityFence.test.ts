import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { assertPurgeIdentitySafe } from '../../../src/lib/db/ownerPurgeIdentityFence';

const A = 'k_' + 'A'.repeat(43);
const B = 'k_' + 'B'.repeat(43);

function storage(values: Record<string, string> = {}) {
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => values[key] ?? null,
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('provider-neutral local purge ownership fence', () => {
    it('rejects a guest purge if a Kinde account is current, even with no Firebase user', () => {
        storage({ logbook_is_guest: 'true' });
        vi.spyOn(authenticatedIdentitySource, 'readUid').mockReturnValue(A);
        expect(() => assertPurgeIdentitySafe('guest', false)).toThrow('Un altro account');
        expect(() => assertPurgeIdentitySafe('guest', true)).toThrow('Un altro account');
    });

    it('rejects stale account purge under a different verified owner', () => {
        storage();
        vi.spyOn(authenticatedIdentitySource, 'readUid').mockReturnValue(B);
        expect(() => assertPurgeIdentitySafe('user:' + A, false)).toThrow('Un altro account');
        expect(() => assertPurgeIdentitySafe('user:' + A, true)).toThrow('Un altro account');
        expect(() => assertPurgeIdentitySafe('user:' + B, false)).not.toThrow();
    });

    it('retains owner-hint and guest-generation fences without a live provider', () => {
        const principal = vi.spyOn(authenticatedIdentitySource, 'readUid').mockReturnValue(null);
        storage({ logbook_authenticated_owner: 'user:' + A });
        expect(() => assertPurgeIdentitySafe('guest', false)).toThrow('Un altro account');
        expect(() => assertPurgeIdentitySafe('user:' + B, false)).toThrow('Un altro account');
        storage({ logbook_is_guest: 'true' });
        expect(() => assertPurgeIdentitySafe('user:' + A, false)).toThrow('Un altro account');
        expect(() => assertPurgeIdentitySafe('guest', true)).toThrow('Un altro account');
        principal.mockReturnValue(null);
        storage();
        expect(() => assertPurgeIdentitySafe('guest', false)).not.toThrow();
    });

    it('fails closed when the provider or owner storage cannot be trusted', () => {
        storage();
        vi.spyOn(authenticatedIdentitySource, 'readUid').mockImplementation(() => {
            throw new Error('identity-unreadable');
        });
        expect(() => assertPurgeIdentitySafe('guest', false)).toThrow('identity-unreadable');
        expect(() => assertPurgeIdentitySafe('user:' + A, false)).toThrow('identity-unreadable');
        vi.restoreAllMocks();
        vi.spyOn(authenticatedIdentitySource, 'readUid').mockReturnValue(null);
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage-blocked'); } });
        expect(() => assertPurgeIdentitySafe('guest', false)).toThrow();
    });
});
