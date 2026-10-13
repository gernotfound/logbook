import { create } from 'zustand';

type UnsyncedLogoutReason = 'offline' | 'rejected' | 'failed' | 'conflict';
export type UnsyncedLogoutAction = 'wait' | 'export' | 'force-exit' | 'cancel' | 'safe-exit';

interface DialogState {
  isOpen: boolean;
  type: 'alert' | 'confirm' | 'password-prompt' | 'unsynced-data-logout';
  title: string;
  message: string;
  unsyncedReason?: UnsyncedLogoutReason;
  onConfirm: () => void;
  onCancel: () => void;
  onAction?: (action: UnsyncedLogoutAction) => void;
  onInputConfirm?: (value: string) => void;
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  showPasswordPrompt: (message: string, title?: string) => Promise<string | null>;
  showUnsyncedDataLogout: (reason: UnsyncedLogoutReason) => Promise<UnsyncedLogoutAction>;
  closeDialog: () => void;
  /** Cancel all owner-bound prompts, including queued requests, on identity changes. */
  cancelAll: () => void;
}

const noop = () => {};

export const useDialogStore = create<DialogState>((set) => {
  // One visible dialog at a time. Each queued request retains its own resolver,
  // so a recovery notice cannot replace a pending confirmation or password prompt.
  const queued: Array<{ show: () => void; cancel: () => void }> = [];
  let cancelActive: (() => void) | null = null;
  let cancellingOwner = false;

  const showNext = () => {
    if (cancelActive || cancellingOwner) return;
    queued.shift()?.show();
  };

  const enqueue = <T,>(display: (finish: (value: T) => void, cancel: () => void) => void, cancelled: T): Promise<T> =>
    new Promise<T>(resolve => {
      let settled = false;
      const cancel = () => finish(cancelled);
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        if (cancelActive === cancel) {
          cancelActive = null;
          set({ isOpen: false, onConfirm: noop, onCancel: noop, onAction: undefined, onInputConfirm: undefined });
        }
        resolve(value);
        showNext();
      };
      queued.push({
        show: () => {
          if (settled) return;
          cancelActive = cancel;
          display(finish, cancel);
        },
        cancel,
      });
      showNext();
    });

  const cancelAll = () => {
    // Cancel pending promises too: dropping callbacks would strand callers
    // while activating a stale confirmation in the next account.
    cancellingOwner = true;
    const pending = queued.splice(0);
    pending.forEach(item => item.cancel());
    cancelActive?.();
    set({ isOpen: false, title: '', message: '', onConfirm: noop, onCancel: noop,
      onAction: undefined, onInputConfirm: undefined, unsyncedReason: undefined });
    cancellingOwner = false;
  };

  return {
    isOpen: false,
    type: 'alert',
    title: '',
    message: '',
    onConfirm: noop,
    onCancel: noop,

    showAlert: (message, title = 'Avviso') =>
      enqueue<void>((finish, cancel) => {
        set({
          isOpen: true, type: 'alert', title, message,
          unsyncedReason: undefined, onAction: undefined, onInputConfirm: undefined,
          onConfirm: () => finish(undefined), onCancel: cancel,
        });
      }, undefined),

    showConfirm: (message, title = 'Conferma') =>
      enqueue<boolean>((finish, cancel) => {
        set({
          isOpen: true, type: 'confirm', title, message,
          unsyncedReason: undefined, onAction: undefined, onInputConfirm: undefined,
          onConfirm: () => finish(true), onCancel: cancel,
        });
      }, false),

    showPasswordPrompt: (message, title = 'Verifica identità') =>
      enqueue<string | null>((finish, cancel) => {
        set({
          isOpen: true, type: 'password-prompt', title, message,
          unsyncedReason: undefined, onAction: undefined,
          onInputConfirm: value => finish(value),
          onConfirm: noop, onCancel: cancel,
        });
      }, null),

    showUnsyncedDataLogout: reason =>
      enqueue<UnsyncedLogoutAction>((finish, cancel) => {
        set({
          isOpen: true, type: 'unsynced-data-logout',
          title: 'Modifiche non sincronizzate',
          message: '', unsyncedReason: reason,
          onInputConfirm: undefined, onConfirm: noop, onCancel: cancel,
          onAction: action => finish(action),
        });
      }, 'cancel'),

    // Programmatic closure is cancellation, never an abandoned Promise.
    closeDialog: () => {
      if (cancelActive) cancelActive();
      else set({ isOpen: false });
    },
    cancelAll,
  };
});
