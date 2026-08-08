import { createContext } from 'react';
import type { User } from 'firebase/auth';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    isAnonymous: boolean;
    login: () => Promise<void>;
    loginAnonymously: () => Promise<void>;
    linkGoogleAccount: () => Promise<void>;
    logout: () => Promise<void>;
}

export const defaultAuthContext: AuthContextType = {
    currentUser: null,
    loading: false,
    isAnonymous: false,
    login: async () => {},
    loginAnonymously: async () => {},
    linkGoogleAccount: async () => {},
    logout: async () => {}
};

export const AuthContext = createContext<AuthContextType>(defaultAuthContext);
