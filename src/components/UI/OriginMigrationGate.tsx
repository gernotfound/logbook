import { useState, type ReactNode } from 'react';
import {
  requestOriginMigration,
  shouldOfferOriginMigration,
  skipOriginMigration,
} from '../../lib/originMigration';

export function OriginMigrationGate({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(() => shouldOfferOriginMigration());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!show) return <>{children}</>;

  const transfer = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestOriginMigration();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Trasferimento non riuscito.');
      setBusy(false);
    }
  };

  const continueWithoutTransfer = () => {
    try {
      skipOriginMigration();
      setShow(false);
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : 'Non riesco a salvare la scelta sul dispositivo. Riprova dopo aver riabilitato lo storage del browser.');
    }
  };

  return (
    <div id="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="origin-migration-title">
      <div className="auth-panel">
        <h1 id="origin-migration-title" className="text-primary mb-10">Nuovo indirizzo LogBook</h1>
        <p style={{ lineHeight: 1.5 }}>
          Se hai già usato LogBook al vecchio indirizzo, trasferisci prima la copia locale di questo dispositivo.
          Questo protegge anche dati non ancora sincronizzati e la modalità locale senza account.
        </p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void transfer()}>
          {busy ? 'Trasferimento in corso…' : 'Trasferisci dal vecchio LogBook'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={continueWithoutTransfer}>
          Continua senza trasferire
        </button>
        {error && <p role="alert" style={{ marginTop: '12px', lineHeight: 1.4 }}>{error}</p>}
      </div>
    </div>
  );
}
