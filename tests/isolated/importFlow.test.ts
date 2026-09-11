import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const ui = vi.hoisted(() => ({ state: { userData: null as any, syncHealth: 'synced' }, confirm: vi.fn(), alert: vi.fn(), current: true }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: { getState: () => ui.state } }));
vi.mock('../../src/store/useDialogStore', () => ({ useDialogStore: { getState: () => ({ showConfirm: ui.confirm, showAlert: ui.alert }) } }));
vi.mock('../../src/lib/sync/session', () => ({ captureSession: () => ({ owner: 'user:a', epoch: 0 }), isCurrentSession: () => ui.current }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { Exporter } from '../../src/lib/export';
import { UserDataSchema } from '../../src/lib/schema';
const payload = { version: 1, type: 'backup', userId: 'a', profile: { height: '180' } };
const file = { content: JSON.stringify(payload) } as unknown as File;
beforeEach(() => {
    vi.resetAllMocks(); ui.current = true; ui.state = { userData: UserDataSchema.parse({ profile: { height: '170' } }), syncHealth: 'synced' };
    ui.confirm.mockResolvedValue(true);
    vi.stubGlobal('FileReader', class {
        result = ''; onload = () => {}; onerror = () => {};
        readAsText(input: { content: string }) { this.result = input.content; queueMicrotask(() => this.onload()); }
    });
});
afterEach(() => vi.unstubAllGlobals());
it('commits only after confirmation and reports local-pending without claiming cloud confirmation', async () => {
    const save = vi.fn(async update => { expect(ui.confirm).toHaveBeenCalled(); ui.state.userData = update(ui.state.userData); ui.state.syncHealth = 'local-pending'; });
    await Exporter.importFromJson(file, { uid: 'a' }, save, 'restore');
    expect(ui.state.userData.profile.height).toBe('180');
    expect(ui.alert).toHaveBeenCalledWith(expect.stringContaining('cloud in attesa'));
});
it('does not overwrite an edit made while the preview was open', async () => {
    ui.confirm.mockImplementation(async () => { ui.state.userData.profile.height = '175'; return true; });
    const save = vi.fn(async update => { ui.state.userData = update(ui.state.userData); });
    await expect(Exporter.importFromJson(file, { uid: 'a' }, save, 'restore')).rejects.toThrow('dati sono cambiati');
    expect(ui.state.userData.profile.height).toBe('175');
});
it('cancels after an account change during confirmation', async () => {
    ui.confirm.mockImplementation(async () => { ui.current = false; return true; });
    const save = vi.fn();
    await expect(Exporter.importFromJson(file, { uid: 'a' }, save)).rejects.toThrow('Sessione cambiata');
    expect(save).not.toHaveBeenCalled(); expect(ui.alert).not.toHaveBeenCalled();
});
it('propagates storage rejection and never announces success', async () => {
    const save = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    await expect(Exporter.importFromJson(file, { uid: 'a' }, save)).rejects.toThrow('quota');
    expect(ui.alert).toHaveBeenCalledExactlyOnceWith('quota exceeded');
});
it('handles FileReader errors and cancellation before save', async () => {
    vi.stubGlobal('FileReader', class { onerror = () => {}; readAsText() { queueMicrotask(() => this.onerror()); } });
    const save = vi.fn();
    await expect(Exporter.importFromJson(file, { uid: 'a' }, save)).rejects.toThrow('leggere');
    expect(save).not.toHaveBeenCalled();
});
