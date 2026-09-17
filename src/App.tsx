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
import { 
  AppTabSchema, 
  TrainingSubTabSchema, 
  NutritionSubTabSchema, 
  DataSubTabSchema 
} from './lib/schema';
import type { 
  AppTab, 
  TrainingSubTab, 
  NutritionSubTab, 
  DataSubTab 
} from './types';
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

const GUEST_LOGIN_OVERLAY_SESSION_KEY = 'logbook_guest_login_overlay';

function readGuestLoginOverlayState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(GUEST_LOGIN_OVERLAY_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistGuestLoginOverlayState(visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (visible) {
      window.sessionStorage.setItem(GUEST_LOGIN_OVERLAY_SESSION_KEY, 'true');
    } else {
      window.sessionStorage.removeItem(GUEST_LOGIN_OVERLAY_SESSION_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in restricted browser contexts; React state remains authoritative.
  }
}

function App() {
  const { currentUser, loading, isGuest, guestMigrationStatus, retryGuestMigration } = useAuth();
  const syncing = useAppStore(state => state.syncing);
  const userData = useAppStore(state => state.userData);
  const saveError = useAppStore(state => state.saveError);
  const setSaveError = useAppStore(state => state.setSaveError);
  const compatibilityStatus = useAppStore(state => state.compatibilityStatus);
  const compatibilityError = useAppStore(state => state.compatibilityError);
  const [activeTab, setActiveTab] = useLocalStorage<AppTab>(LOCAL_STORAGE_ACTIVE_TAB, 'home', AppTabSchema);
  const [trainingSubTab, setTrainingSubTab] = useLocalStorage<TrainingSubTab>(LOCAL_STORAGE_TRAINING_TAB, 'session', TrainingSubTabSchema);
  const [nutritionSubTab, setNutritionSubTab] = useLocalStorage<NutritionSubTab>(LOCAL_STORAGE_NUTRITION_TAB, 'meals', NutritionSubTabSchema);
  const [dataSubTab, setDataSubTab] = useLocalStorage<DataSubTab>(LOCAL_STORAGE_DATA_TAB, 'measurements', DataSubTabSchema);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());

  const [showGuestLogin, setShowGuestLogin] = useState(readGuestLoginOverlayState);

  const showConsentOverlay = userData && needsLegalUpdate(userData.legalConsent);
  const guestLoginOverlayVisible = showGuestLogin && (!currentUser || (isGuest && guestMigrationStatus === 'idle'));
  const guestLoginMigrationPending = showGuestLogin && !!currentUser && guestMigrationStatus === 'pending';
  const guestLoginMigrationFailed = showGuestLogin && !!currentUser && guestMigrationStatus === 'failed';
  const hideBottomNav = guestLoginOverlayVisible || guestLoginMigrationPending || guestLoginMigrationFailed;

  const openGuestLogin = () => {
    persistGuestLoginOverlayState(true);
    setShowGuestLogin(true);
  };

  const closeGuestLogin = () => {
    persistGuestLoginOverlayState(false);
    setShowGuestLogin(false);
  };

  useEffect(() => {
    const handler = () => setAnalyticsEnabled(getAnalyticsConsent());
    window.addEventListener('analytics_consent_changed', handler);
    return () => window.removeEventListener('analytics_consent_changed', handler);
  }, []);

  useEffect(() => {
    if (showGuestLogin && currentUser && !isGuest && guestMigrationStatus === 'idle' && !syncing) {
      persistGuestLoginOverlayState(false);
      setShowGuestLogin(false);
    }
  }, [showGuestLogin, currentUser, isGuest, guestMigrationStatus, syncing]);

  // Handle URL parameters for PWA shortcuts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam) {
        const parsed = AppTabSchema.safeParse(tabParam);
        if (parsed.success && parsed.data !== activeTab) {
          setActiveTab(parsed.data);
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

  // Clear saveError on online event if it was due to missing connection during save
  useEffect(() => {
    const handleOnline = () => {
      if (useAppStore.getState().saveError === 'Connessione assente durante il salvataggio') {
        setSaveError(null);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [setSaveError]);

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
    const parsed = AppTabSchema.safeParse(newTab);
    if (!parsed.success) return;
    const validTab = parsed.data;

    if (validTab === activeTab) {
      if (validTab === 'training') setTrainingSubTab('session');
      if (validTab === 'nutrition') setNutritionSubTab('meals');
      if (validTab === 'data') setDataSubTab('measurements');
      
      tabScrollPositions[activeTab] = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    tabScrollPositions[activeTab] = window.scrollY;
    setVisitedTabs(prev => prev[validTab] ? prev : { ...prev, [validTab]: true });
    setActiveTab(validTab);
    currentTabRef.current = validTab;
    requestAnimationFrame(() => {
      const savedPos = tabScrollPositions[validTab] || 0;
      window.scrollTo({ top: savedPos, behavior: 'instant' });
    });
  };

  useEffect(() => {
    const handleNavEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const parsed = AppTabSchema.safeParse(detail);
      if (parsed.success) {
        handleTabChange(parsed.data);
      }
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

  if (compatibilityStatus === 'update-required') {
    return (
      <div id="auth-overlay" role="alert" aria-live="assertive">
        <div style={{ textAlign: 'center', maxWidth: '520px', padding: '32px', background: 'rgba(30, 41, 59, 0.96)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          <h1 style={{ color: 'var(--primary-color)', marginBottom: '12px' }}>Aggiornamento richiesto</h1>
          <p style={{ lineHeight: 1.5 }}>
            Questa copia di LogBook non può modificare in sicurezza i dati trovati. I dati locali e cloud sono stati lasciati intatti.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {compatibilityError ?? 'Aggiorna LogBook alla versione più recente prima di continuare.'}
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: '12px', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer' }}>
            Ricarica LogBook
          </button>
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
      {guestLoginOverlayVisible && (
        <div id="auth-overlay" style={{ zIndex: 10001 }}>
          <LoginBox onCancel={closeGuestLogin} />
        </div>
      )}
      {guestLoginMigrationPending && (
        <div id="auth-overlay" style={{ zIndex: 10001 }} role="status" aria-live="polite">
          <div id="auth-loading" style={{ textAlign: 'center', maxWidth: '400px', padding: '30px', background: 'rgba(30, 41, 59, 0.7)', backdropFilter: 'blur(10px)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)'}}>
            <h1 style={{color:'var(--primary-color)', marginBottom: '10px'}}>LogBook</h1>
            <div className="spinner" style={{margin: '20px auto'}}></div>
            <p>Preparazione account...</p>
          </div>
        </div>
      )}
      {guestLoginMigrationFailed && (
        <div id="auth-overlay" style={{ zIndex: 10001 }} role="alert" aria-live="assertive">
          <div style={{ textAlign: 'center', maxWidth: '460px', padding: '30px', background: 'rgba(30, 41, 59, 0.96)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <h1 style={{ color: 'var(--primary-color)', marginBottom: '10px' }}>Accesso non completato</h1>
            <p style={{ lineHeight: 1.5 }}>
              I dati salvati su questo dispositivo sono stati conservati.
            </p>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Riprova per completare in sicurezza la preparazione dell’account.
            </p>
            <button
              type="button"
              onClick={() => void retryGuestMigration()}
              style={{ marginTop: '12px', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer' }}
            >
              Riprova
            </button>
          </div>
        </div>
      )}
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
            onClick={openGuestLogin}
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
            Accedi
          </button>
        </div>
      )}
      {syncing && !guestLoginMigrationPending && !guestLoginMigrationFailed && (
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
        <ErrorBoundary key={isGuest ? 'guest' : currentUser?.uid}>
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

      {!hideBottomNav && <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />}
      {analyticsEnabled && <Analytics />}
      {analyticsEnabled && <SpeedInsights />}
    </>
  );
}

export default App;
