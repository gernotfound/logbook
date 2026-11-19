import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { useDialogStore } from '../../store/useDialogStore';

export function GuestBanner({ onLogin }: { onLogin: () => void }) {
  const { logout } = useAuth();

  return (
    <div className="guest-banner">
      <AlertTriangle size={20} aria-hidden="true" />
      <span className="guest-banner-text">Modalità locale · I dati sono solo su questo dispositivo</span>
      <div className="guest-banner-actions">
        <button type="button" className="btn btn-small"
          onClick={event => { event.currentTarget.focus(); onLogin(); }}>
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

// Until Kinde can transfer guest archives with verified ownership, never
// invoke the old Firebase login from a guest-owned view.
export function GuestKindeTransitionGate({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const globalDialogOpen = useDialogStore(state => state.isOpen);
  useModalFocusTrap({
    containerRef: dialogRef, initialFocusRef: closeButton,
    active: !globalDialogOpen, onEscape: onClose,
  });
  return (
    <section ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
      aria-labelledby="guest-kinde-transition-title"
      className="auth-panel">
      <h2 id="guest-kinde-transition-title">Passaggio a Kinde non disponibile</h2>
      <p>Il collegamento dell’archivio locale a un account Kinde non è ancora attivo.
        I tuoi progressi rimangono sul dispositivo. Puoi continuare a utilizzare
        la modalità locale senza trasferire o cancellare i dati.</p>
      <button ref={closeButton} type="button" className="btn btn-primary"
        onClick={onClose}>Torna alla modalità locale</button>
    </section>
  );
}
