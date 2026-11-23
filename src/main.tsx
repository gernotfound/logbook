import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { readLocal } from './lib/sync/localRepository'
import { ensureLocalVaultReady } from './lib/sync/secureArchiveUnlockFlow'
import { readBrowserValueStrict } from './lib/sync/browserStorage'
import { captureSession, GUEST_REVOCATION_KEY, isActiveGuestSession, isCurrentSession } from './lib/sync/session'
import { isVaultUnlocked } from './lib/sync/secureArchiveSession'
import { readAuthenticatedOwnerHint } from './lib/sync/authOwnerHint'
import App from './App'
import { GuestOnlyAuthProvider } from './contexts/GuestOnlyAuthProvider'
import { KindeAccountSessionProvider } from './contexts/auth/KindeAccountSessionProvider'
import ErrorBoundary from './components/UI/ErrorBoundary'
import { useAppStore } from './store/useAppStore'
import { parseInitialUserData } from './store/slices/createDataSlice'
import './styles/global.css'
import { initializeAppearance } from './store/useAppearanceStore'
import { getInitialLocalWorkout } from './store/slices/createWorkoutSlice'
import type { UserData } from './types'

import { getCachedCatalog } from './lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from './lib/catalog/deltaResolver';

import { requestDurableStorage, setStorageDiagnosticData } from './lib/storageStatus';
import {
  getStorageMarker,
  updateStorageMarker,
  diagnoseStorageState,
} from './lib/storageIntegrity';
import { markTabSnapshotClean } from './lib/sync/tabSnapshotCausality';
import { isUpdateRequiredError } from './lib/schemaEvolution';
import ReloadPrompt from './components/UI/ReloadPrompt';
import { initializePWAInstallLifecycle } from './lib/pwaInstallLifecycle';

initializePWAInstallLifecycle();

const STORAGE_UNAVAILABLE_MESSAGE = 'Archivio del dispositivo non disponibile. TheLogBook non può determinare in sicurezza a chi appartengono i dati locali. Riapri l’app o riprova dopo aver riabilitato lo storage del browser.';

