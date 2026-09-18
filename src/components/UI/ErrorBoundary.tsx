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

  private handleLocalReset = async () => {
    const dialogs = useDialogStore.getState();
    const confirmed = await dialogs.showConfirm(
      'Questa operazione elimina i dati locali della sessione corrente, inclusi quelli non ancora sincronizzati. I dati già presenti nel cloud non vengono cancellati. Procedere?',
      'Azzera dati locali'
    );
    if (!confirmed) return;

    try {
      const { DB } = await import('../../lib/db');
      await DB.purgeAllLocalUserData();
      window.location.reload();
    } catch (error) {
      console.error('Pulizia locale di recovery non completata:', error);
      await useDialogStore.getState().showAlert(
        'Pulizia locale non completata. I dati rimasti sul dispositivo non sono stati dichiarati eliminati. Riprova o ricarica la pagina.'
      );
    }
  };

  public render() {
    if (this.state.hasError) {
      const isNetworkError = this.state.error?.message?.includes('Failed to fetch dynamically imported module');
      
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
          <h1 style={{ color: 'var(--danger-color)', marginBottom: '10px' }}>
            {isNetworkError ? 'Sei offline' : 'Ops, qualcosa è andato storto!'}
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px', maxWidth: '300px' }}>
            {isNetworkError 
              ? 'Connettiti a internet per accedere a questa sezione. Se sei già connesso, la versione dell\'app potrebbe essere stata aggiornata.'
              : 'Si è verificato un errore imprevisto. Prova a ricaricare la pagina.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
            <button 
              className="btn btn-primary" 
              onClick={() => window.location.reload()}
            >
              <span aria-hidden="true">🔄</span> Ricarica pagina
            </button>
            <button 
              className="btn" 
              style={{ background: 'transparent', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', fontSize: '0.85rem' }}
              onClick={this.handleLocalReset}
            >
              <span aria-hidden="true">⚠️</span> Azzera dati locali
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
