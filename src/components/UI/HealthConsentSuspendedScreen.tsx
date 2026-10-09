import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ShieldAlert, Trash2, RefreshCw } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import { useAppStore } from '../../store/useAppStore';
import { eraseWithdrawnLocalTracking } from '../../lib/healthConsentLocalErasure';
import { getDb } from '../../lib/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useDialogStore } from '../../store/useDialogStore';
import { requestHealthConsentRevocation } from '../../lib/requestHealthConsentRevocation';
import type { HealthConsentGateStatus } from '../../hooks/useHealthConsentRevocation';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';

export function HealthConsentSuspendedScreen({ status }: { status: HealthConsentGateStatus }) {
  const { isGuest, currentUser } = useAuth();
  const owner = isGuest ? 'guest' : currentUser ? 'user:' + currentUser.uid : null;
  const { handleDeleteAccount, deletingAccount } = useSettings();
  const [retrying, setRetrying] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [localErasure, setLocalErasure] = useState<'checking' | 'complete' | 'failed'>('checking');
  const [cloudErasure, setCloudErasure] = useState<'pending' | 'complete' | 'failed'>('pending');

  const eraseLocal = useCallback(async () => {
    if (!owner || status === 'unavailable' || status === 'none') return;
    setLocalErasure('checking');
    // Volatile business state must be invalidated before any asynchronous
    // IndexedDB cleanup, including in a second tab discovering the revocation.
    useAppStore.getState().resetStore({ force: true });
    try {
      await eraseWithdrawnLocalTracking(owner);
      setLocalErasure('complete');
    } catch {
      setLocalErasure('failed');
    }
  }, [owner, status]);

  useEffect(() => {
    if (!owner || status === 'unavailable' || status === 'none') return;
    void eraseLocal();
    const refresh = () => { if (document.visibilityState === 'visible') void eraseLocal(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner, eraseLocal, status]);

  useEffect(() => {
    if (!owner || isGuest || status === 'unavailable') return;
    const uid = owner.slice(5);
    return onSnapshot(doc(getDb(), 'health_consent_revocations', uid), snapshot => {
      if (!snapshot.exists()) { setCloudErasure('pending'); return; }
      const value = snapshot.data().eraseStatus;
      setCloudErasure(value === 'complete' ? 'complete' : value === 'blocked' || value === 'failed' ? 'failed' : 'pending');
    }, () => setCloudErasure('pending'));
  }, [owner, isGuest, status]);

  useEffect(() => {
    if (isGuest || status !== 'pending') return;
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
  }, [isGuest, status]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await requestHealthConsentRevocation();
    } catch {
      await useDialogStore.getState().showAlert('Il server non ha ancora confermato la revoca. La sospensione su questo dispositivo rimane attiva.');
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
        <p>Puoi consultare l'informativa o eliminare il tuo account. La revoca non elimina l'account: il sistema avvia separatamente la cancellazione dei dati di tracciamento per i quali non esiste un'altra base giuridica valida.</p>
        {status !== 'unavailable' && (
          <p role="status">Dati su questo dispositivo: {localErasure === 'complete'
            ? 'pulizia completata.'
            : localErasure === 'failed' ? 'pulizia non completata: riprova.' : 'cancellazione in corso.'}
            {!isGuest && ' Cloud: ' + (cloudErasure === 'complete' ? 'cancellazione completata.' : cloudErasure === 'failed' ? 'cancellazione non completata; il recupero automatico sarà ritentato.' : 'cancellazione in attesa o in corso.')}
          </p>
        )}
        {localErasure === 'failed' && status !== 'unavailable' && (
          <button type="button" className="btn" onClick={() => void eraseLocal()}>
            <RefreshCw size={16} aria-hidden="true" /> Riprova la pulizia locale
          </button>
        )}
        {pending && !isGuest && (
          <button type="button" className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>
            <RefreshCw size={16} aria-hidden="true" /> {retrying ? 'Riprovo…' : 'Riprova la conferma della revoca'}
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