function renderStorageUnavailable(rootElement: HTMLElement | null): void {
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
          background: 'var(--bg-color)',
          color: 'var(--text-main)',
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
  initializeAppearance();
  const rootElement = document.getElementById('root');

  let isGuest = false;
  try {
    isGuest = readBrowserValueStrict('logbook_is_guest') === 'true' && readBrowserValueStrict(GUEST_REVOCATION_KEY) === null;
    // A persisted flag without an active guest generation is not an identity.
    if (isGuest && !isActiveGuestSession()) throw new Error('Generazione della sessione guest non verificabile.');
  } catch (error) {
    console.warn('Bootstrap bloccato: ownership storage non leggibile.', error);
    renderStorageUnavailable(rootElement);
    return;
  }

  if (typeof navigator !== 'undefined') {
    requestDurableStorage().then(data => {
      setStorageDiagnosticData(data);
    }).catch(console.error);
  }

  let marker: ReturnType<typeof getStorageMarker> = null;
  let bootstrapOwner: string | null = null;
  let bootstrapGuestSession: ReturnType<typeof captureSession> | null = null;
  let cached: UserData | undefined = undefined;
  let readError: unknown = null;

  try {
    // A persisted owner hint is not a Kinde session or a fitness grant.
    // Only an explicit future account lifecycle may unlock its owner vault;
    // this cold boot remains guest-only and never adopts a stale account.
    if (!isGuest) readAuthenticatedOwnerHint(); // strict validation only
    bootstrapOwner = isGuest ? 'guest' : null;
    if (bootstrapOwner) {
      bootstrapGuestSession = captureSession();
      if (bootstrapGuestSession.owner !== bootstrapOwner || !isCurrentSession(bootstrapGuestSession)) {
        throw new Error('Sessione guest non valida durante il bootstrap.');
      }
    }
  } catch (error) {
    console.warn('Bootstrap bloccato: owner autenticato locale non leggibile.', error);
    renderStorageUnavailable(rootElement);
    return;
  }

  // A cancelled readiness Promise may resolve without an unlocked vault.
  // Subsequent awaits also permit another tab to revoke this exact guest session.
  const assertBootstrapGuestCurrent = () => {
    if (bootstrapOwner && (!bootstrapGuestSession || !isCurrentSession(bootstrapGuestSession)
      || !isVaultUnlocked(bootstrapOwner))) {
      throw new Error('Sessione guest o archivio locale cambiati durante il bootstrap.');
    }
  };

  // No health data may enter memory before the original guest generation is verified.
  if (bootstrapOwner) {
    await ensureLocalVaultReady(bootstrapOwner);
    try { assertBootstrapGuestCurrent(); }
    catch (error) {
      console.warn('Bootstrap guest annullato: sessione o vault non più validi.', error);
      renderStorageUnavailable(rootElement);
      return;
    }
  }

  try {
    const catalog = await getCachedCatalog();
    assertBootstrapGuestCurrent();
    try {
      if (bootstrapOwner) {
        marker = getStorageMarker(undefined, bootstrapOwner);
        const localEnvelope = await readLocal(bootstrapOwner);
        assertBootstrapGuestCurrent();
        cached = localEnvelope?.data;
        useAppStore.setState({
          localWorkout: getInitialLocalWorkout(bootstrapOwner, cached?.activeWorkout ?? null, cached?.history, localEnvelope?.lastClosedWorkoutId, localEnvelope?.closedWorkoutIds),
        });
      } else {
        useAppStore.setState({ localWorkout: null });
      }
    } catch (err) {
      readError = err;
      console.warn("Errore recupero cache da IndexedDB:", err);
    }

    assertBootstrapGuestCurrent();
    const status = diagnoseStorageState({
      cachedData: cached,
      readError,
      marker,
      isGuest,
    });

    if (status === 'read_error') {
      if (isUpdateRequiredError(readError)) {
        useAppStore.getState().setUpdateRequired(readError);
      } else {
        renderStorageUnavailable(rootElement);
        return;
      }
    }

    if (status === 'invalid') {
      // An archive that failed schema validation is not an empty guest session.
      renderStorageUnavailable(rootElement);
      return;
    }

    if (isGuest && status === 'missing') {
      // A previous saved guest archive cannot be treated as a fresh start.
      // Preserve the surviving vault and marker for explicit recovery.
      console.warn('Archivio guest precedentemente salvato non più disponibile.');
      renderStorageUnavailable(rootElement);
      return;
    }

    if (status === 'valid' && cached) {
      cached = {
        ...cached,
        library: resolveEffectiveExercises(catalog.exercises, cached.library || [], cached.catalogOverrides),
        customFoods: resolveEffectiveFoods(catalog.foods, cached.customFoods || [], cached.catalogOverrides),
      };
      
      // Yield al main thread per garantire che il browser disegni la splash HTML
      // prima che Zod congeli il thread con la validazione sincrona massiva
      await new Promise(resolve => setTimeout(resolve, 0));
      
      assertBootstrapGuestCurrent();
      const initialData = parseInitialUserData(cached);
      if (!initialData) {
        renderStorageUnavailable(rootElement);
        return;
      }
      if (!useAppStore.getState().userData) {
        useAppStore.setState({ userData: initialData, dataOwner: bootstrapOwner });
      }
      const session = captureSession();
      if (bootstrapOwner === session.owner) markTabSnapshotClean(session, initialData);
      // Update marker ONLY after complete successful read and schema validation
      if (bootstrapOwner) updateStorageMarker(Date.now(), undefined, bootstrapOwner);
    }
  } catch (e) {
    console.warn("Errore generale durante bootstrap storage:", e);
    // A guest archive may still exist: never mount an unhydrated guest after a bootstrap failure.
    if (bootstrapOwner) {
      renderStorageUnavailable(rootElement);
      return;
    }
  }

  if (rootElement) {
    createRoot(rootElement).render(
      <StrictMode>
        <ErrorBoundary>
          <GuestOnlyAuthProvider>
            <KindeAccountSessionProvider>
              <ReloadPrompt />
              <App />
            </KindeAccountSessionProvider>
          </GuestOnlyAuthProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  }
};

if (typeof document !== 'undefined') {
  void initApp().catch(error => {
    console.error('Avvio TheLogBook non completato:', error);
    renderStorageUnavailable(document.getElementById('root'));
  });
}
