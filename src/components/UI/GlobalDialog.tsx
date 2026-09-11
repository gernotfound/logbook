import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
    const siblings = Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== overlay);
    const previousInert = siblings.map(el => el.inert);
    siblings.forEach(el => { el.inert = true; });
    const focusable = () => Array.from(box.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    const buttons = focusable();
    (buttons.find(el => el.textContent?.startsWith('Annulla')) ?? buttons[0] ?? box).focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0] ?? box;
        const last = elements[elements.length - 1] ?? box;
        if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      siblings.forEach((el, index) => { el.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div ref={overlayRef} className="dialog-overlay" style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 99999
    }}>
      <div
        ref={boxRef}
        tabIndex={-1}
        className="dialog-box card safe-top safe-bottom"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="global-dialog-title"
        aria-describedby="global-dialog-message"
        style={{
          width: '90%',
          maxWidth: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--surface-color)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
          borderRadius: '16px',
          padding: '25px',
          textAlign: 'center',
          animation: 'fadeIn 0.2s ease-out'
        }}
      >
        <h2 id="global-dialog-title" style={{color: 'var(--text-main)', margin: '0 0 15px 0'}}>{title}</h2>

        {type === 'unsynced-data-logout' ? (() => {
          const isSafeNow = syncHealth === 'synced' && !syncing && !hasConflicts && !hasWorkout;

          if (isSafeNow) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <p id="global-dialog-message" style={{ color: 'var(--success-color)', marginBottom: '15px', lineHeight: '1.5', whiteSpace: 'pre-wrap', textAlign: 'center', fontWeight: 'bold' }}>
                  Sincronizzazione completata con successo!
                </p>
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--success-color)', color: '#000' }}
                  onClick={() => onAction?.('safe-exit')}
                >
                  Esci in sicurezza
                </button>
                <button
                  className="btn"
                  style={{ background: 'transparent', color: 'var(--text-main)' }}
                  onClick={() => onAction?.('cancel')}
                >
                  Annulla
                </button>
              </div>
            );
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <p id="global-dialog-message" style={{ color: 'var(--text-muted)', marginBottom: '15px', lineHeight: '1.5', whiteSpace: 'pre-wrap', textAlign: 'left' }}>
                {unsyncedReason === 'offline' && "Ci sono modifiche salvate localmente ma non ancora sincronizzate con il server (sei offline o la connessione è lenta)."}
                {unsyncedReason === 'rejected' && "Alcune modifiche sono state rifiutate dal server. Controlla i permessi o riprova l'accesso."}
                {unsyncedReason === 'failed' && "Errore imprevisto durante la sincronizzazione. I dati locali non sono salvati sul cloud."}
                {unsyncedReason === 'conflict' && "C'è un conflitto non risolto tra i dati locali e quelli del server."}
                {"\n\nSe esci ora, queste modifiche andranno perse."}
              </p>

              <button
                className="btn"
                style={{ background: 'var(--surface-light)', color: 'var(--text-main)' }}
                onClick={() => onAction?.('export')}
              >
                Esporta backup locale (JSON)
              </button>
              <button
                className="btn btn-secondary"
                style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
                onClick={() => onAction?.('force-exit')}
              >
                Esci comunque (Perdi modifiche)
              </button>
              <button
                className="btn"
                style={{ background: 'transparent', color: 'var(--text-main)' }}
                onClick={() => onAction?.('cancel')}
              >
                Annulla e attendi
              </button>
            </div>
          );
        })() : (
          <>
            <p id="global-dialog-message" style={{ color: 'var(--text-muted)', marginBottom: '25px', lineHeight: '1.5', whiteSpace: 'pre-wrap', textAlign: 'left' }}>
              {message}
            </p>

            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              {type === 'confirm' && (
                <button
                  className="btn btn-secondary"
                  onClick={onCancel}
                  style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)' }}
                >
                  Annulla
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={onConfirm}
                style={{ flex: 1, padding: '12px' }}
              >
                {type === 'confirm' ? 'Conferma' : 'OK'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>, document.body
  );
};
