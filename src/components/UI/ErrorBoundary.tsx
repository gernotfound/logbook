import { Component, ErrorInfo, ReactNode } from 'react';
import { useDialogStore } from '../../store/useDialogStore';
import { GlobalDialog } from './GlobalDialog';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleHardReset = async () => {
    const confirmed = await useDialogStore.getState().showConfirm(
      'Questo cancellerà tutti i dati non sincronizzati con il cloud. Procedere?',
      'Attenzione'
    );
    if (confirmed) {
      window.localStorage.clear();
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '20px',
          background: 'var(--bg-color)',
          color: 'var(--text-main)',
          textAlign: 'center'
        }}>
          <GlobalDialog />
          <h1 style={{ color: 'var(--danger-color)', marginBottom: '10px' }}>Ops, qualcosa è andato storto!</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            Si è verificato un errore imprevisto. Prova a ricaricare la pagina.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
            <button 
              className="btn btn-primary" 
              onClick={() => window.location.reload()}
            >
              🔄 Ricarica pagina
            </button>
            <button 
              className="btn" 
              style={{ background: 'transparent', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', fontSize: '0.85rem' }}
              onClick={this.handleHardReset}
            >
              ⚠️ Hard reset (dati corrotti)
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

