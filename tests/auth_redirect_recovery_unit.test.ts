import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachAuthRedirectRecovery } from '../src/contexts/auth/attachAuthRedirectRecovery';

describe('isolated foreground redirect recovery', () => {
    const detachAll: Array<() => void> = [];
    afterEach(() => {
        for (const detach of detachAll.splice(0)) detach();
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
