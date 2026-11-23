import { useState, useEffect, useRef, useSyncExternalStore, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './store/useAppStore';
import { requiredUpdateHardReload } from './lib/sync/safeReload';
import { scheduleSequentialIdlePreload } from './lib/backgroundPreload';
import { useAppNavigation } from './hooks/useAppNavigation';
import { GuestBanner, GuestKindeTransitionGate } from './components/UI/AppGuestAccess';
import { RequiredUpdateGate, GuestMigrationFailureGate } from './components/UI/AppOperationalGates';

import ErrorBoundary from './components/UI/ErrorBoundary';
import BrandLoadingScreen from './components/UI/BrandLoadingScreen';
import BottomNav from './components/UI/BottomNav';
import { GlobalDialog } from './components/UI/GlobalDialog';
import { ConsentOverlay } from './components/UI/ConsentOverlay';
import { HealthConsentSuspended } from './components/UI/HealthConsentSuspended';
import { currentHealthConsentStatus, getGuestHealthConsentStatus, getServerConfirmedLegalConsent, refreshHealthConsent, refreshHealthConsentFromStorage, subscribeHealthConsent } from './lib/healthConsent';
import { needsLegalUpdate } from './lib/legalVersions';
import { KindeAccountEntry } from './components/UI/KindeAccountEntry';
import { EmailVerificationGate } from './components/UI/EmailVerificationGate';
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

function readStartupTabShortcut(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('tab');
}

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


// Reset every ephemeral view/hook on an identity boundary, not only persisted tabs.
function App() {
  const { currentUser, isGuest } = useAuth();
  // Capture the PWA shortcut once, before the URL is consumed by the child.
  const [startupTab] = useState(readStartupTabShortcut);
  const owner = currentUser ? `user:${currentUser.uid}` : isGuest ? 'guest' : 'unbound';
  return <OwnerBoundApp key={owner} startupTab={startupTab} />;
}

function OwnerBoundApp({ startupTab }: { startupTab: string | null }) {
  const { currentUser, loading, isGuest, guestMigrationStatus, retryGuestMigration, emailVerificationRequired, loginAsGuest } = useAuth();
  const healthConsentStatus = useSyncExternalStore(subscribeHealthConsent, () => currentUser ? currentHealthConsentStatus(currentUser.uid) : isGuest ? getGuestHealthConsentStatus() : currentHealthConsentStatus(undefined), () => 'checking' as const);
  useEffect(() => {
    if (!currentUser || isGuest || emailVerificationRequired) return;
    const reconcile = () => { void refreshHealthConsent(currentUser); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === `logbook:v2:user:${currentUser.uid}:health-consent-withdrawal`) {
        refreshHealthConsentFromStorage();
        reconcile();
      }
    };
    // AuthProvider owns focus/online/visibility rechecks. Running a second
    // check here would supersede the first result and briefly fence the UI.
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [currentUser, isGuest, emailVerificationRequired]);
  useEffect(() => {
    if (!isGuest) return;
    const reconcileGuest = (event: StorageEvent) => {
      if (event.key === 'logbook:v2:guest:health-consent-withdrawal') {
        refreshHealthConsentFromStorage();
      }
    };
    const onFocus = () => refreshHealthConsentFromStorage();
    window.addEventListener('storage', reconcileGuest);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', reconcileGuest);
      window.removeEventListener('focus', onFocus);
    };
  }, [isGuest]);
  const syncing = useAppStore(state => state.syncing);
  const hasStoredUserData = useAppStore(state => state.userData !== null);
  const needsLocalLegalUpdate = useAppStore(state => needsLegalUpdate(state.userData?.legalConsent));
  const dataOwner = useAppStore(state => state.dataOwner);
  const hasLocalWorkout = useAppStore(state => state.localWorkout !== null);
  const saveError = useAppStore(state => state.saveError);
  const syncHealth = useAppStore(state => state.syncHealth);
  const syncPresentation = useAppStore(state => state.syncPresentation);
  const localPersistenceBlocked = useAppStore(state => state.localPersistenceBlocked);
  const cloudIntegrityBlocked = useAppStore(state => state.cloudIntegrityBlocked);
  const setSaveError = useAppStore(state => state.setSaveError);
  const submitLegalConsent = useAppStore(state => state.submitLegalConsent);
  const compatibilityStatus = useAppStore(state => state.compatibilityStatus);
  const compatibilityError = useAppStore(state => state.compatibilityError);
  // Navigation preferences cannot cross an owner/session boundary.
  const navigationOwner = isGuest ? 'guest' : currentUser ? `user:${currentUser.uid}` : 'unbound';
  const {
    activeTab, trainingSubTab, setTrainingSubTab, nutritionSubTab, setNutritionSubTab,
    dataSubTab, setDataSubTab, settingsOpen, visitedTabs,
    handleOpenSettings, handleCloseSettings, handleTabChange, handleHomeNavigate,
  } = useAppNavigation(navigationOwner, startupTab);
  const [requiredUpdateReloading, setRequiredUpdateReloading] = useState(false);
  // React may disable the button after a second update handler has entered.
  const requiredUpdateReloadInFlight = useRef(false);
  const [requiredUpdateReloadError, setRequiredUpdateReloadError] = useState<string | null>(null);

  const [showGuestLogin, setShowGuestLogin] = useState(readGuestLoginOverlayState);

  const hasUserData = hasStoredUserData && dataOwner === navigationOwner;
  const [serverConsentSyncFailed, setServerConsentSyncFailed] = useState(false);
  const serverConsentSyncAttempted = useRef(false);
  const acceptedOnServer = currentUser && !isGuest && healthConsentStatus === 'active'
    ? getServerConfirmedLegalConsent(currentUser.uid) : null;
  const persistTrustedLegal = !!acceptedOnServer && hasUserData
    && needsLocalLegalUpdate && !serverConsentSyncFailed
    && guestMigrationStatus === 'idle';
  useEffect(() => {
    if (!persistTrustedLegal || !acceptedOnServer || serverConsentSyncAttempted.current) return;
    serverConsentSyncAttempted.current = true;
    // The explicit acceptance already exists in the trusted record for this UID
    // and these exact versions. Persist the matching local legalConsent once,
    // through the canonical durable Domain Operation rather than a second form.
    void submitLegalConsent(acceptedOnServer).catch(error => {
      console.error('Consenso server registrato ma cache locale non aggiornata:', error);
      setServerConsentSyncFailed(true);
      setSaveError('Consenso server confermato ma salvataggio locale non riuscito. Riprova dalla schermata dei termini.');
    });
  }, [persistTrustedLegal, acceptedOnServer, submitLegalConsent, setSaveError]);
  const showConsentOverlay = hasUserData && needsLocalLegalUpdate && !persistTrustedLegal;
  const guestLoginOverlayVisible = showGuestLogin && isGuest && !currentUser && guestMigrationStatus === 'idle';
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


  // Transient errors auto-dismiss. A failed sync must remain visible until
  // a subsequent verified recovery; a toast timeout is not cloud evidence.
  useEffect(() => {
    if (!saveError || syncHealth === 'failed' || localPersistenceBlocked || cloudIntegrityBlocked) return;
    const timer = setTimeout(() => {
      setSaveError(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [saveError, syncHealth, localPersistenceBlocked, cloudIntegrityBlocked, setSaveError]);

  // Warm the remaining primary view modules only after startup/auth/sync settles.
  // Importing code here does not mount hidden views or start their hooks.
  useEffect(() => {
    const appBlocked = loading
      || emailVerificationRequired
      || syncing
      || compatibilityStatus === 'update-required'
      || !hasUserData
      || (!currentUser && !isGuest)
      || guestLoginMigrationPending
      || guestLoginMigrationFailed
      || Boolean(showConsentOverlay)
      || (healthConsentStatus !== 'active')
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
    emailVerificationRequired,
    guestLoginMigrationFailed,
    guestLoginMigrationPending,
    guestLoginOverlayVisible,
    hasUserData,
    healthConsentStatus,
    isGuest,
    loading,
    settingsOpen,
    showConsentOverlay,
    syncing,
  ]);


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
    if (requiredUpdateReloadInFlight.current) return;
    requiredUpdateReloadInFlight.current = true;
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
      requiredUpdateReloadInFlight.current = false;
      setRequiredUpdateReloading(false);
    }
  };

  if (loading) {
    return <BrandLoadingScreen label="Avvio di TheLogBook in corso" />;
  }

  if (compatibilityStatus === 'update-required') {
    return <RequiredUpdateGate compatibilityError={compatibilityError} requiredUpdateReloadError={requiredUpdateReloadError}
      requiredUpdateReloading={requiredUpdateReloading} onReload={() => { void handleRequiredUpdateReload(); }} />;
  }

  if (currentUser && emailVerificationRequired) {
    return <><GlobalDialog /><EmailVerificationGate /></>;
  }

  if (!currentUser && !isGuest) {
    return (
      <div id="auth-overlay" className="auth-entry-overlay">
        <GlobalDialog />
        <div className="auth-entry">
          <h1 className="auth-entry-title">TheLogBook</h1>
          <KindeAccountEntry identityOnly onLocalGuest={loginAsGuest} />
        </div>
      </div>
    );
  }

  if (guestLoginMigrationPending) {
    return <BrandLoadingScreen label="Preparazione account in corso" />;
  }

  if (guestLoginMigrationFailed) {
    return <GuestMigrationFailureGate isGuest={isGuest} retryGuestMigration={retryGuestMigration} />;
  }

  if ((isGuest || currentUser) && healthConsentStatus !== 'active') {
    return <><GlobalDialog /><HealthConsentSuspended key={currentUser ? `user:${currentUser.uid}` : 'guest'} status={healthConsentStatus} user={currentUser} /></>;
  }

  // Never render an unowned/foreign snapshot in a newly authenticated view.
  if ((currentUser || isGuest) && (hasStoredUserData || hasLocalWorkout) && dataOwner !== navigationOwner) {
    return <BrandLoadingScreen label="Preparazione account in corso" />;
  }

  if (persistTrustedLegal) return <BrandLoadingScreen label="Registrazione del consenso sul dispositivo" />;

  return (
    <>
      <GlobalDialog />
      {showConsentOverlay && <ConsentOverlay />}
      {guestLoginOverlayVisible && (
        <div id="auth-overlay" style={{ zIndex: 10001 }}>
          <GuestKindeTransitionGate onClose={closeGuestLogin} />
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
          {syncHealth !== 'failed' && !localPersistenceBlocked && !cloudIntegrityBlocked && (
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
                  : <HomeView onNavigate={handleHomeNavigate} onOpenSettings={handleOpenSettings} isActive={activeTab === 'home'} />
              )}
            </div>
            <div style={{ display: activeTab === 'training' ? 'block' : 'none' }}>
              {(visitedTabs.training || activeTab === 'training') && <TrainingView subTab={trainingSubTab} setSubTab={setTrainingSubTab} isActive={activeTab === 'training'} />}
            </div>
            <div style={{ display: activeTab === 'nutrition' ? 'block' : 'none' }}>
              {(visitedTabs.nutrition || activeTab === 'nutrition') && <NutritionView subTab={nutritionSubTab} setSubTab={setNutritionSubTab} />}
            </div>
            <div style={{ display: activeTab === 'data' ? 'block' : 'none' }}>
              {(visitedTabs.data || activeTab === 'data') && <DataView subTab={dataSubTab} setSubTab={setDataSubTab} isActive={activeTab === 'data'} />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>

      {!hideBottomNav && <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />}
    </>
  );
}

export default App;
