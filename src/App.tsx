import { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './store/useAppStore';
import { analytics, getAnalyticsConsent } from './lib/firebase';
import { logEvent } from 'firebase/analytics';
import { useLocalStorage } from './hooks/useLocalStorage';
import { TriangleAlert, X } from 'lucide-react';
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
import { SyncConflictPanel } from './components/UI/SyncConflictPanel';

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
  const [activeTab, setActiveTab] = useLocalStorage<AppTab>(LOCAL_STORAGE_ACTIVE_TAB, 'home', AppTabSchema);
  const [trainingSubTab, setTrainingSubTab] = useLocalStorage<TrainingSubTab>(LOCAL_STORAGE_TRAINING_TAB, 'session', TrainingSubTabSchema);
  const [nutritionSubTab, setNutritionSubTab] = useLocalStorage<NutritionSubTab>(LOCAL_STORAGE_NUTRITION_TAB, 'meals', NutritionSubTabSchema);
  const [dataSubTab, setDataSubTab] = useLocalStorage<DataSubTab>(LOCAL_STORAGE_DATA_TAB, 'measurements', DataSubTabSchema);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());

  const showConsentOverlay = userData && needsLegalUpdate(userData.legalConsent);

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
      // Comportamento di "reset": clicco sulla tab già attiva
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
        <div id="auth-loading" className="auth-loading-card">
          <h1>LogBook</h1>
          <div className="spinner" />
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

      {isGuest && (
        <div className="guest-mode-banner">
          <span className="guest-mode-banner__text">
            Modalità locale · I dati sono solo su questo dispositivo
          </span>
          <button
            type="button"
            className="guest-mode-banner__action"
            onClick={linkGoogleAccount}
          >
            Collega Google
          </button>
        </div>
      )}

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

      {saveError && (
        <div
          className="sync-error-toast"
          role="alert"
          aria-live="assertive"
        >
          <span className="sync-error-icon" aria-hidden="true"><TriangleAlert size={18} /></span>
          <span className="sync-error-text">{saveError}</span>
          <button
            type="button"
            className="sync-error-close"
            aria-label="Chiudi avviso"
            onClick={() => setSaveError(null)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      <main id="app-container" className={isGuest ? 'app-shell app-shell--guest' : 'app-shell'}>
        <SyncConflictPanel key={isGuest ? 'guest' : currentUser?.uid} />
        <ErrorBoundary key={isGuest ? 'guest' : currentUser?.uid}>
          <Suspense fallback={
            <div className="app-suspense">
              <div className="spinner" />
              <p>Caricamento...</p>
            </div>
          }>
            <div className="app-tab-panel" hidden={activeTab !== 'home'}>
              {(visitedTabs.home || activeTab === 'home') && <HomeView onNavigate={handleTabChange} />}
            </div>
            <div className="app-tab-panel" hidden={activeTab !== 'training'}>
              {(visitedTabs.training || activeTab === 'training') && <TrainingView subTab={trainingSubTab} setSubTab={setTrainingSubTab} />}
            </div>
            <div className="app-tab-panel" hidden={activeTab !== 'nutrition'}>
              {(visitedTabs.nutrition || activeTab === 'nutrition') && <NutritionView subTab={nutritionSubTab} setSubTab={setNutritionSubTab} />}
            </div>
            <div className="app-tab-panel" hidden={activeTab !== 'data'}>
              {(visitedTabs.data || activeTab === 'data') && <DataView subTab={dataSubTab} setSubTab={setDataSubTab} />}
            </div>
            <div className="app-tab-panel" hidden={activeTab !== 'settings'}>
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
