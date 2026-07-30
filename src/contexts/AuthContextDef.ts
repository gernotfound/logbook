import { createContext } from 'react';
import type { User } from 'firebase/auth';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    login: () => Promise<void>;
    logout: () => Promise<void>;
}

export const defaultAuthContext: AuthContextType = {
    currentUser: null,
    loading: false,
    login: async () => {},
    logout: async () => {}
};

export const AuthContext = createContext<AuthContextType>(defaultAuthContext);
