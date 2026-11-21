import { it, expect, vi } from 'vitest';
import type { ReloadSuiteContext } from './reloadBarrier.test';

export function registerReloadConsentCases(ctx: ReloadSuiteContext): void {
    const { app, parse, clear, UnverifiedTabSnapshotError, safeHardReload, readLocal, invalidateSession, deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } = ctx;

    it('requires an explicit choice to discard unverified RAM after consent withdrawal', async () => {
        const original = (await readLocal('user:a'))!;
        ctx.disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
        invalidateSession(); // Old tab causality proof no longer belongs to this session.
        app.state.userData = parse(171);
        app.flush.mockRejectedValue(new Error('offline'));
    
        const reload = vi.fn();
        await expect(safeHardReload(reload)).rejects.toBeInstanceOf(UnverifiedTabSnapshotError);
        expect(reload).not.toHaveBeenCalled();
        expect(await readLocal('user:a')).toEqual(original);
    
        await safeHardReload(reload, { discardUnverifiedInMemoryData: true });
        expect(reload).toHaveBeenCalledTimes(1);
        expect(await readLocal('user:a')).toEqual(original);
        expect(app.state.userData).toEqual(original.data);
    });
    
    it('never permits an unverified RAM discard while consent is active', async () => {
        const original = (await readLocal('user:a'))!;
        invalidateSession();
        app.state.userData = parse(171);
        app.flush.mockRejectedValue(new Error('offline'));
        const reload = vi.fn();
    
        await expect(safeHardReload(reload, { discardUnverifiedInMemoryData: true }))
            .rejects.toBeInstanceOf(UnverifiedTabSnapshotError);
        expect(reload).not.toHaveBeenCalled();
        expect(await readLocal('user:a')).toEqual(original);
    });
    
    it('never discards unverified RAM when durable local state is missing', async () => {
        ctx.disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
        invalidateSession();
        await clear();
        app.flush.mockRejectedValue(new Error('offline'));
        const reload = vi.fn();
    
        await expect(safeHardReload(reload, { discardUnverifiedInMemoryData: true }))
            .rejects.toThrow('non sono ancora salvate');
        expect(reload).not.toHaveBeenCalled();
    });
    
    it('keeps storage failures blocking consent-suspended reload even with explicit discard choice', async () => {
        ctx.disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
        invalidateSession();
        app.state.userData = parse(171);
        (app.state as typeof app.state & { localPersistenceBlocked?: boolean }).localPersistenceBlocked = true;
        const reload = vi.fn();
    
        await expect(safeHardReload(reload, { discardUnverifiedInMemoryData: true }))
            .rejects.toThrow('Persistenza locale bloccata');
        expect(reload).not.toHaveBeenCalled();
    });
    
    it('does not erase a stored workout while reloading a consent-suspended screen', async () => {
        const saved = JSON.stringify({ id: 'saved-workout', exercises: [] });
        writeDeviceValue('workout', saved, 'user:a');
        const ciphertext = ctx.disk.get(protectedDeviceKey('workout', 'user:a'));
        ctx.disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
        app.state.localWorkout = null; // Suspended UI has no active RAM workout.
        app.flush.mockRejectedValue(new Error('offline'));
    
        const reload = vi.fn();
        await safeHardReload(reload);
    
        expect(reload).toHaveBeenCalledTimes(1);
        expect(readDeviceValueStrict('workout', 'user:a')).toBe(saved);
        expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toBe(ciphertext);
        expect(ctx.disk.has(deviceKey('workout', 'user:a'))).toBe(false);
    });
    
    it('does not replace an old stored workout when reloading a server-erased local archive', async () => {
        const saved = JSON.stringify({ id: 'old-acknowledged-workout', exercises: [] });
        writeDeviceValue('workout', saved, 'user:a');
        const ciphertext = ctx.disk.get(protectedDeviceKey('workout', 'user:a'));
        app.state.localWorkout = null;
        app.suspendedConsent = 'erasure-required';
        app.flush.mockRejectedValue(new Error('offline'));
    
        const reload = vi.fn();
        await safeHardReload(reload);
    
        expect(reload).toHaveBeenCalledTimes(1);
        expect(readDeviceValueStrict('workout', 'user:a')).toBe(saved);
        expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toBe(ciphertext);
        expect(ctx.disk.has(deviceKey('workout', 'user:a'))).toBe(false);
    });
}
