import { it, expect, vi } from 'vitest';
import type { ReloadSuiteContext } from './reloadBarrier.test';

export function registerReloadArchiveCases(ctx: ReloadSuiteContext): void {
    const { app, clear, get, prepareForReload, safeHardReload, readLocal, UserDataSchema, invalidateSession, draftRegistry, BrowserStorageError, deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue, lockVault, LocalVaultLockedError, LocalCiphertextError } = ctx;

    it('allows offline update only with the durable copy and synchronous active workout snapshot', async () => {
        app.flush.mockRejectedValue(new Error('offline'));
        await prepareForReload();
        expect(JSON.parse(readDeviceValueStrict('workout', 'user:a')!)).toMatchObject({
            __logbookWorkoutSnapshot: 1, owner: 'user:a', consentRevision: 1,
            workout: app.state.localWorkout,
        });
        expect(ctx.disk.has(deviceKey('workout', 'user:a'))).toBe(false);
        expect(ctx.disk.get(protectedDeviceKey('workout', 'user:a'))).toMatch(/^tlb-sealed:/);
        expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:/);
        expect((await readLocal('user:a'))?.data).toEqual(UserDataSchema.parse(app.state.userData));
    });
    
    it('protects the active workout with authenticated ciphertext before a safe reload', async () => {
        app.flush.mockRejectedValue(new Error('offline'));
        await prepareForReload();
        expect(ctx.disk.has(deviceKey('workout', 'user:a'))).toBe(false);
        const ciphertext = ctx.disk.get(protectedDeviceKey('workout', 'user:a'));
        expect(ciphertext).toMatch(/^tlb-sealed:/);
        expect(JSON.parse(readDeviceValueStrict('workout', 'user:a')!)).toMatchObject({
            __logbookWorkoutSnapshot: 1, owner: 'user:a', consentRevision: 1,
            workout: app.state.localWorkout,
        });
    });
    
    it('fails closed on corrupted ciphertext and preserves the original bytes', async () => {
        writeDeviceValue('workout', JSON.stringify(app.state.localWorkout), 'user:a');
        const key = protectedDeviceKey('workout', 'user:a');
        const corrupted = 'tlb-sealed:v1:invalid-ciphertext';
        ctx.disk.set(key, corrupted);
        const reload = vi.fn();
        await expect(safeHardReload(reload)).rejects.toBeInstanceOf(LocalCiphertextError);
        expect(reload).not.toHaveBeenCalled();
        expect(ctx.disk.get(key)).toBe(corrupted);
    });
    
    it('blocks a reload when the owner vault is locked without modifying ciphertext', async () => {
        writeDeviceValue('workout', JSON.stringify(app.state.localWorkout), 'user:a');
        const key = protectedDeviceKey('workout', 'user:a');
        const ciphertext = ctx.disk.get(key);
        const envelope = await get('logbook:v2:user:a');
        lockVault('user:a');
        const reload = vi.fn();
        await expect(safeHardReload(reload)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(reload).not.toHaveBeenCalled();
        expect(ctx.disk.get(key)).toBe(ciphertext);
        expect(await get('logbook:v2:user:a')).toBe(envelope);
    });
    
    it('blocks stale plaintext reappearing alongside owner ciphertext instead of overwriting either copy', async () => {
        writeDeviceValue('workout', JSON.stringify(app.state.localWorkout), 'user:a');
        const sealedKey = protectedDeviceKey('workout', 'user:a');
        const sealed = ctx.disk.get(sealedKey);
        const plainKey = deviceKey('workout', 'user:a');
        const stale = JSON.stringify({ id: 'stale-tab', exercises: [] });
        ctx.disk.set(plainKey, stale);
        const reload = vi.fn();
        await expect(safeHardReload(reload)).rejects.toBeInstanceOf(LocalCiphertextError);
        expect(reload).not.toHaveBeenCalled();
        expect(ctx.disk.get(sealedKey)).toBe(sealed);
        expect(ctx.disk.get(plainKey)).toBe(stale);
    });
    
    it('still blocks reload when the durable envelope is missing', async () => {
        await clear();
        app.flush.mockRejectedValue(new Error('offline'));
        await expect(prepareForReload()).rejects.toThrow('non sono ancora salvate');
        expect(ctx.disk.has(protectedDeviceKey('workout', 'user:a'))).toBe(false);
    });
    
    it('blocks reload when the synchronous workout snapshot fails', async () => {
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        await expect(prepareForReload()).rejects.toBeInstanceOf(BrowserStorageError);
    });
    
    it('blocks reload on identity changes while awaiting persistence', async () => {
        app.flush.mockImplementation(async () => { app.auth.currentUser = { uid: 'b' }; invalidateSession(); });
        await expect(prepareForReload()).rejects.toThrow('Sessione cambiata');
        expect(ctx.disk.has(protectedDeviceKey('workout', 'user:a'))).toBe(false);
    });
    
    it('propagates a failed input flush and does not proceed to reload', async () => {
        const badDraft = () => { throw new Error('invalid draft'); };
        draftRegistry.register(badDraft);
        try {
            await expect(prepareForReload()).rejects.toThrow('bozze');
            expect(app.flush).not.toHaveBeenCalled();
        } finally { draftRegistry.unregister(badDraft); }
    });
    
    it('blocks reload with a readable envelope while an unsaved UI draft has blocked local persistence', async () => {
        app.flush.mockResolvedValue(undefined);
        (app.state as typeof app.state & { localPersistenceBlocked?: boolean }).localPersistenceBlocked = true;
        await expect(prepareForReload()).rejects.toThrow('Persistenza locale bloccata');
        expect(app.flush).not.toHaveBeenCalled();
        expect((await readLocal('user:a'))?.data.profile?.height).toBe('170');
    });
}
