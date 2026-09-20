import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { auth } from './lib/firebase'
import { readLocal } from './lib/sync/localRepository'
import { readBrowserValueStrict } from './lib/sync/browserStorage'
import { storageOwner } from './lib/sync/session'
import { findPendingAccountDeletion, readAccountDeletionMarker } from './lib/sync/accountGate'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import ErrorBoundary from './components/UI/ErrorBoundary'
import { AccountDeletionRecovery } from './components/AccountDeletionRecovery'
import { useAppStore, getInitialUserData } from './store/useAppStore'
import './styles/global.css'
import { getInitialLocalWorkout } from './store/slices/createWorkoutSlice'
import type { UserData } from './types'

import { getCachedCatalog } from './lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from './lib/catalog/deltaResolver';

import { requestDurableStorage, setStorageDiagnosticData, getStorageDiagnosticData } from './lib/storageStatus';
import {
  getStorageMarker,
  updateStorageMarker,
  diagnoseStorageState,
  shouldReportAnomaly,
  isAnomalyAlreadyReported,
  markAnomalyReported,
  createStorageRecoveryAnomalyPayload,
  dispatchStorageRecoveryAnomaly,
} from './lib/storageTelemetry';
import { telemetryHub } from './lib/telemetryHub';

const STORAGE_UNAVAILABLE_MESSAGE = 'Archivio del dispositivo non disponibile. LogBook non può determinare in sicurezza a chi appartengono i dati locali. Riapri l’app o riprova dopo aver riabilitato lo storage del browser.';

function renderStorageUnavailable(rootElement: HTMLElement | null): void {
  window.__INITIAL_USER_DATA__ = null;
  useAppStore.setState({
    localPersistenceBlocked: true,
    syncHealth: 'failed',
    saveError: STORAGE_UNAVAILABLE_MESSAGE,
  });

  if (!rootElement) return;
  createRoot(rootElement).render(
    <StrictMode>
      <main
        id="storage-unavailable"
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#000',
          color: '#fff',
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '480px', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '12px' }}>Archivio non disponibile</h1>
          <p style={{ lineHeight: 1.5 }}>{STORAGE_UNAVAILABLE_MESSAGE}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ minHeight: '44px', padding: '10px 18px', marginTop: '8px' }}
          >
            Riprova
          </button>
        </div>
      </main>
    </StrictMode>,
  );
}

export const initApp = async () => {
  const rootElement = document.getElementById('root');

  let isGuest = false;
  try {
    isGuest = readBrowserValueStrict('logbook_is_guest') === 'true';
  } catch (error) {
    console.warn('Bootstrap bloccato: ownership storage non leggibile.', error);
    renderStorageUnavailable(rootElement);
    return;
  }

  try {
    telemetryHub.init();
  } catch (err) {
    console.warn('[TelemetryHub] Inizializzazione fallita (non bloccante):', err);
  }

  if (typeof navigator !== 'undefined') {
    requestDurableStorage().then(data => {
      setStorageDiagnosticData(data);
    }).catch(console.error);
  }

  const marker = getStorageMarker();

  let cached: UserData | undefined = undefined;
  let readError: unknown = null;

  try {
    const catalog = await getCachedCatalog();
    try {
      if (!isGuest && typeof auth.authStateReady === 'function') await auth.authStateReady();
      // A pending deletion marker can outlive Firebase Auth. Reuse it only when there is
      // no authenticated user, or when it belongs to the currently authenticated UID.
      // A stale marker from account A must never select A's envelope while account B is active.
      const currentUid = isGuest ? null : auth.currentUser?.uid ?? null;
      const pendingDeletion = isGuest
        ? null
        : currentUid
          ? readAccountDeletionMarker('user:' + currentUid)
          : findPendingAccountDeletion();
      const bootstrapOwner = isGuest ? 'guest' : (pendingDeletion?.owner ?? storageOwner());
      cached = (await readLocal(bootstrapOwner))?.data;
      useAppStore.setState({ localWorkout: getInitialLocalWorkout() });
    } catch (err) {
      readError = err;
      console.warn("Errore recupero cache da IndexedDB:", err);
    }

    const status = diagnoseStorageState({
      cachedData: cached,
      readError,
      marker,
      isGuest,
    });

    if (status === 'valid' && cached) {
      cached = {
        ...cached,
        library: resolveEffectiveExercises(catalog.exercises, cached.library || [], cached.catalogOverrides),
        customFoods: resolveEffectiveFoods(catalog.foods, cached.customFoods || [], cached.catalogOverrides),
      };
      window.__INITIAL_USER_DATA__ = cached;
      
      // Yield al main thread per garantire che il browser disegni lo spinner HTML
      // prima che Zod congeli il thread con la validazione sincrona massiva
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const initialData = getInitialUserData();
      if (initialData) {
        if (!useAppStore.getState().userData) {
          useAppStore.setState({ userData: initialData });
        }
        // Update marker ONLY after complete successful read and schema validation
        updateStorageMarker();
      }
    } else {
      window.__INITIAL_USER_DATA__ = null;

      if (shouldReportAnomaly(status, marker)) {
        if (!isAnomalyAlreadyReported(marker!)) {
          markAnomalyReported(marker!);
          const payload = createStorageRecoveryAnomalyPayload({
            marker: marker!,
            persisted: getStorageDiagnosticData()?.persistent ?? null,
          });
          // Fire-and-forget: do not block render
          dispatchStorageRecoveryAnomaly(payload).catch((err) => {
            console.warn("Invio telemetria anomalia storage fallito (non bloccante):", err);
          });
        }
      }
    }
  } catch (e) {
    console.warn("Errore generale durante bootstrap storage:", e);
    window.__INITIAL_USER_DATA__ = null;
  }

  if (rootElement) {
    createRoot(rootElement, {
      onCaughtError(error, errorInfo) {
        telemetryHub.trackError(error, {
          source: 'react_caught',
          componentStack: errorInfo?.componentStack,
        });
      },
      onUncaughtError(error, errorInfo) {
        telemetryHub.trackError(error, {
          source: 'react_uncaught',
          componentStack: errorInfo?.componentStack,
        });
      },
      onRecoverableError(error, errorInfo) {
        telemetryHub.trackError(error, {
          source: 'react_recoverable',
          componentStack: errorInfo?.componentStack,
        });
      },
    }).render(
      <StrictMode>
        <ErrorBoundary>
          <AuthProvider>
            <AccountDeletionRecovery />
            <App />
          </AuthProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  }
};

if (typeof document !== 'undefined') {
  initApp();
}
