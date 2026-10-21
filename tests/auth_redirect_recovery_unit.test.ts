import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachAuthRedirectRecovery } from '../src/contexts/auth/attachAuthRedirectRecovery';

describe('isolated foreground redirect recovery', () => {
    const detachAll: Array<() => void> = [];
    afterEach(() => {
        for (const detach of detachAll.splice(0)) detach();
        sessionStorage.clear();
        localStorage.clear();
    });

    function setup() {
        const stored = { current: 'true' };
        let listener = () => {};
        const remove = vi.fn(() => { stored.current = ''; return true; });
        const reload = vi.fn(async (): Promise<void> => {});
        const setSaveError = vi.fn();
        const environment = {
            visibility: () => 'visible' as const,
            listen: (callback: () => void) => {
                listener = callback;
                return () => { listener = () => {}; };
            },
            read: () => stored.current || null,
            remove,
            reload,
            getRedirect: () => new Promise<unknown>(() => {}),
        };
        const detach = attachAuthRedirectRecovery({
            awaitingRedirectKey: 'logbook_awaiting_redirect',
            redirectLaunchFailedRef: { current: false },
            setSaveError,
        }, environment);
        detachAll.push(detach);
        return { stored, remove, reload, setSaveError, foreground: () => listener() };
    }

    it('accepts its own confirmed Google redirect even when the Auth callback arrives first', async () => {
        const { beginGuestMigrationIntent, bindGuestMigrationIntentToUser } =
            await import('../src/lib/auth/guestMigrationIntent');
        localStorage.clear();
        sessionStorage.clear();
        const intent = await beginGuestMigrationIntent('merge', 'google');
        const user = { uid: 'redirect-account', email: 'redirect@example.test',
            providerData: [{ providerId: 'google.com' }] } as import('firebase/auth').User;
        let deliver!: (value: unknown) => void;
        const result = new Promise<unknown>(resolve => { deliver = resolve; });
        let marker: string | null = 'true';
        const setSaveError = vi.fn();
        const detach = attachAuthRedirectRecovery({
            awaitingRedirectKey: 'logbook_awaiting_redirect',
            redirectLaunchFailedRef: { current: false },
            setSaveError,
        }, {
            visibility: () => 'hidden',
            listen: () => () => {},
            read: () => marker,
            remove: () => { marker = null; return true; },
            reload: async () => {},
            getRedirect: () => result,
        });
        detachAll.push(detach);
        // Bootstrap observes the authenticated UID before getRedirectResult.
        const binding = bindGuestMigrationIntentToUser(user);
        deliver({ user, providerId: 'google.com' });
        await expect(binding).resolves.toMatchObject({ id: intent.id, boundUid: user.uid });
        await vi.waitFor(() => expect(marker).toBeNull());
        expect(setSaveError).not.toHaveBeenCalled();
    });

    it('keeps guest intact when a null redirect result precedes the Auth callback', async () => {
        const { beginGuestMigrationIntent, bindGuestMigrationIntentToUser } =
            await import('../src/lib/auth/guestMigrationIntent');
        localStorage.clear();
        sessionStorage.clear();
        const intent = await beginGuestMigrationIntent('skip', 'google');
        const setSaveError = vi.fn();
        attachAuthRedirectRecovery({
            awaitingRedirectKey: 'logbook_awaiting_redirect',
            redirectLaunchFailedRef: { current: false },
            setSaveError,
        }, {
            visibility: () => 'hidden',
            listen: () => () => {},
            read: () => 'true',
            remove: () => true,
            reload: async () => {},
            getRedirect: async () => null,
        });
        await vi.waitFor(() => expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('non confermato')));
        const user = { uid: 'redirect-account', providerData: [{ providerId: 'google.com' }] } as import('firebase/auth').User;
        await expect(bindGuestMigrationIntentToUser(user)).rejects.toThrow('Redirect Google non confermato');
        expect(JSON.parse(localStorage.getItem('guest_migration_intent_v1')!)).toMatchObject({
            id: intent.id, policy: 'skip',
        });
    });

    it('does not reload a guest redirect while its own credential proof is pending', async () => {
        const { beginGuestMigrationIntent } = await import('../src/lib/auth/guestMigrationIntent');
        localStorage.clear();
        sessionStorage.clear();
        await beginGuestMigrationIntent('merge', 'google');
        let finish!: (result: unknown) => void;
        const result = new Promise<unknown>(resolve => { finish = resolve; });
        let marker: string | null = 'true';
        let foreground = () => {};
        const remove = vi.fn(() => { marker = null; return true; });
        const reload = vi.fn(async () => {});
        const detach = attachAuthRedirectRecovery({
            awaitingRedirectKey: 'logbook_awaiting_redirect',
            redirectLaunchFailedRef: { current: false },
            setSaveError: vi.fn(),
        }, {
            visibility: () => 'visible',
            listen: handler => { foreground = handler; return () => {}; },
            read: () => marker,
            remove,
            reload,
            getRedirect: () => result,
        });
        detachAll.push(detach);
        foreground();
        await Promise.resolve();
        expect(remove).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        finish(null);
        await vi.waitFor(() => expect(marker).toBeNull());
        expect(reload).not.toHaveBeenCalled();
    });

    it('does not remove a later redirect marker when the startup SDK probe returns null', async () => {
        let marker: string | null = null;
        let complete!: (value: unknown) => void;
        const pending = new Promise<unknown>(resolve => { complete = resolve; });
        const remove = vi.fn(() => { marker = null; return true; });
        const detach = attachAuthRedirectRecovery({
            awaitingRedirectKey: 'logbook_awaiting_redirect',
            redirectLaunchFailedRef: { current: false },
            setSaveError: vi.fn(),
        }, {
            visibility: () => 'hidden',
            listen: () => () => {},
            read: () => marker,
            remove,
            reload: async () => {},
            getRedirect: () => pending,
        });
        detachAll.push(detach);
        // A new login starts after attachAuthRedirectRecovery captured an empty marker.
        marker = 'true';
        complete(null);
        await Promise.resolve();
        await Promise.resolve();
        expect(remove).not.toHaveBeenCalled();
        expect(marker).toBe('true');
    });

    it('consumes the active marker once and calls the safe reload barrier only once', async () => {
        const { stored, remove, reload, foreground } = setup();
        foreground();
        await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
        expect(stored.current).toBe('');
        expect(remove).toHaveBeenCalledOnce();
        foreground();
        expect(reload).toHaveBeenCalledOnce();
    });

    it('reports a rejected reload barrier without reactivating the consumed marker', async () => {
        const { stored, reload, setSaveError, foreground } = setup();
        reload.mockRejectedValueOnce(new Error('Bozza locale non salvata'));
        foreground();
        await vi.waitFor(() => expect(setSaveError).toHaveBeenCalledWith('Bozza locale non salvata'));
        expect(reload).toHaveBeenCalledOnce();
        expect(stored.current).toBe('');
    });

    it('never reloads if the marker cannot be safely removed', async () => {
        const { stored, remove, reload, setSaveError, foreground } = setup();
        remove.mockImplementationOnce(() => false);
        foreground();
        await vi.waitFor(() => expect(setSaveError).toHaveBeenCalledWith(expect.stringContaining('stato locale del dispositivo')));
        expect(stored.current).toBe('true');
        expect(reload).not.toHaveBeenCalled();
    });
});
