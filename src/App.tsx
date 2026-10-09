import { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './store/useAppStore';
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
import { requiredUpdateHardReload } from './lib/sync/safeReload';
import { scheduleSequentialIdlePreload } from './lib/backgroundPreload';

import ErrorBoundary from './components/UI/ErrorBoundary';
import BrandLoadingScreen from './components/UI/BrandLoadingScreen';
import BottomNav from './components/UI/BottomNav';
import { GlobalDialog } from './components/UI/GlobalDialog';
import { ConsentOverlay } from './components/UI/ConsentOverlay';
import { HealthConsentSuspendedScreen } from './components/UI/HealthConsentSuspendedScreen';
import { useHealthConsentRevocation } from './hooks/useHealthConsentRevocation';
import { needsLegalUpdate } from './lib/legalVersions';
import { LoginBox } from './components/UI/LoginBox';
import { AlertTriangle, X } from 'lucide-react';

const loadHomeView = () => import('./components/Home/HomeView');
const loadTrainingView = () => import('./components/Training/TrainingView');
const loadNutritionView = () => import('./components/Nutrition/NutritionView');
const loadDataView = () => import('./components/Data/DataView');
const loadSettingsView = () => import('./components/SettingsView');

const HomeView = lazy(loadHomeView);
const TrainingView = lazy(loadTrainingView);
const NutritionView = lazy(loadNutritionView);
const DataView = lazy(loadDataView);
const SettingsView = lazy(loadSettingsView);

const BACKGROUND_VIEW_PRELOAD_ORDER = [
  ['home', loadHomeView],
  ['training', loadTrainingView],
  ['nutrition', loadNutritionView],
  ['data', loadDataView],
  ['settings', loadSettingsView],
] as const;

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

function GuestBanner({ onLogin }: { onLogin: () => void }) {
  const { logout } = useAuth();

  return (
    <div className="guest-banner">
      <AlertTriangle size={20} aria-hidden="true" />
      <span className="guest-banner-text">Modalità locale · I dati sono solo su questo dispositivo</span>
      <div className="guest-banner-actions">
        <button type="button" className="btn btn-small" onClick={onLogin}>
          Accedi
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => { void logout({ mode: 'normal' }); }}
        >
          Esci
        </button>
      </div>
    </div>
  );
}

