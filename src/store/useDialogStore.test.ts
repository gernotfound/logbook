import { describe, expect, it, vi } from 'vitest';

describe('global dialog request integrity', () => {
  it('returns the password through a transient callback without storing it in Zustand state', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    useDialogStore.getState().closeDialog();
    const prompt = useDialogStore.getState().showPasswordPrompt('Inserisci la password attuale.', 'Verifica identità');
    const state = useDialogStore.getState();
    expect(state.type).toBe('password-prompt');
    expect(state.message).toBe('Inserisci la password attuale.');
    expect(state).not.toHaveProperty('password');
    state.onInputConfirm?.('Secret123!');
    await expect(prompt).resolves.toBe('Secret123!');
    expect(useDialogStore.getState().isOpen).toBe(false);
  });

  it('queues an alert behind a confirmation without losing the first answer', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    useDialogStore.getState().closeDialog();
    const confirmation = useDialogStore.getState().showConfirm('Eliminare i dati?');
    const initialConfirm = useDialogStore.getState().onConfirm;
    const alert = useDialogStore.getState().showAlert('Recupero account in attesa');
    expect(useDialogStore.getState().message).toBe('Eliminare i dati?');
    initialConfirm();
    await expect(confirmation).resolves.toBe(true);
    expect(useDialogStore.getState().message).toBe('Recupero account in attesa');
    initialConfirm(); // Stale callbacks cannot dismiss a different request.
    expect(useDialogStore.getState().isOpen).toBe(true);
    useDialogStore.getState().onConfirm();
    await expect(alert).resolves.toBeUndefined();
    expect(useDialogStore.getState().isOpen).toBe(false);
  });

  it('closeDialog resolves the current request safely and keeps later alerts', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    useDialogStore.getState().closeDialog();
    const confirmation = useDialogStore.getState().showConfirm('Uscire?');
    const alert = useDialogStore.getState().showAlert('Avviso successivo');
    useDialogStore.getState().closeDialog();
    await expect(confirmation).resolves.toBe(false);
    expect(useDialogStore.getState().message).toBe('Avviso successivo');
    useDialogStore.getState().onConfirm();
    await expect(alert).resolves.toBeUndefined();
  });

  it('preserves an unsynced logout dialog on wait, then releases queued requests', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    useDialogStore.getState().closeDialog();
    const logout = useDialogStore.getState().showUnsyncedDataLogout('offline');
    const alert = useDialogStore.getState().showAlert('Altra notifica');
    useDialogStore.getState().onAction?.('wait');
    await expect(logout).resolves.toBe('wait');
    expect(useDialogStore.getState().type).toBe('unsynced-data-logout');
    useDialogStore.getState().onCancel();
    expect(useDialogStore.getState().message).toBe('Altra notifica');
    useDialogStore.getState().onConfirm();
    await expect(alert).resolves.toBeUndefined();
  });
});
