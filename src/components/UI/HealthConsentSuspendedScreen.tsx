import { useState } from 'react';
import { ShieldAlert, Download, Trash2, RefreshCw } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../hooks/useAuth';
import { useDialogStore } from '../../store/useDialogStore';
import { requestHealthConsentRevocation } from '../../lib/requestHealthConsentRevocation';
import type { HealthConsentGateStatus } from '../../hooks/useHealthConsentRevocation';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';

export function HealthConsentSuspendedScreen({ status }: { status: HealthConsentGateStatus }) {
  const { isGuest } = useAuth();
  const { handleExportBackup, handleDeleteAccount, exportingData, deletingAccount } = useSettings();
  const [retrying, setRetrying] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

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
        <p>Puoi continuare a consultare l'informativa, esportare i dati quando consentito o eliminare il tuo account. L'eliminazione dei dati è un'operazione separata.</p>
        {pending && !isGuest && (
          <button type="button" className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>
            <RefreshCw size={16} aria-hidden="true" /> {retrying ? 'Riprovo…' : 'Riprova la conferma della revoca'}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setShowPrivacy(true)}>
          Informativa sulla privacy
        </button>
        <button type="button" className="btn" onClick={() => void handleExportBackup()} disabled={exportingData}>
          <Download size={16} aria-hidden="true" /> {exportingData ? 'Esportazione…' : 'Esporta i dati in JSON'}
        </button>
        <button type="button" className="btn" onClick={() => void handleDeleteAccount()} disabled={deletingAccount}>
          <Trash2 size={16} aria-hidden="true" /> {isGuest ? 'Elimina dati locali' : 'Elimina account'}
        </button>
        {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      </div>
    </div>
  );
}
