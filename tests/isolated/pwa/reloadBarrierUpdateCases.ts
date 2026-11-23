import { it, expect, vi } from 'vitest';
import type { ReloadSuiteContext } from './reloadBarrier.test';

export function registerReloadUpdateCases(ctx: ReloadSuiteContext): void {
    const { app, clear, get, set, prepareForReload, isReloadSessionCurrent, safeHardReload, requiredUpdateHardReload, invalidateSession, BrowserStorageError, deviceKey, protectedDeviceKey, readDeviceValueStrict, requireUnlockedLocalKey, openLocalJson, sealLocalJson } = ctx;

    it('updates from the login screen without an active guest session or deleting an account archive', async () => {
        const existing = await get('logbook:v2:user:a');
        app.auth.currentUser = null as any;
        app.state = { userData: null, localWorkout: null, dataOwner: null };
        const reload = vi.fn();
    
        await safeHardReload(reload);
    
        expect(reload).toHaveBeenCalledTimes(1);
        expect(app.flush).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:a')).toEqual(existing);
        expect(ctx.disk.has('logbook_is_guest')).toBe(false);
    });
    
    it('allows a signed-out update with no identity reader even when the legacy SDK retains a stale UID', async () => {
        const existing = await get('logbook:v2:user:a');
        ctx.releaseIdentity();
        app.state = { userData: null, localWorkout: null, dataOwner: null };
        const reload = vi.fn();
    
        await safeHardReload(reload);
    
        expect(app.auth.currentUser?.uid).toBe('a');
        expect(reload).toHaveBeenCalledOnce();
        expect(app.flush).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:a')).toBe(existing);
    });
    
    it('keeps the reload blocked if the login screen still holds unowned business data', async () => {
        app.auth.currentUser = null as any;
        const reload = vi.fn();
    
        await expect(safeHardReload(reload)).rejects.toThrow('Sessione cambiata');
        expect(reload).not.toHaveBeenCalled();
    });
    
    it('does not treat a revoked guest marker as a safe login-screen update', async () => {
        app.auth.currentUser = null as any;
        app.state = { userData: null, localWorkout: null, dataOwner: null };
        ctx.disk.set('logbook_is_guest', 'true');
        ctx.disk.set('logbook_guest_revoked_v1', 'revoked');
        const reload = vi.fn();
    
        await expect(safeHardReload(reload)).rejects.toThrow('Sessione cambiata');
        expect(reload).not.toHaveBeenCalled();
    });
    
    it('fences a login-screen update if the session changes after preparation', async () => {
        app.auth.currentUser = null as any;
        app.state = { userData: null, localWorkout: null, dataOwner: null };
        const prepared = await prepareForReload();
        invalidateSession();
        expect(isReloadSessionCurrent(prepared)).toBe(false);
    });
    

    it('allows required-update recovery on the signed-out screen without touching an existing account vault', async () => {
        const existing = await get('logbook:v2:user:a');
        app.auth.currentUser = null as any;
        app.state = { userData: null, localWorkout: null, dataOwner: null };
        const reload = vi.fn();

        await requiredUpdateHardReload(reload);

        expect(reload).toHaveBeenCalledOnce();
        expect(await get('logbook:v2:user:a')).toEqual(existing);
        expect(app.flush).not.toHaveBeenCalled();
        expect(ctx.disk.has('logbook_is_guest')).toBe(false);
    });

    it('still blocks signed-out required-update recovery after a session epoch change during service worker inspection', async () => {
        const existing = await get('logbook:v2:user:a');
        app.auth.currentUser = null as any;
        app.state = { userData: null, localWorkout: null, dataOwner: null };
        vi.stubGlobal('navigator', { serviceWorker: {
            getRegistration: vi.fn(async () => {
                invalidateSession();
                return undefined;
            }),
            controller: null,
        } });
        const reload = vi.fn();

        await expect(requiredUpdateHardReload(reload)).rejects.toThrow('Sessione cambiata');
        expect(reload).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:a')).toEqual(existing);
    });

    it('hard reloads only after the durable reload barrier succeeds', async () => {
        app.flush.mockRejectedValue(new Error('offline'));
        const reload = vi.fn(() => {
            expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toMatch(/^tlb-sealed:/);
            expect(readDeviceValueStrict('workout', 'user:a')).not.toBeNull();
        });
        await safeHardReload(reload);
        expect(app.flush).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });
    
    it('never hard reloads when the durable reload barrier rejects', async () => {
        await clear();
        app.flush.mockRejectedValue(new Error('offline'));
        const reload = vi.fn();
        await expect(safeHardReload(reload)).rejects.toThrow('non sono ancora salvate');
        expect(reload).not.toHaveBeenCalled();
    });
    
    it('reloads an update-required app without parsing a future local envelope and preserves the active workout snapshot', async () => {
        const archiveKey = 'logbook:v2:user:a';
        const sealed = await get<string>(archiveKey);
        expect(sealed).toMatch(/^tlb-sealed:/);
        const key = requireUnlockedLocalKey('user:a');
        const raw = openLocalJson(key, 'user:a', archiveKey, sealed!) as Record<string, unknown>;
        await set(archiveKey, sealLocalJson(key, 'user:a', archiveKey, { ...raw, dataSchemaVersion: 99 }));
    
        await expect(prepareForReload()).rejects.toThrow(/aggiorna TheLogBook/i);
    
        const reload = vi.fn();
        await requiredUpdateHardReload(reload);
    
        expect(reload).toHaveBeenCalledTimes(1);
        expect(JSON.parse(readDeviceValueStrict('workout', 'user:a')!)).toMatchObject({
            __logbookWorkoutSnapshot: 1, owner: 'user:a', consentRevision: 1,
            workout: app.state.localWorkout,
        });
        expect(ctx.disk.has(deviceKey('workout', 'user:a'))).toBe(false);
        expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toMatch(/^tlb-sealed:/);
    });
    
    it('waits for the replacement service worker to install before a required-update reload', async () => {
        const worker = Object.assign(new EventTarget(), {
            state: 'installing' as ServiceWorkerState,
            postMessage: vi.fn(),
        });
        const stateListener = vi.spyOn(worker, 'addEventListener');
        const registration = {
            waiting: null as ServiceWorker | null,
            installing: worker as unknown as ServiceWorker,
            update: vi.fn(async () => undefined),
        };
        vi.stubGlobal('navigator', {
            serviceWorker: {
                getRegistration: vi.fn(async () => registration),
                controller: null,
            },
        });
    
        const reload = vi.fn();
        const attempt = requiredUpdateHardReload(reload);
        await vi.waitFor(() => expect(stateListener).toHaveBeenCalledWith('statechange', expect.any(Function)));
        expect(reload).not.toHaveBeenCalled();
    
        registration.waiting = worker as unknown as ServiceWorker;
        worker.state = 'installed';
        worker.dispatchEvent(new Event('statechange'));
        await attempt;
    
        expect(registration.update).toHaveBeenCalledTimes(1);
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(reload).toHaveBeenCalledTimes(1);
    });
    
    it('blocks required-update snapshot when the installed dataset belongs to another owner', async () => {
        app.state.dataOwner = 'guest';
        const reload = vi.fn();
    
        await expect(requiredUpdateHardReload(reload)).rejects.toThrow('non attribuibile');
        expect(reload).not.toHaveBeenCalled();
        expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toBeUndefined();
    });
    
    it('still blocks update-required reload when the device-critical workout snapshot cannot be persisted', async () => {
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        const reload = vi.fn();
    
        await expect(requiredUpdateHardReload(reload)).rejects.toBeInstanceOf(BrowserStorageError);
        expect(reload).not.toHaveBeenCalled();
    });
    
    it('rejects a required-update reload if identity changes while the new Service Worker installs', async () => {
        const worker = Object.assign(new EventTarget(), {
            state: 'installing' as ServiceWorkerState,
            postMessage: vi.fn(),
        });
        const stateListener = vi.spyOn(worker, 'addEventListener');
        const registration = {
            waiting: null as ServiceWorker | null,
            installing: worker as unknown as ServiceWorker,
            update: vi.fn(async () => undefined),
        };
        vi.stubGlobal('navigator', {
            serviceWorker: {
                getRegistration: vi.fn(async () => registration),
                controller: null,
            },
        });
    
        const reload = vi.fn();
        const pending = requiredUpdateHardReload(reload);
        await vi.waitFor(() => expect(stateListener).toHaveBeenCalledWith('statechange', expect.any(Function)));
        const storedWorkout = ctx.disk.get(protectedDeviceKey('workout', 'user:a'));
        expect(storedWorkout).toMatch(/^tlb-sealed:/);
        expect(reload).not.toHaveBeenCalled();
    
        app.auth.currentUser = { uid: 'b' };
        invalidateSession();
        registration.waiting = worker as unknown as ServiceWorker;
        worker.state = 'installed';
        worker.dispatchEvent(new Event('statechange'));
    
        await expect(pending).rejects.toThrow('Sessione cambiata');
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(reload).not.toHaveBeenCalled();
        expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toBe(storedWorkout);
    });
}
