import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  onResolveClick: () => void;
}

export const NutritionConflictBanner: React.FC<Props> = ({ onResolveClick }) => {
  return (
    <div 
      className="card p-3 mb-4 flex items-center justify-between" 
      style={{ borderLeft: '4px solid var(--warning-color)', background: 'var(--surface-light)' }}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle size={24} style={{ color: 'var(--warning-color)' }} />
        <div>
          <h3 className="text-sm font-bold m-0" style={{ color: 'var(--warning-color)' }}>Bozza locale rilevata</h3>
          <p className="text-xs text-muted m-0 mt-1">
            Hai una bozza del piano nutrizionale salvata sul dispositivo in conflitto con l'account.
          </p>
        </div>
      </div>
      <button 
        className="btn btn-small"
        style={{ background: 'var(--warning-color)', color: '#000', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
        onClick={onResolveClick}
      >
        Risolvi
      </button>
    </div>
  );
};
