import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedIdentitySource, matchesAuthenticatedOwner } from './authenticatedIdentitySource';

describe('provider-neutral authenticated identity source', () => {
    it('is signed-out until an explicit provider reader is registered', () => {
        const source = createAuthenticatedIdentitySource();
        expect(source.readUid()).toBeNull();
        const state: { uid: string } = { uid: 'k_' + 'A'.repeat(43) };
        const read = vi.fn(() => state);
        const dispose = source.install(read);
        expect(source.readUid()).toBe(state.uid);
        state.uid = 'k_' + 'B'.repeat(43);
        expect(source.readUid()).toBe(state.uid);
        expect(read).toHaveBeenCalledTimes(2);
        dispose();
        expect(source.readUid()).toBeNull();
    });

    it('refuses a second provider and cannot dispose the active source with an old disposer', () => {
        const source = createAuthenticatedIdentitySource();
        const first = () => ({ uid: 'account-a' });
        const release = source.install(first);
        expect(() => source.install(() => ({ uid: 'account-b' }))).toThrow();
        expect(source.readUid()).toBe('account-a');
        release();
        source.install(() => ({ uid: 'account-b' }));
        release();
        expect(source.readUid()).toBe('account-b');
    });

    it('keeps a shared provider installed until the final mount releases its lease', () => {
        const source = createAuthenticatedIdentitySource();
        const read = () => ({ uid: 'provider-a' });
        const first = source.install(read);
        const second = source.install(read);
        expect(source.readUid()).toBe('provider-a');
        first();
        expect(source.readUid()).toBe('provider-a');
        expect(() => source.install(() => ({ uid: 'provider-b' }))).toThrow();
        second();
        expect(source.readUid()).toBeNull();
        const third = source.install(() => ({ uid: 'provider-b' }));
        first();
        expect(source.readUid()).toBe('provider-b');
        third();
        expect(source.readUid()).toBeNull();
    });

    it('fails closed on malformed identity and reader errors rather than falling back to an old UID', () => {
        for (const identity of [
            undefined, false, {}, { uid: '' }, { uid: 'other/owner' },
            { uid: 123 },
        ]) {
            const source = createAuthenticatedIdentitySource();
            source.install(() => identity as { uid: unknown });
            expect(() => source.readUid()).toThrow('Identità autenticata non valida');
        }
        const source = createAuthenticatedIdentitySource();
        source.install(() => { throw Error('provider-unavailable'); });
        expect(() => source.readUid()).toThrow('provider-unavailable');
    });

    it('does not infer identity from a stale last-known provider object', () => {
        const source = createAuthenticatedIdentitySource();
        let identity: { uid: string } | null = { uid: 'account-a' };
        source.install(() => identity);
        expect(source.readUid()).toBe('account-a');
        identity = null;
        expect(source.readUid()).toBeNull();
    });
});

describe('account journal resume owner fence', () => {
    it('supports a Kinde UID through a provider-neutral reader, without guest fallback', () => {
        const source = createAuthenticatedIdentitySource();
        const state: { uid: string } = { uid: 'k_' + 'A'.repeat(43) };
        const dispose = source.install(() => state);
        const same = () => source.readUid();
        expect(matchesAuthenticatedOwner('user:' + state.uid, same)).toBe(true);
        expect(matchesAuthenticatedOwner('guest', same)).toBe(false);
        expect(matchesAuthenticatedOwner('user:', same)).toBe(false);
        expect(matchesAuthenticatedOwner('user:k_' + 'B'.repeat(43), same)).toBe(false);
        state.uid = 'k_' + 'B'.repeat(43);
        expect(matchesAuthenticatedOwner('user:k_' + 'A'.repeat(43), same)).toBe(false);
        expect(matchesAuthenticatedOwner('user:' + state.uid, same)).toBe(true);
        dispose();
        expect(matchesAuthenticatedOwner('user:' + state.uid, same)).toBe(false);
    });
    it('refuses absent, malformed and throwing identity readers', () => {
        for (const reader of [
            () => null,
            () => { throw new Error('provider-unavailable'); },
            () => { throw new Error('storage-unreadable'); },
        ]) expect(matchesAuthenticatedOwner('user:owner-a', reader)).toBe(false);
        expect(matchesAuthenticatedOwner('user:owner-a', () => 'owner-b')).toBe(false);
    });
});
