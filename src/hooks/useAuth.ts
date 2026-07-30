import { useContext } from 'react';
import { AuthContext, defaultAuthContext } from '../contexts/AuthContext';

export const useAuth = () => useContext(AuthContext) || defaultAuthContext;
