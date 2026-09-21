import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NutritionPlanning } from '../../types';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResolve: (resolution: 'cloud' | 'local') => void;
  cloudPlan: NutritionPlanning | null;
  localPlan: NutritionPlanning;
  isSyncing?: boolean;
}

export const NutritionConflictDialog: React.FC<Props> = ({
  isOpen,
  onClose,
  onResolve,
  cloudPlan,
  localPlan,
  isSyncing
}) => {
  const [view, setView] = useState<'compare' | 'confirm-cloud'>('compare');
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const safeActionRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const syncingRef = useRef(!!isSyncing);
  const showAlert = useDialogStore(state => state.showAlert);
  const globalDialogOpen = useDialogStore(state => state.isOpen);
  const globalDialogOpenRef = useRef(globalDialogOpen);

  onCloseRef.current = onClose;
  syncingRef.current = !!isSyncing;
  globalDialogOpenRef.current = globalDialogOpen;
  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) {
      setView('compare');
      return;
    }

    const overlay = overlayRef.current;
    const box = boxRef.current;
    if (!overlay || !box) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay
    );
    const previousInert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });

    const focusable = () => Array.from(box.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
    ));

    (safeActionRef.current ?? focusable()[0] ?? box).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      // GlobalDialog may be opened on top for an export/resolve error. In that
      // case its own focus trap and Escape handling become authoritative.
      if (globalDialogOpenRef.current) return;

      if (event.key === 'Escape') {
        if (syncingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        setView('compare');
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0] ?? box;
      const last = elements[elements.length - 1] ?? box;
      if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !globalDialogOpen) safeActionRef.current?.focus();
  }, [globalDialogOpen, isOpen, view]);

  const handleClose = () => {
    if (isSyncing) return;
    setView('compare');
    onClose();
  };

  const handleExport = async () => {
    const userData = useAppStore.getState().userData;
    if (!userData) return;
    try {
      const { Exporter } = await import('../../lib/export');
      Exporter.exportEmergencyJSON(userData);
    } catch (error) {
      console.error('Errore esportazione backup conflitto nutrizionale:', error);
      await showAlert('Esportazione non riuscita. Riprova.');
    }
  };

  const renderPlanPreview = (title: string, plan: NutritionPlanning | null, isCloud: boolean) => {
    if (!plan) return <div className="text-muted p-3 text-sm">Nessun piano</div>;
    return (
      <div className="card p-3 mb-2" style={{ borderLeft: isCloud ? '0.25rem solid var(--primary-color)' : '0.25rem solid var(--warning-color)' }}>
        <h4 className="text-sm font-bold mb-2">{title}</h4>
        <div className="text-xs mb-1">
          <strong>Kcal medie totali:</strong> {plan.totalKcal || 'N/D'} kcal
        </div>
        <div className="text-xs mb-1">
          <strong>Peso di riferimento:</strong> {plan.weight ? `${plan.weight} kg` : 'N/D'}
        </div>
        <div className="text-xs mb-1">
          <strong>Giorni ON / OFF:</strong> {plan.onDaysCount || 0} / {7 - (plan.onDaysCount || 0)}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="dialog-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))',
        background: 'var(--bg-color)',
                overflow: 'hidden'
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        aria-describedby="conflict-dialog-desc"
        tabIndex={-1}
        className="card p-0 overflow-hidden safe-top safe-bottom"
        style={{
          maxWidth: '31.25rem',
          width: '100%',
          maxHeight: 'calc(100dvh - 2rem)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-color)',
          color: 'var(--text-main)',
          border: '1px solid var(--glass-border)',
          borderRadius: '1rem',
          boxShadow: 'none'
        }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--glass-border)', flexShrink: 0 }}>
          <h2 id="conflict-dialog-title" className="text-lg font-bold">Risoluzione conflitto</h2>
        </div>

        <div className="p-4" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {view === 'compare' ? (
            <>
              <p id="conflict-dialog-desc" className="text-sm text-muted mb-4">
                È stata rilevata una bozza locale del tuo piano nutrizionale. Confrontala con il piano salvato nell'account e decidi quale mantenere.
              </p>

              {renderPlanPreview('Piano account (cloud)', cloudPlan, true)}
              {renderPlanPreview('Bozza locale (dispositivo)', localPlan, false)}
            </>
          ) : (
            <p id="conflict-dialog-desc" className="text-sm mb-4">
              <strong>Vuoi eliminare la bozza nutrizionale salvata su questo dispositivo?</strong><br/><br/>
              Questa operazione <span style={{ color: 'var(--danger-color)' }}>non può essere annullata</span>, a meno che tu non abbia esportato un backup.
            </p>
          )}
        </div>

        <div className="p-4 border-t flex flex-col gap-2" style={{ borderColor: 'var(--glass-border)', flexShrink: 0 }}>
          {view === 'compare' ? (
            <>
              <button
                onClick={() => onResolve('local')}
                disabled={isSyncing}
                className="btn btn-warning"
              >
                Mantieni dispositivo
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setView('confirm-cloud')}
                disabled={isSyncing}
              >
                Mantieni account (elimina bozza)
              </button>
              <button
                className="btn btn-secondary text-sm"
                onClick={() => void handleExport()}
              >
                Esporta backup JSON
              </button>
              <button
                ref={safeActionRef}
                className="btn"
                onClick={handleClose}
                disabled={isSyncing}
                style={{ marginTop: '0.5rem', background: 'transparent', border: '1px solid var(--glass-border)' }}
              >
                Decidi più tardi
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-danger"
                onClick={() => onResolve('cloud')}
                disabled={isSyncing}
              >
                Elimina bozza e mantieni account
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => void handleExport()}
              >
                Esporta backup JSON
              </button>
              <button
                ref={safeActionRef}
                className="btn"
                onClick={() => setView('compare')}
                disabled={isSyncing}
              >
                Torna al confronto
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
