import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Download, LogOut } from 'lucide-react';
import { useDialogStore } from '../../store/useDialogStore';
import { useAppStore } from '../../store/useAppStore';

export const GlobalDialog: React.FC = () => {
  const isOpen = useDialogStore(state => state.isOpen);
  const type = useDialogStore(state => state.type);
  const title = useDialogStore(state => state.title);
  const message = useDialogStore(state => state.message);
  const unsyncedReason = useDialogStore(state => state.unsyncedReason);
  const onConfirm = useDialogStore(state => state.onConfirm);
  const onCancel = useDialogStore(state => state.onCancel);
  const onAction = useDialogStore(state => state.onAction);
  const syncHealth = useAppStore(state => state.syncHealth);
  const hasConflicts = useAppStore(state => !!state.userData?.pendingConflicts);
  const syncing = useAppStore(state => state.syncing);
  const hasWorkout = useAppStore(state => !!state.localWorkout);
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !overlayRef.current || !boxRef.current) return;
    const overlay = overlayRef.current;
    const box = boxRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay);
    const previousInert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    const focusable = () => Array.from(box.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    const elements = focusable();
    (elements.find(element => element.textContent?.startsWith('Annulla')) ?? elements[0] ?? box).focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'Tab') {
        const current = focusable();
        const first = current[0] ?? box;
        const last = current[current.length - 1] ?? box;
        if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const renderUnsyncedLogout = () => {
    const isSafeNow = syncHealth === 'synced' && !syncing && !hasConflicts && !hasWorkout;
    if (isSafeNow) {
      return (
        <div className="dialog-content-stack">
          <div className="dialog-status dialog-status--success" id="global-dialog-message">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div><strong>Sincronizzazione completata</strong><span>I dati sono allineati con il cloud. Puoi uscire in sicurezza.</span></div>
          </div>
          <button className="btn btn-success" onClick={() => onAction?.('safe-exit')}><LogOut size={18} /> Esci in sicurezza</button>
          <button className="btn btn-secondary" onClick={() => onAction?.('cancel')}>Annulla</button>
        </div>
      );
    }

    const reason = unsyncedReason === 'offline'
      ? 'Ci sono modifiche salvate localmente ma non ancora sincronizzate con il server (sei offline o la connessione è lenta).'
      : unsyncedReason === 'rejected'
        ? 'Alcune modifiche sono state rifiutate dal server. Controlla i permessi o riprova l’accesso.'
        : unsyncedReason === 'failed'
          ? 'Errore imprevisto durante la sincronizzazione. I dati locali non sono salvati sul cloud.'
          : unsyncedReason === 'conflict'
            ? 'C’è un conflitto non risolto tra i dati locali e quelli del server.'
            : 'Alcune modifiche non risultano ancora sincronizzate.';

    return (
      <div className="dialog-content-stack">
        <div className="dialog-status dialog-status--warning" id="global-dialog-message">
          <AlertTriangle size={20} aria-hidden="true" />
          <div><strong>Dati non sincronizzati</strong><span>{reason} Se esci ora, queste modifiche andranno perse.</span></div>
        </div>
        <button className="btn btn-secondary" onClick={() => onAction?.('export')}><Download size={18} /> Esporta backup locale (JSON)</button>
        <button className="btn btn-danger" onClick={() => onAction?.('force-exit')}><LogOut size={18} /> Esci comunque (Perdi modifiche)</button>
        <button className="btn btn-secondary" onClick={() => onAction?.('cancel')}>Annulla e attendi</button>
      </div>
    );
  };

  return createPortal(
    <div ref={overlayRef} className="dialog-overlay">
      <div
        ref={boxRef}
        tabIndex={-1}
        className="dialog-box safe-top safe-bottom"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="global-dialog-title"
        aria-describedby="global-dialog-message"
      >
        <h2 id="global-dialog-title">{title}</h2>
        {type === 'unsynced-data-logout' ? renderUnsyncedLogout() : (
          <>
            <p id="global-dialog-message" className="dialog-message">{message}</p>
            <div className="dialog-actions">
              {type === 'confirm' && <button className="btn btn-secondary" onClick={onCancel}>Annulla</button>}
              <button className="btn btn-primary" onClick={onConfirm}>{type === 'confirm' ? 'Conferma' : 'OK'}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
