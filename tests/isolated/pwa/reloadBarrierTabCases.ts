import { it, expect } from 'vitest';
import type { UserData } from '../../../src/types';
import type { ReloadSuiteContext } from './reloadBarrier.test';

export function registerReloadTabCases(ctx: ReloadSuiteContext): void {
    const { app, parse, clear, get, prepareForReload, UnverifiedTabSnapshotError, commitLocal, initializeLocal, readLocal, UserDataSchema, activateGuestSession, captureSession, GUEST_SESSION_KEY, isCurrentSession, markTabSnapshotClean, markTabSnapshotDirty, readTabSnapshotState, createAndMigrateVault } = ctx;

    it('preserves the first dirty baseline and returns defensive copies', () => {
        const session = captureSession();
        const base = parse(170);
        markTabSnapshotClean(session, base);
        markTabSnapshotDirty(session, base);
        markTabSnapshotDirty(session, parse(172));
        base.profile!.height = '190';
        const firstRead = readTabSnapshotState(session);
        expect(firstRead?.dirty).toBe(true);
        expect(firstRead?.base.profile?.height).toBe('170');
        if (firstRead?.base.profile) firstRead.base.profile.height = '199';
        expect(readTabSnapshotState(session)?.base.profile?.height).toBe('170');
    });
    
    it('rejects a stale dirty baseline after consent generation changes in another tab', async () => {
        const originalSession = captureSession();
        markTabSnapshotDirty(originalSession, app.state.userData);
        app.state.userData = parse(171);
        ctx.disk.set('logbook:v2:user:a:health-consent-generation', '2');
        const newSession = captureSession();
        expect(newSession.owner).toBe(originalSession.owner);
        expect(newSession.epoch).toBe(originalSession.epoch);
        expect(isCurrentSession(originalSession)).toBe(false);
        expect(readTabSnapshotState(newSession)).toBeUndefined();
        expect(() => markTabSnapshotDirty(newSession, app.state.userData)).toThrow('sessione precedente');
        expect(readTabSnapshotState(originalSession)?.base.profile?.height).toBe('170');
        app.flush.mockRejectedValue(new Error('offline'));
        await expect(prepareForReload()).rejects.toBeInstanceOf(UnverifiedTabSnapshotError);
        expect((await readLocal('user:a'))?.data.profile?.height).toBe('170');
    });
    
    it('invalidates a clean baseline when the consent withdrawal marker changes', () => {
        const before = captureSession();
        expect(readTabSnapshotState(before)?.dirty).toBe(false);
        ctx.disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');
        const after = captureSession();
        expect(after.epoch).toBe(before.epoch);
        expect(isCurrentSession(before)).toBe(false);
        expect(readTabSnapshotState(after)).toBeUndefined();
    });
    
    it('allows a clean guest snapshot to establish a new baseline after explicit reacceptance', () => {
        const original = { ...captureSession(), owner: 'guest', guestSessionId: 'guest-reaccept', consentMarker: 'withdrawn' };
        markTabSnapshotClean(original, parse(170));
        const reaccepted = { ...original, consentMarker: null };
        expect(readTabSnapshotState(reaccepted)).toBeUndefined();
        expect(() => markTabSnapshotDirty(reaccepted, parse(170))).not.toThrow();
        expect(readTabSnapshotState(reaccepted)?.base.profile?.height).toBe('170');
        expect(readTabSnapshotState(reaccepted)?.dirty).toBe(true);
        expect(readTabSnapshotState(original)).toBeUndefined();
    });
    
    it('does not confuse two guest generations sharing an owner and epoch', () => {
        const session = captureSession();
        const guestA = { ...session, owner: 'guest', guestSessionId: 'guest-a' };
        const guestB = { ...guestA, guestSessionId: 'guest-b' };
        markTabSnapshotClean(guestA, parse(170));
        markTabSnapshotDirty(guestA, parse(170));
        expect(readTabSnapshotState(guestA)?.dirty).toBe(true);
        expect(readTabSnapshotState(guestB)).toBeUndefined();
        markTabSnapshotClean(guestB, parse(171));
        expect(readTabSnapshotState(guestB)?.base.profile?.height).toBe('171');
        expect(readTabSnapshotState(guestA)).toBeUndefined();
    });
    
    it('repairs a lagging durable snapshot before reload', async () => {
        markTabSnapshotDirty(captureSession(), app.state.userData);
        app.state.userData = parse(171);
        app.flush.mockRejectedValue(new Error('offline'));
        await prepareForReload();
        const durable = await readLocal('user:a');
        expect(durable?.data).toEqual(UserDataSchema.parse(app.state.userData));
        expect(durable?.pending.length).toBeGreaterThan(0);
    });
    
    it('repairs a lagging guest snapshot without creating a cloud journal', async () => {
        await clear();
        ctx.disk.set('logbook_is_guest', 'true');
        ctx.disk.set(GUEST_SESSION_KEY, 'reload-test-guest');
        (app.auth as any).currentUser = null;
        activateGuestSession('reload-test-guest');
        await createAndMigrateVault('guest');
        const base = parse(170);
        app.state.userData = base;
        app.state.dataOwner = 'guest';
        await initializeLocal('guest', base);
        markTabSnapshotClean(captureSession(), base);
        markTabSnapshotDirty(captureSession(), base);
        app.state.userData = parse(171);
        app.flush.mockRejectedValue(new Error('offline'));
        await prepareForReload();
        const durable = await readLocal('guest');
        expect(durable?.data).toEqual(UserDataSchema.parse(app.state.userData));
        expect(durable?.pending).toHaveLength(0);
        expect(await get('logbook:v2:guest')).toMatch(/^tlb-sealed:/);
    });
    
    it('does not delete an authenticated change written by another tab when this tab is clean and stale', async () => {
        const base = app.state.userData as UserData;
        const concurrent = UserDataSchema.parse({
            ...base,
            routines: [{ id: 'routine-a', name: 'Tab A', exercises: [] }],
        }) as unknown as UserData;
        await commitLocal('user:a', concurrent, base);
        app.flush.mockRejectedValue(new Error('offline'));
    
        await prepareForReload();
    
        const durable = await readLocal('user:a');
        expect(durable?.data.routines?.map(routine => routine.id)).toContain('routine-a');
        expect(durable?.pending.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
        expect(app.state.userData.routines?.map((routine: any) => routine.id)).toContain('routine-a');
    });
    
    it('preserves a concurrent authenticated change while durably replaying this tab local intent', async () => {
        const base = app.state.userData as UserData;
        markTabSnapshotDirty(captureSession(), base);
        app.state.userData = parse(171);
        const concurrent = UserDataSchema.parse({
            ...base,
            routines: [{ id: 'routine-a', name: 'Tab A', exercises: [] }],
        }) as unknown as UserData;
        await commitLocal('user:a', concurrent, base);
        app.flush.mockRejectedValue(new Error('offline'));
    
        await prepareForReload();
    
        const durable = await readLocal('user:a');
        expect(durable?.data.profile?.height).toBe('171');
        expect(durable?.data.routines?.map(routine => routine.id)).toContain('routine-a');
        expect(durable?.pending.some(op => op.isDelete && op.path.includes('routine-a'))).toBe(false);
    });
    
    it('does not erase a concurrent guest change from a clean stale tab', async () => {
        await clear();
        ctx.disk.set('logbook_is_guest', 'true');
        ctx.disk.set(GUEST_SESSION_KEY, 'reload-test-guest');
        (app.auth as any).currentUser = null;
        activateGuestSession('reload-test-guest');
        await createAndMigrateVault('guest');
        const base = parse(170);
        app.state.userData = base;
        app.state.dataOwner = 'guest';
        await initializeLocal('guest', base);
        markTabSnapshotClean(captureSession(), base);
        const concurrent = UserDataSchema.parse({
            ...base,
            routines: [{ id: 'guest-routine-a', name: 'Guest tab A', exercises: [] }],
        }) as unknown as UserData;
        await commitLocal('guest', concurrent, base);
        app.flush.mockRejectedValue(new Error('offline'));
    
        await prepareForReload();
    
        const durable = await readLocal('guest');
        expect(durable?.data.routines?.map(routine => routine.id)).toContain('guest-routine-a');
        expect(durable?.pending).toHaveLength(0);
        expect(await get('logbook:v2:guest')).toMatch(/^tlb-sealed:/);
    });
}
