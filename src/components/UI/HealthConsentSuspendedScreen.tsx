import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ShieldAlert, Trash2, RefreshCw } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import { useAppStore } from '../../store/useAppStore';
import { eraseWithdrawnLocalTracking } from '../../lib/healthConsentLocalErasure';
import { healthConsentLaunchAvailable } from '../../lib/healthConsentLaunch';
import { DB } from '../../lib/db';
import { getDb } from '../../lib/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useDialogStore } from '../../store/useDialogStore';
import { requestHealthConsentRevocation } from '../../lib/requestHealthConsentRevocation';
import type { HealthConsentGateStatus } from '../../hooks/useHealthConsentRevocation';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';

export function HealthConsentSuspendedScreen({ status }: { status: HealthConsentGateStatus }) {
  const launchAvailable = healthConsentLaunchAvailable();
  const { isGuest, currentUser } = useAuth();
  const owner = isGuest ? 'guest' : currentUser ? 'user:' + currentUser.uid : null;
  const { handleDeleteAccount, deletingAccount } = useSettings();
  const clearedOwner = useRef<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [localErasure, setLocalErasure] = useState<'checking' | 'complete' | 'failed' | 'deferred'>(launchAvailable ? 'checking' : 'deferred');
  const [cloudErasure, setCloudErasure] = useState<'pending' | 'complete' | 'failed' | 'blocked'>('pending');

  const eraseLocal = useCallback(async () => {
    if (!owner || status === 'unavailable' || status === 'none') return;
    if (!launchAvailable) { setLocalErasure('deferred'); return; }
    // Volatile business state must be invalidated before any asynchronous
    // IndexedDB cleanup, including in a second tab discovering the revocation.
    const currentState = useAppStore.getState();
    if (clearedOwner.current !== owner || currentState.userData || currentState.localWorkout) {
      currentState.resetStore();
      DB.resetCache();
      clearedOwner.current = owner;
    }
    try {
      await eraseWithdrawnLocalTracking(owner);
      setLocalErasure('complete');
    } catch {
      setLocalErasure('failed');
    }
  }, [owner, status, launchAvailable]);

  useEffect(() => {
    if (!owner || status === 'unavailable' || status === 'none') return;
    // Schedule the destructive local check after the current render commits.
    // A dismissed effect must not operate on an obsolete account/session.
    let active = true;
    queueMicrotask(() => { if (active) void eraseLocal(); });
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      setLocalErasure('checking');
      void eraseLocal();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner, eraseLocal, status]);

  useEffect(() => {
    if (!launchAvailable || !owner || isGuest || status === 'unavailable') return;
    const uid = owner.slice(5);
    return onSnapshot(doc(getDb(), 'health_consent_revocations', uid), snapshot => {
      if (!snapshot.exists()) { setCloudErasure('pending'); return; }
      const value = snapshot.data().eraseStatus;
      setCloudErasure(value === 'complete' ? 'complete' : value === 'blocked' ? 'blocked' : value === 'failed' ? 'failed' : 'pending');
    }, () => setCloudErasure('pending'));
  }, [owner, isGuest, status, launchAvailable]);

  useEffect(() => {
    if (!launchAvailable || isGuest || status !== 'pending') return;
    let active = true;
    let inProgress = false;
    const retryOnline = () => {
      if (!active || inProgress || !navigator.onLine) return;
      inProgress = true;
      void requestHealthConsentRevocation().catch(() => {
        // The durable pending marker remains the source of truth.
      }).finally(() => { inProgress = false; });
    };
    window.addEventListener('online', retryOnline);
    retryOnline();
    return () => {
      active = false;
      window.removeEventListener('online', retryOnline);
    };
  }, [isGuest, status, launchAvailable]);

  const retry = async () => {
    if (!launchAvailable || retrying) return;
    setRetrying(true);
    try {
      await requestHealthConsentRevocation();
    } catch {
      await useDialogStore.getState().showAlert(status === 'confirmed'
        ? 'La revoca resta valida, ma non è stato possibile ritentare la cancellazione cloud. Riprova più tardi.'
        : 'Il server non ha ancora confermato la revoca. La sospensione su questo dispositivo rimane attiva.');
    } finally {
      setRetrying(false);
    }
  };

  const confirmed = status === 'confirmed';
  const pending = status === 'pending';

  return (
    <div id="auth-overlay" role="main" aria-labelledby="health-revocation-title">
      <div className="auth-panel" style={{ display: 'grid', gap: '1rem' }}>
        <ShieldAlert size={28} aria-hidden="true" />
        <h1 id="health-revocation-title">Tracciamento sospeso</h1>
        {confirmed ? (
          <p role="status">La revoca del consenso ai dati salute è stata registrata. Le funzioni di tracciamento sono disattivate.</p>
        ) : pending ? (
          <p role="status">La richiesta di revoca è salvata sul dispositivo. La conferma sul server è ancora in attesa. Non puoi registrare nuovi dati nel frattempo.</p>
        ) : (
          <p role="alert">Non è possibile verificare in sicurezza lo stato del consenso. Il tracciamento rimane sospeso.</p>
        )}
        <p>{launchAvailable
          ? "Puoi consultare l'informativa o eliminare il tuo account. La revoca non elimina l'account: il sistema avvia separatamente la cancellazione dei dati di tracciamento per i quali non esiste un'altra base giuridica valida."
          : "La funzione di revoca non è ancora disponibile in questa versione. La sospensione rimane attiva su questo dispositivo, ma nessuna cancellazione automatica verrà avviata. Puoi consultare l'informativa oppure eliminare separatamente il tuo account."}</p>
        {status !== 'unavailable' && (
          <p role="status">Dati su questo dispositivo: {localErasure === 'deferred' ? 'cancellazione non attivata.' : localErasure === 'complete'
            ? 'pulizia completata.'
            : localErasure === 'failed' ? 'pulizia non completata: riprova.' : 'cancellazione in corso.'}
            {!isGuest && ' Cloud: ' + (!launchAvailable ? 'cancellazione non attivata.' : cloudErasure === 'complete' ? 'cancellazione completata.' : cloudErasure === 'blocked' ? 'cancellazione sospesa per dati inattesi; serve una verifica tecnica.' : cloudErasure === 'failed' ? 'cancellazione non completata; il recupero automatico sarà ritentato.' : 'cancellazione in attesa o in corso.')}
          </p>
        )}
        {launchAvailable && localErasure === 'failed' && status !== 'unavailable' && (
          <button type="button" className="btn" onClick={() => { setLocalErasure('checking'); void eraseLocal(); }}>
            <RefreshCw size={16} aria-hidden="true" /> Riprova la pulizia locale
          </button>
        )}
        {launchAvailable && !isGuest && (pending || (confirmed && cloudErasure !== 'complete' && cloudErasure !== 'blocked')) && (
          <button type="button" className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>
            <RefreshCw size={16} aria-hidden="true" /> {retrying ? 'Riprovo…' : confirmed ? 'Riprova la cancellazione cloud' : 'Riprova la conferma della revoca'}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setShowPrivacy(true)}>
          Informativa sulla privacy
        </button>
        <button type="button" className="btn" onClick={() => void handleDeleteAccount()} disabled={deletingAccount}>
          <Trash2 size={16} aria-hidden="true" /> {isGuest ? 'Elimina dati locali' : 'Elimina account'}
        </button>
        {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      </div>
    </div>
  );
}
