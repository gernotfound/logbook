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

// Requests have a single visible owner. A later notification must never replace
// the resolver for a confirmation, password prompt or unsynced-data decision.
export const useDialogStore = create<DialogState>((set) => {
  const pending: Array<() => void> = [];
  let active = false;
  let cancelActive: (() => void) | null = null;

  const advance = () => {
    const next = pending.shift();
    if (next) {
      active = true;
      next();
    } else {
      active = false;
      cancelActive = null;
      set({ isOpen: false, onAction: undefined, onInputConfirm: undefined });
    }
  };
  const enqueue = (open: () => void) => {
    pending.push(open);
    if (!active) advance();
  };

  return {
    isOpen: false,
    type: 'alert',
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},

    showAlert: (message, title = 'Avviso') => new Promise<void>((resolve) => {
      enqueue(() => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve();
          advance();
        };
        cancelActive = finish;
        set({
          isOpen: true, type: 'alert', title, message,
          unsyncedReason: undefined, onAction: undefined, onInputConfirm: undefined,
          onConfirm: finish, onCancel: finish,
        });
      });
    }),

    showConfirm: (message, title = 'Conferma') => new Promise<boolean>((resolve) => {
      enqueue(() => {
        let finished = false;
        const finish = (accepted: boolean) => {
          if (finished) return;
          finished = true;
          resolve(accepted);
          advance();
        };
        cancelActive = () => finish(false);
        set({
          isOpen: true, type: 'confirm', title, message,
          unsyncedReason: undefined, onAction: undefined, onInputConfirm: undefined,
          onConfirm: () => finish(true), onCancel: () => finish(false),
        });
      });
    }),

    showPasswordPrompt: (message, title = 'Verifica identità') => new Promise<string | null>((resolve) => {
      enqueue(() => {
        let finished = false;
        const finish = (value: string | null) => {
          if (finished) return;
          finished = true;
          resolve(value);
          advance();
        };
        cancelActive = () => finish(null);
        set({
          isOpen: true, type: 'password-prompt', title, message,
          unsyncedReason: undefined, onAction: undefined,
          onInputConfirm: value => finish(value),
          onConfirm: () => {}, onCancel: () => finish(null),
        });
      });
    }),

    showUnsyncedDataLogout: reason => new Promise<UnsyncedLogoutAction>((resolve) => {
      enqueue(() => {
        let finished = false;
        let resolved = false;
        const settle = (action: UnsyncedLogoutAction) => {
          if (resolved) return;
          resolved = true;
          resolve(action);
        };
        const finish = (action: UnsyncedLogoutAction) => {
          if (finished) return;
          finished = true;
          settle(action);
          advance();
        };
        cancelActive = () => finish('cancel');
        set({
          isOpen: true, type: 'unsynced-data-logout',
          title: 'Modifiche non sincronizzate', message: '',
          unsyncedReason: reason, onInputConfirm: undefined,
          onAction: action => {
            // "wait" preserves the dialog while the caller stops attempting logout.
            // The active slot is released only when the dialog is later dismissed.
            if (action === 'wait') settle('wait');
            else finish(action);
          },
          onConfirm: () => {}, onCancel: () => finish('cancel'),
        });
      });
    }),

    closeDialog: () => {
      if (cancelActive) cancelActive();
      else set({ isOpen: false });
    },
  };
});
