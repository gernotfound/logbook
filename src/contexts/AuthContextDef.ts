import { createContext } from 'react';
import type { User } from 'firebase/auth';

type LogoutOptions = { mode: 'normal' | 'force' };
type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
export type GuestMigrationPolicy = 'merge' | 'skip';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    isGuest: boolean;
    guestMigrationStatus: GuestMigrationStatus;
    emailVerificationRequired: boolean;
    login: (guestPolicy?: GuestMigrationPolicy) => Promise<void>;
    loginAsGuest: () => Promise<void>;
    linkGoogleAccount: (guestPolicy?: GuestMigrationPolicy) => Promise<void>;
    retryGuestMigration: (policy?: GuestMigrationPolicy) => Promise<void>;
    logout: (options?: LogoutOptions) => Promise<void>;
    loginWithEmail: (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => Promise<void>;
    registerWithEmail: (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => Promise<void>;
    resendEmailVerification: () => Promise<void>;
    refreshEmailVerification: () => Promise<void>;
    continueUnverifiedLocally: () => Promise<void>;
}

export const defaultAuthContext: AuthContextType = {
    currentUser: null,
    loading: false,
    isGuest: false,
    guestMigrationStatus: 'idle',
    emailVerificationRequired: false,
    login: async () => {},
    loginAsGuest: async () => {},
    linkGoogleAccount: async () => {},
    retryGuestMigration: async () => {},
    logout: async () => {},
    loginWithEmail: async () => {},
    registerWithEmail: async () => {},
    resendEmailVerification: async () => {},
    refreshEmailVerification: async () => {},
    continueUnverifiedLocally: async () => {}
};

export const AuthContext = createContext<AuthContextType>(defaultAuthContext);
