import { createContext } from 'react';
import type { User } from 'firebase/auth';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    isGuest: boolean;
    login: () => Promise<void>;
    loginAsGuest: () => void;
    linkGoogleAccount: () => Promise<void>;
    logout: () => Promise<void>;
}

export const defaultAuthContext: AuthContextType = {
    currentUser: null,
    loading: false,
    isGuest: false,
    login: async () => {},
    loginAsGuest: () => {},
    linkGoogleAccount: async () => {},
    logout: async () => {}
};

export const AuthContext = createContext<AuthContextType>(defaultAuthContext);
