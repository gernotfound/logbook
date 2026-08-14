import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { get } from 'idb-keyval'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import ErrorBoundary from './components/UI/ErrorBoundary'
import { useAppStore } from './store/useAppStore'
import './styles/global.css'
import type { UserData } from './types'

// Prevent gesture/pinch zoom on iOS PWA
if (typeof window !== 'undefined') {
  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
  });
}

const initApp = async () => {
  try {
    const cached = await get<UserData>('logbook_cached_user_data');
    window.__INITIAL_USER_DATA__ = cached || null;
    if (cached && !useAppStore.getState().userData) {
      useAppStore.setState({ userData: cached });
    }
  } catch (e) {
    console.warn("Errore recupero cache da IndexedDB:", e);
    window.__INITIAL_USER_DATA__ = null;
  }

  const rootElement = document.getElementById('root');
  if (rootElement) {
    createRoot(rootElement).render(
      <StrictMode>
        <ErrorBoundary>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  }
};

initApp();
