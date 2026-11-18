import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedIdentitySource } from './authenticatedIdentitySource';

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
