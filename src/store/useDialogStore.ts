import { create } from 'zustand';

export type UnsyncedLogoutReason = 'offline' | 'rejected' | 'failed' | 'conflict';
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
}

const noop = () => {};

export const useDialogStore = create<DialogState>((set) => {
  // One visible dialog at a time. Each queued request retains its own resolver,
  // so a recovery notice cannot replace a pending confirmation or password prompt.
  const queued: Array<() => void> = [];
  let cancelActive: (() => void) | null = null;

  const showNext = () => {
    if (cancelActive) return;
    queued.shift()?.();
  };

  const enqueue = <T,>(display: (finish: (value: T) => void, cancel: () => void) => void, cancelled: T): Promise<T> =>
    new Promise<T>(resolve => {
      queued.push(() => {
        let settled = false;
        const finish = (value: T) => {
          if (settled) return;
          settled = true;
          cancelActive = null;
          set({ isOpen: false, onConfirm: noop, onCancel: noop, onAction: undefined, onInputConfirm: undefined });
          resolve(value);
          showNext();
        };
        const cancel = () => finish(cancelled);
        cancelActive = cancel;
        display(finish, cancel);
      });
      showNext();
    });

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
  };
});
