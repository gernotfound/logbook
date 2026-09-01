import React, { useState, useEffect, useRef } from 'react';
import type { NutritionPlanning } from '../../types';
import { Exporter } from '../../lib/export';
import { useAppStore } from '../../store/useAppStore';

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  
  // A11y Focus management
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      setView('compare');
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault(); // Prevent native close to manage state properly
      if (!isSyncing) {
        onClose();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose, isSyncing]);

  if (!isOpen) return null;

  const handleExport = () => {
    const userData = useAppStore.getState().userData;
    if (userData) {
      Exporter.exportEmergencyJSON(userData);
    }
  };

  const renderPlanPreview = (title: string, plan: NutritionPlanning | null, isCloud: boolean) => {
    if (!plan) return <div className="text-muted p-3 text-sm">Nessun piano</div>;
    return (
      <div className="card p-3 mb-2" style={{ borderLeft: isCloud ? '4px solid var(--primary-color)' : '4px solid var(--warning-color)' }}>
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

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      aria-describedby="conflict-dialog-desc"
      className="card p-0 overflow-hidden"
      style={{
        maxWidth: '500px',
        width: '90%',
        margin: 'auto',
        background: 'var(--surface-color)',
        color: 'var(--text-main)',
        border: '1px solid var(--glass-border)',
        borderRadius: '16px',
        backdropFilter: 'blur(10px)'
      }}
    >
      <div className="p-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
        <h2 id="conflict-dialog-title" className="text-lg font-bold">Risoluzione conflitto</h2>
      </div>

      <div className="p-4" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {view === 'compare' ? (
          <>
            <p id="conflict-dialog-desc" className="text-sm text-muted mb-4">
              È stata rilevata una bozza locale del tuo piano nutrizionale. Confrontala con il piano salvato nell'account e decidi quale mantenere.
            </p>
            
            {renderPlanPreview("Piano Account (Cloud)", cloudPlan, true)}
            {renderPlanPreview("Bozza Locale (Dispositivo)", localPlan, false)}
          </>
        ) : (
          <>
            <p id="conflict-dialog-desc" className="text-sm mb-4">
              <strong>Vuoi eliminare la bozza nutrizionale salvata su questo dispositivo?</strong><br/><br/>
              Questa operazione <span style={{ color: 'var(--danger-color)' }}>non può essere annullata</span>, a meno che tu non abbia esportato un backup.
            </p>
          </>
        )}
      </div>

      <div className="p-4 border-t flex flex-col gap-2" style={{ borderColor: 'var(--glass-border)' }}>
        {view === 'compare' ? (
          <>
            <button 
              className="btn btn-primary" 
              onClick={() => onResolve('local')}
              disabled={isSyncing}
              style={{ background: 'var(--warning-color)', color: '#000' }}
            >
              Mantieni Dispositivo
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => setView('confirm-cloud')}
              disabled={isSyncing}
            >
              Mantieni Cloud (Elimina Bozza)
            </button>
            <button 
              className="btn btn-secondary text-sm" 
              onClick={handleExport}
            >
              Esporta backup JSON
            </button>
            <button 
              autoFocus
              className="btn" 
              onClick={onClose}
              disabled={isSyncing}
              style={{ marginTop: '0.5rem', background: 'transparent', border: '1px solid var(--glass-border)' }}
            >
              Decidi più tardi
            </button>
          </>
        ) : (
          <>
            <button 
              className="btn btn-primary" 
              style={{ background: 'var(--danger-color)', color: '#fff' }}
              onClick={() => onResolve('cloud')}
              disabled={isSyncing}
            >
              Elimina bozza e mantieni account
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={handleExport}
            >
              Esporta backup JSON
            </button>
            <button 
              autoFocus
              className="btn" 
              onClick={() => setView('compare')}
              disabled={isSyncing}
            >
              Torna al confronto
            </button>
          </>
        )}
      </div>
    </dialog>
  );
};
