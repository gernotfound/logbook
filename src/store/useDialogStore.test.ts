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
