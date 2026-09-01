import { createContext } from 'react';
import type { User } from 'firebase/auth';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    isGuest: boolean;
    login: () => Promise<void>;
    loginAsGuest: () => void | Promise<void>;
    linkGoogleAccount: () => Promise<void>;
    logout: (skipConfirm?: boolean) => Promise<void>;
    loginWithEmail: (email: string, pass: string) => Promise<void>;
    registerWithEmail: (email: string, pass: string) => Promise<void>;
}

export const defaultAuthContext: AuthContextType = {
    currentUser: null,
    loading: false,
    isGuest: false,
    login: async () => {},
    loginAsGuest: () => {},
    linkGoogleAccount: async () => {},
    logout: async (_skipConfirm?: boolean) => {},
    loginWithEmail: async () => {},
    registerWithEmail: async () => {}
};

export const AuthContext = createContext<AuthContextType>(defaultAuthContext);
