import { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './store/useAppStore';
import { analytics, getAnalyticsConsent } from './lib/firebase';
import { logEvent } from 'firebase/analytics';
import { useLocalStorage } from './hooks/useLocalStorage';
import { 
  LOCAL_STORAGE_ACTIVE_TAB, 
  LOCAL_STORAGE_TRAINING_TAB, 
  LOCAL_STORAGE_NUTRITION_TAB, 
  LOCAL_STORAGE_DATA_TAB 
} from './constants';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

import ErrorBoundary from './components/UI/ErrorBoundary';
import BottomNav from './components/UI/BottomNav';
import { GlobalDialog } from './components/UI/GlobalDialog';
import ReloadPrompt from './components/UI/ReloadPrompt';
import { InstallPrompt } from './components/UI/InstallPrompt';
import { ConsentOverlay } from './components/UI/ConsentOverlay';
import { needsLegalUpdate } from './lib/legalVersions';
import { LoginBox } from './components/UI/LoginBox';

const HomeView = lazy(() => import('./components/Home/HomeView'));
const TrainingView = lazy(() => import('./components/Training/TrainingView'));
const NutritionView = lazy(() => import('./components/Nutrition/NutritionView'));
const DataView = lazy(() => import('./components/Data/DataView'));
const SettingsView = lazy(() => import('./components/SettingsView'));

function App() {
  const { currentUser, loading, linkGoogleAccount, isGuest } = useAuth();
  const syncing = useAppStore(state => state.syncing);
  const userData = useAppStore(state => state.userData);
  const saveError = useAppStore(state => state.saveError);
  const setSaveError = useAppStore(state => state.setSaveError);
  const [activeTab, setActiveTab] = useLocalStorage(LOCAL_STORAGE_ACTIVE_TAB, 'home');
  const [trainingSubTab, setTrainingSubTab] = useLocalStorage(LOCAL_STORAGE_TRAINING_TAB, 'session');
  const [nutritionSubTab, setNutritionSubTab] = useLocalStorage(LOCAL_STORAGE_NUTRITION_TAB, 'meals');
  const [dataSubTab, setDataSubTab] = useLocalStorage(LOCAL_STORAGE_DATA_TAB, 'measurements');
  const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());

  const showConsentOverlay = userData && needsLegalUpdate(userData.legalConsent);

  // Handle Vite lazy chunk loading failure gracefully (e.g. after a new production deployment)
  useEffect(() => {
    const handlePreloadError = () => {
      window.location.reload();
    };
    window.addEventListener('vite:preloadError', handlePreloadError);
    return () => window.removeEventListener('vite:preloadError', handlePreloadError);
  }, []);

  useEffect(() => {
    const handler = () => setAnalyticsEnabled(getAnalyticsConsent());
    window.addEventListener('analytics_consent_changed', handler);
    return () => window.removeEventListener('analytics_consent_changed', handler);
  }, []);

  // Handle URL parameters for PWA shortcuts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam && ['home', 'training', 'nutrition', 'data', 'settings'].includes(tabParam)) {
        if (tabParam !== activeTab) {
          setActiveTab(tabParam);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [activeTab, setActiveTab]);

  // Auto-dismiss save error toast after 5 seconds
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => {
      setSaveError(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [saveError, setSaveError]);

  // Tracciamento dei tab su Google Analytics (SPA tab tracking)
  useEffect(() => {
    if (analytics && analyticsEnabled) {
      (logEvent as any)(analytics, 'screen_view', {
        screen_name: activeTab,
        screen_class: 'App'
      });
    }
  }, [activeTab, analyticsEnabled]);

  useEffect(() => {
    if (analytics && analyticsEnabled) {
      const subTab = activeTab === 'training' ? trainingSubTab : activeTab === 'nutrition' ? nutritionSubTab : activeTab === 'data' ? dataSubTab : null;
      if (subTab) {
        (logEvent as any)(analytics, 'sub_tab_view', {
          tab: activeTab,
          sub_tab: subTab
        });
      }
    }
  }, [activeTab, trainingSubTab, nutritionSubTab, dataSubTab, analyticsEnabled]);

  // Track visited tabs for lazy Keep-Alive rendering
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>(() => ({ [activeTab]: true }));

  // Preserve and restore scroll position across tabs
  const tabScrollPositions = useState<Record<string, number>>(() => ({}))[0];
  const currentTabRef = useState<{ current: string }>({ current: activeTab })[0];

  const handleTabChange = (newTab: string) => {
    if (newTab === activeTab) {
      // Comportamento di "reset": clicco sulla tab già attiva
      if (newTab === 'training') setTrainingSubTab('session');
      if (newTab === 'nutrition') setNutritionSubTab('meals');
      if (newTab === 'data') setDataSubTab('measurements');
      
      tabScrollPositions[activeTab] = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    tabScrollPositions[activeTab] = window.scrollY;
    setVisitedTabs(prev => prev[newTab] ? prev : { ...prev, [newTab]: true });
    setActiveTab(newTab);
    currentTabRef.current = newTab;
    requestAnimationFrame(() => {
      const savedPos = tabScrollPositions[newTab] || 0;
      window.scrollTo({ top: savedPos, behavior: 'instant' });
    });
  };

  useEffect(() => {
    const handleNavEvent = (e: Event) => {
      handleTabChange((e as CustomEvent).detail);
    };
    window.addEventListener('app:navigate', handleNavEvent);
    return () => window.removeEventListener('app:navigate', handleNavEvent);
  }, [activeTab]);

  // Sync Lock: prevent tab close/navigation if a cloud sync is currently in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useAppStore.getState().syncing) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  if (loading) {
    return (
      <div id="auth-overlay">
        <div id="auth-loading" style={{ textAlign: 'center', maxWidth: '400px', padding: '30px', background: 'rgba(30, 41, 59, 0.7)', backdropFilter: 'blur(10px)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)'}}>
            <h1 style={{color:'var(--primary-color)', marginBottom: '10px'}}>LogBook</h1>
            <div className="spinner" style={{margin: '20px auto'}}></div>
            <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!currentUser && !isGuest) {
    return (
      <div id="auth-overlay">
        <LoginBox />
      </div>
    );
  }

  return (
    <>
      <GlobalDialog />
      {showConsentOverlay && <ConsentOverlay />}
      <ReloadPrompt />
      <InstallPrompt />
      {/* Banner utente guest — visibile finché non collega Google */}
      {isGuest && (
        <div style={{
          position: 'fixed',
          top: 'env(safe-area-inset-top, 0px)',
          left: 0, right: 0,
          background: 'rgba(245, 158, 11, 0.92)',
          backdropFilter: 'blur(6px)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '8px 16px',
          fontSize: '0.85rem',
          zIndex: 8888,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>⚠️ Modalità locale · I dati sono solo su questo dispositivo</span>
          <button
            onClick={linkGoogleAccount}
            style={{
              background: '#fff',
              color: '#92400e',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap'
            }}
          >
            Collega Google
          </button>
        </div>
      )}
      {/* Indicatore sincronizzazione non bloccante */}
      {syncing && (
        <div 
          className="sync-indicator" 
          role="status" 
          aria-live="polite"
          aria-label="Salvataggio in corso"
        >
          <div className="sync-indicator-spinner" />
          <span>Salvataggio in corso...</span>
        </div>
      )}

      {/* Toast errore sincronizzazione non bloccante */}
      {saveError && (
        <div 
          className="sync-error-toast" 
          role="alert" 
          aria-live="assertive"
        >
          <span className="sync-error-icon" aria-hidden="true">⚠️</span>
          <span className="sync-error-text">{saveError}</span>
          <button 
            type="button" 
            className="sync-error-close" 
            aria-label="Chiudi avviso"
            onClick={() => setSaveError(null)}
          >
            ✕
          </button>
        </div>
      )}

      <main id="app-container" style={isGuest ? { paddingTop: '36px' } : undefined}>
        {/* Render Active View */}
        <ErrorBoundary>
          <Suspense fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
              <div className="spinner"></div>
              <p style={{ color: 'var(--text-muted)' }}>Caricamento...</p>
            </div>
          }>
            <div style={{ display: activeTab === 'home' ? 'block' : 'none' }}>
              {(visitedTabs.home || activeTab === 'home') && <HomeView onNavigate={handleTabChange} />}
            </div>
            <div style={{ display: activeTab === 'training' ? 'block' : 'none' }}>
              {(visitedTabs.training || activeTab === 'training') && <TrainingView subTab={trainingSubTab} setSubTab={setTrainingSubTab} />}
            </div>
            <div style={{ display: activeTab === 'nutrition' ? 'block' : 'none' }}>
              {(visitedTabs.nutrition || activeTab === 'nutrition') && <NutritionView subTab={nutritionSubTab} setSubTab={setNutritionSubTab} />}
            </div>
            <div style={{ display: activeTab === 'data' ? 'block' : 'none' }}>
              {(visitedTabs.data || activeTab === 'data') && <DataView subTab={dataSubTab} setSubTab={setDataSubTab} />}
            </div>
            <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
              {(visitedTabs.settings || activeTab === 'settings') && <SettingsView />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>

      <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />
      {analyticsEnabled && <Analytics />}
      {analyticsEnabled && <SpeedInsights />}
    </>
  );
}

export default App;