function App() {
  const { currentUser, loading, isGuest, guestMigrationStatus, retryGuestMigration } = useAuth();
  const consentOwner = isGuest ? 'guest' : currentUser ? 'user:' + currentUser.uid : null;
  const healthRevocation = useHealthConsentRevocation(consentOwner);
  const syncing = useAppStore(state => state.syncing);
  const userData = useAppStore(state => state.userData);
  const saveError = useAppStore(state => state.saveError);
  const syncHealth = useAppStore(state => state.syncHealth);
  const syncPresentation = useAppStore(state => state.syncPresentation);
  const localPersistenceBlocked = useAppStore(state => state.localPersistenceBlocked);
  const setSaveError = useAppStore(state => state.setSaveError);
  const compatibilityStatus = useAppStore(state => state.compatibilityStatus);
  const compatibilityError = useAppStore(state => state.compatibilityError);
  const [activeTab, setActiveTab] = useLocalStorage<AppTab>(LOCAL_STORAGE_ACTIVE_TAB, 'home', AppTabSchema);
  const [trainingSubTab, setTrainingSubTab] = useLocalStorage<TrainingSubTab>(LOCAL_STORAGE_TRAINING_TAB, 'session', TrainingSubTabSchema);
  const [nutritionSubTab, setNutritionSubTab] = useLocalStorage<NutritionSubTab>(LOCAL_STORAGE_NUTRITION_TAB, 'meals', NutritionSubTabSchema);
  const [dataSubTab, setDataSubTab] = useLocalStorage<DataSubTab>(LOCAL_STORAGE_DATA_TAB, 'measurements', DataSubTabSchema);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requiredUpdateReloading, setRequiredUpdateReloading] = useState(false);
  const [requiredUpdateReloadError, setRequiredUpdateReloadError] = useState<string | null>(null);

  const [showGuestLogin, setShowGuestLogin] = useState(readGuestLoginOverlayState);

  const hasUserData = Boolean(userData);
  const showConsentOverlay = userData && healthRevocation === 'none' && needsLegalUpdate(userData.legalConsent);
  const guestLoginOverlayVisible = showGuestLogin && (!currentUser || (isGuest && guestMigrationStatus === 'idle'));
  const guestLoginMigrationPending = !!currentUser && guestMigrationStatus === 'pending';
  const guestLoginMigrationFailed = !!currentUser && guestMigrationStatus === 'failed';
  const hideBottomNav = guestLoginOverlayVisible;
  const quietWorkoutSync = syncPresentation === 'quiet-workout';
  const showSyncIndicator = syncing && !quietWorkoutSync;
  const showSaveError = Boolean(saveError) && !(quietWorkoutSync && syncHealth === 'local-pending');

  const openGuestLogin = () => {
    persistGuestLoginOverlayState(true);
    setShowGuestLogin(true);
  };

  const closeGuestLogin = () => {
    persistGuestLoginOverlayState(false);
    setShowGuestLogin(false);
  };

  useEffect(() => {
    if (showGuestLogin && currentUser && !isGuest && guestMigrationStatus === 'idle' && !syncing) {
      persistGuestLoginOverlayState(false);
      setShowGuestLogin(false);
    }
  }, [showGuestLogin, currentUser, isGuest, guestMigrationStatus, syncing]);

  // Handle URL parameters for PWA shortcuts. "settings" remains a
  // compatibility alias even though it is no longer a primary tab.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam) {
        if (tabParam === 'settings') {
          if (activeTab !== 'home') setActiveTab('home');
          setSettingsOpen(true);
        } else {
          const parsed = AppTabSchema.safeParse(tabParam);
          if (parsed.success && parsed.data !== activeTab) {
            setActiveTab(parsed.data);
          }
          setSettingsOpen(false);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [activeTab, setActiveTab]);

  // Transient save errors auto-dismiss. A local persistence failure is a durable
  // write barrier and must remain visible until the app lifecycle resets it.
  useEffect(() => {
    if (!saveError || localPersistenceBlocked) return;
    const timer = setTimeout(() => {
      setSaveError(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [saveError, localPersistenceBlocked, setSaveError]);

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

  // Warm the remaining primary view modules only after startup/auth/sync settles.
  // Importing code here does not mount hidden views or start their hooks.
  useEffect(() => {
    const appBlocked = loading
      || syncing
      || compatibilityStatus === 'update-required'
      || !hasUserData
      || (!currentUser && !isGuest)
      || guestLoginMigrationPending
      || guestLoginMigrationFailed
      || Boolean(showConsentOverlay)
      || healthRevocation !== 'none'
      || guestLoginOverlayVisible
      || settingsOpen;

    if (appBlocked) return;

    const preloadTasks = BACKGROUND_VIEW_PRELOAD_ORDER
      .filter(([view]) => view !== activeTab)
      .map(([, preload]) => preload);

    return scheduleSequentialIdlePreload(preloadTasks);
  }, [
    activeTab,
    compatibilityStatus,
    currentUser,
    guestLoginMigrationFailed,
    guestLoginMigrationPending,
    guestLoginOverlayVisible,
    hasUserData,
    isGuest,
    loading,
    settingsOpen,
    showConsentOverlay,
    healthRevocation,
    syncing,
  ]);

  // Track visited tabs for lazy Keep-Alive rendering
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>(() => ({ [activeTab]: true }));

  // Preserve and restore scroll position across tabs without mutating React state.
  const tabScrollPositions = useRef<Record<string, number>>({});

  const handleOpenSettings = () => {
    tabScrollPositions.current.home = window.scrollY;
    setSettingsOpen(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: tabScrollPositions.current.home || 0, behavior: 'instant' });
    });
  };

  const handleTabChange = (newTab: string) => {
    const parsed = AppTabSchema.safeParse(newTab);
    if (!parsed.success) return;
    const validTab = parsed.data;
    const wasSettingsOpen = settingsOpen;

    if (wasSettingsOpen) setSettingsOpen(false);

    if (validTab === activeTab) {
      if (validTab === 'training') setTrainingSubTab('session');
      if (validTab === 'nutrition') setNutritionSubTab('meals');
      if (validTab === 'data') setDataSubTab('measurements');

      tabScrollPositions.current[activeTab] = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (!wasSettingsOpen) tabScrollPositions.current[activeTab] = window.scrollY;
    setVisitedTabs(prev => prev[validTab] ? prev : { ...prev, [validTab]: true });
    setActiveTab(validTab);
    requestAnimationFrame(() => {
      const savedPos = tabScrollPositions.current[validTab] || 0;
      window.scrollTo({ top: savedPos, behavior: 'instant' });
    });
  };

  const handleHomeNavigate = (tab: string) => {
    if (tab === 'settings') {
      handleOpenSettings();
      return;
    }
    if (tab === 'training-history') {
      setTrainingSubTab('history');
      handleTabChange('training');
      return;
    }
    if (tab === 'training') setTrainingSubTab('session');
    if (tab === 'nutrition') setNutritionSubTab('meals');
    handleTabChange(tab);
  };

  useEffect(() => {
    const handleNavEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === 'settings') {
        if (activeTab !== 'home') setActiveTab('home');
        setSettingsOpen(true);
        return;
      }
      const parsed = AppTabSchema.safeParse(detail);
      if (parsed.success) {
        handleTabChange(parsed.data);
      }
    };
    window.addEventListener('app:navigate', handleNavEvent);
    return () => window.removeEventListener('app:navigate', handleNavEvent);
  }, [activeTab, settingsOpen]);

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

  const handleRequiredUpdateReload = async () => {
    if (requiredUpdateReloading) return;
    setRequiredUpdateReloading(true);
    setRequiredUpdateReloadError(null);
    try {
      await requiredUpdateHardReload();
    } catch (error) {
      setRequiredUpdateReloadError(
        error instanceof Error
          ? error.message
          : 'Impossibile preparare il dispositivo al ricaricamento. Riprova.',
      );
      setRequiredUpdateReloading(false);
    }
  };

  if (loading) {
    return <BrandLoadingScreen label="Avvio di TheLogBook in corso" />;
  }

  if (compatibilityStatus === 'update-required') {
    return (
      <div id="auth-overlay" role="alert" aria-live="assertive">
        <div className="auth-panel">
          <h1 className="text-primary mb-10">Aggiornamento richiesto</h1>
          <p style={{ lineHeight: 1.5 }}>
            Questa copia di TheLogBook non può modificare in sicurezza i dati trovati. I dati locali e cloud sono stati lasciati intatti.
          </p>
          <p className="text-muted">
            {compatibilityError ?? 'Aggiorna TheLogBook alla versione più recente prima di continuare.'}
          </p>
          {requiredUpdateReloadError && (
            <p role="alert" className="text-muted">
              {requiredUpdateReloadError}
            </p>
          )}
          <button
            type="button"
            onClick={() => { void handleRequiredUpdateReload(); }}
            className="btn btn-primary"
            disabled={requiredUpdateReloading}
          >
            {requiredUpdateReloading ? 'Aggiornamento…' : 'Ricarica TheLogBook'}
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

  if (guestLoginMigrationPending) {
    return <BrandLoadingScreen label="Preparazione account in corso" />;
  }

  if (guestLoginMigrationFailed) {
    return (
      <div id="auth-overlay" style={{ zIndex: 10001 }} role="alert" aria-live="assertive">
        <div className="auth-panel">
          <h1 className="text-primary mb-10">Accesso non completato</h1>
          <p style={{ lineHeight: 1.5 }}>
            I dati salvati su questo dispositivo sono stati conservati.
          </p>
          <p className="text-muted">
            {isGuest
              ? 'Scegli esplicitamente come gestire i dati locali prima di continuare.'
              : 'Riprova per completare in sicurezza la preparazione dell’account.'}
          </p>
          {isGuest ? (
            <div style={{ display: 'grid', gap: '10px' }}>
              <button
                type="button"
                onClick={() => void retryGuestMigration('merge')}
                className="btn btn-primary"
              >
                Trasferisci i progressi nell’account
              </button>
              <button
                type="button"
                onClick={() => void retryGuestMigration('skip')}
                className="btn"
              >
                Non trasferire i progressi
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void retryGuestMigration()}
              className="btn btn-primary"
            >
              Riprova
            </button>
          )}
        </div>
      </div>
    );
  }

  if (healthRevocation !== 'none') {
    return (
      <>
        <GlobalDialog />
        <HealthConsentSuspendedScreen status={healthRevocation} />
      </>
    );
  }

  return (
    <>
      <GlobalDialog />
      {showConsentOverlay && <ConsentOverlay />}
      {guestLoginOverlayVisible && (
        <div id="auth-overlay" style={{ zIndex: 10001 }}>
          <LoginBox onCancel={closeGuestLogin} />
        </div>
      )}
      {isGuest && <GuestBanner onLogin={openGuestLogin} />}
      {showSyncIndicator && (
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

      {showSaveError && saveError && (
        <div
          className="sync-error-toast"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle className="sync-error-icon" size={20} aria-hidden="true" />
          <span className="sync-error-text">{saveError}</span>
          {!localPersistenceBlocked && (
            <button
              type="button"
              className="sync-error-close"
              aria-label="Chiudi avviso"
              onClick={() => setSaveError(null)}
            >
              <X size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <main id="app-container">
        <ErrorBoundary key={isGuest ? 'guest' : currentUser?.uid}>
          <Suspense fallback={
            <BrandLoadingScreen variant="content" label="Caricamento sezione in corso" />
          }>
            <div style={{ display: activeTab === 'home' ? 'block' : 'none' }}>
              {(visitedTabs.home || activeTab === 'home') && (
                settingsOpen
                  ? <SettingsView onClose={handleCloseSettings} />
                  : <HomeView onNavigate={handleHomeNavigate} onOpenSettings={handleOpenSettings} />
              )}
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
          </Suspense>
        </ErrorBoundary>
      </main>

      {!hideBottomNav && <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />}
    </>
  );
}

export default App;
