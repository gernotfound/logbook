import { useContext } from 'react';
import { AuthContext, defaultAuthContext } from '../contexts/AuthContextDef';

export const useAuth = () => useContext(AuthContext) || defaultAuthContext;
