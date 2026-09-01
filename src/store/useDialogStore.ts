import { create } from 'zustand';

export type UnsyncedLogoutReason = 'offline' | 'rejected' | 'failed' | 'conflict';
export type UnsyncedLogoutAction = 'wait' | 'export' | 'force-exit' | 'cancel' | 'safe-exit';

interface DialogState {
  isOpen: boolean;
  type: 'alert' | 'confirm' | 'unsynced-data-logout';
  title: string;
  message: string;
  unsyncedReason?: UnsyncedLogoutReason;
  onConfirm: () => void;
  onCancel: () => void;
  onAction?: (action: UnsyncedLogoutAction) => void;
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  showUnsyncedDataLogout: (reason: UnsyncedLogoutReason) => Promise<UnsyncedLogoutAction>;
  closeDialog: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  isOpen: false,
  type: 'alert',
  title: '',
  message: '',
  onConfirm: () => {},
  onCancel: () => {},

  showAlert: (message, title = 'Avviso') => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        type: 'alert',
        title,
        message,
        unsyncedReason: undefined,
        onAction: undefined,
        onConfirm: () => {
          set({ isOpen: false });
          resolve();
        },
        onCancel: () => {
          set({ isOpen: false });
          resolve();
        }
      });
    });
  },

  showConfirm: (message, title = 'Conferma') => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        type: 'confirm',
        title,
        message,
        unsyncedReason: undefined,
        onAction: undefined,
        onConfirm: () => {
          set({ isOpen: false });
          resolve(true);
        },
        onCancel: () => {
          set({ isOpen: false });
          resolve(false);
        }
      });
    });
  },

  showUnsyncedDataLogout: (reason: UnsyncedLogoutReason) => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        type: 'unsynced-data-logout',
        title: 'Modifiche non sincronizzate',
        message: '', // Message managed by GlobalDialog
        unsyncedReason: reason,
        onAction: (action: UnsyncedLogoutAction) => {
          // If the user clicks 'wait', we DO NOT close the dialog automatically here.
          // The AuthContext handles 'wait' state. Wait, the prompt says:
          // "se l’utente chiude il dialog, ogni listener/timer viene pulito."
          // So 'cancel' closes it. But 'wait' means leaving it open.
          // Wait, if it returns 'wait', the caller needs to keep it open.
          // Actually, if we return 'wait', the Promise resolves. We might need a separate closeDialog.
          // Let's resolve the action.
          if (action !== 'wait') {
            set({ isOpen: false });
          }
          resolve(action);
        },
        onConfirm: () => {},
        onCancel: () => {
          set({ isOpen: false });
          resolve('cancel');
        }
      });
    });
  },

  closeDialog: () => set({ isOpen: false }),
}));
