import { describe, expect, it, vi } from 'vitest';

describe('password prompt dialog state', () => {
  it('returns the password through a transient callback without storing it in Zustand state', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>(
      './useDialogStore',
    );
    useDialogStore.getState().closeDialog();

    const prompt = useDialogStore.getState().showPasswordPrompt(
      'Inserisci la password attuale.',
      'Verifica identità',
    );
    const state = useDialogStore.getState();

    expect(state.type).toBe('password-prompt');
    expect(state.message).toBe('Inserisci la password attuale.');
    expect(state).not.toHaveProperty('password');

    state.onInputConfirm?.('Secret123!');

    await expect(prompt).resolves.toBe('Secret123!');
    expect(useDialogStore.getState().isOpen).toBe(false);
  });
});

describe('dialog request serialization', () => {
  it('keeps the first confirmation active until answered and then displays queued alerts', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    const store = useDialogStore.getState();
    store.closeDialog();

    const confirmation = store.showConfirm('Conferma cancellazione');
    const notice = store.showAlert('Recupero ancora in corso');
    expect(useDialogStore.getState().type).toBe('confirm');
    expect(useDialogStore.getState().message).toBe('Conferma cancellazione');

    useDialogStore.getState().onCancel();
    await expect(confirmation).resolves.toBe(false);
    expect(useDialogStore.getState().type).toBe('alert');
    expect(useDialogStore.getState().message).toBe('Recupero ancora in corso');
    useDialogStore.getState().onConfirm();
    await expect(notice).resolves.toBeUndefined();
    expect(useDialogStore.getState().isOpen).toBe(false);
  });

  it('cancels the active password prompt and advances to the next request', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    useDialogStore.getState().closeDialog();
    const password = useDialogStore.getState().showPasswordPrompt('Password');
    const confirmation = useDialogStore.getState().showConfirm('Procedere?');
    expect(useDialogStore.getState().type).toBe('password-prompt');
    useDialogStore.getState().closeDialog();
    await expect(password).resolves.toBeNull();
    expect(useDialogStore.getState().type).toBe('confirm');
    useDialogStore.getState().onConfirm();
    await expect(confirmation).resolves.toBe(true);
  });

  it('preserves unsynced logout action ordering when a recovery alert arrives', async () => {
    const { useDialogStore } = await vi.importActual<typeof import('./useDialogStore')>('./useDialogStore');
    useDialogStore.getState().closeDialog();
    const logout = useDialogStore.getState().showUnsyncedDataLogout('offline');
    const notice = useDialogStore.getState().showAlert('Dati in recupero');
    expect(useDialogStore.getState().type).toBe('unsynced-data-logout');
    useDialogStore.getState().onAction?.('cancel');
    await expect(logout).resolves.toBe('cancel');
    expect(useDialogStore.getState().message).toBe('Dati in recupero');
    useDialogStore.getState().onConfirm();
    await notice;
  });
});
