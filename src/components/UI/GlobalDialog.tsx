import { useDialogStore } from '../../store/useDialogStore';

export const GlobalDialog: React.FC = () => {
  const isOpen = useDialogStore(state => state.isOpen);
  const type = useDialogStore(state => state.type);
  const title = useDialogStore(state => state.title);
  const message = useDialogStore(state => state.message);
  const onConfirm = useDialogStore(state => state.onConfirm);
  const onCancel = useDialogStore(state => state.onCancel);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 99999
    }}>
      <div className="dialog-box card" style={{
        width: '90%',
        maxWidth: '400px',
        background: 'var(--surface-color)',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
        borderRadius: '16px',
        padding: '25px',
        textAlign: 'center',
        animation: 'fadeIn 0.2s ease-out'
      }}>
        <h2 style={{ color: 'var(--text-main)', margin: '0 0 15px 0', fontSize: '1.4rem' }}>{title}</h2>
        
        <p style={{ color: 'var(--text-muted)', marginBottom: '25px', lineHeight: '1.5', whiteSpace: 'pre-wrap', textAlign: 'left' }}>
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
      </div>
    </div>
  );
};
