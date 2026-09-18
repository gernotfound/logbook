import { createContext } from 'react';
import type { User } from 'firebase/auth';

export type LogoutOptions = { mode: 'normal' | 'force' };
export type GuestMigrationStatus = 'idle' | 'pending' | 'failed';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    isGuest: boolean;
    guestMigrationStatus: GuestMigrationStatus;
    login: () => Promise<void>;
    loginAsGuest: () => Promise<void>;
    linkGoogleAccount: () => Promise<void>;
    retryGuestMigration: () => Promise<void>;
    logout: (options?: LogoutOptions) => Promise<void>;
    loginWithEmail: (email: string, pass: string) => Promise<void>;
    registerWithEmail: (email: string, pass: string) => Promise<void>;
}

export const defaultAuthContext: AuthContextType = {
    currentUser: null,
    loading: false,
    isGuest: false,
    guestMigrationStatus: 'idle',
    login: async () => {},
    loginAsGuest: async () => {},
    linkGoogleAccount: async () => {},
    retryGuestMigration: async () => {},
    logout: async () => {},
    loginWithEmail: async () => {},
    registerWithEmail: async () => {}
};

export const AuthContext = createContext<AuthContextType>(defaultAuthContext);
