import { Component, ErrorInfo, ReactNode } from 'react';
import { useDialogStore } from '../../store/useDialogStore';
import { GlobalDialog } from './GlobalDialog';
import { DB } from '../../lib/db';
import { safeHardReload } from '../../lib/sync/safeReload';

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

  private handleSafeReload = async () => {
    try {
      await safeHardReload();
    } catch (error) {
      console.error('Ricaricamento sicuro non completato:', error);
      await useDialogStore.getState().showAlert(
        'Impossibile ricaricare in sicurezza: alcune modifiche locali potrebbero non essere ancora state salvate. Riprova tra qualche secondo.'
      );
    }
  };

  private handleLocalReset = async () => {
    const dialogs = useDialogStore.getState();
    const confirmed = await dialogs.showConfirm(
      'Questa operazione elimina i dati locali della sessione corrente, inclusi quelli non ancora sincronizzati. I dati già presenti nel cloud non vengono cancellati. Procedere?',
      'Azzera dati locali'
    );
    if (!confirmed) return;

    try {
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
        <div className="ui-error-boundary-1" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: "1.25rem", textAlign: "center" }}>
          <GlobalDialog />
          <h1 className="ui-error-boundary-2" style={{ marginBottom: "0.625rem" }}>
            {isNetworkError ? 'Sei offline' : 'Ops, qualcosa è andato storto!'}
          </h1>
          <p className="ui-error-boundary-3" style={{ marginBottom: "1.25rem", maxWidth: "18.75rem" }}>
            {isNetworkError
              ? 'Connettiti a internet per accedere a questa sezione. Se sei già connesso, la versione dell\'app potrebbe essere stata aggiornata.'
              : 'Si è verificato un errore imprevisto. Prova a ricaricare la pagina.'}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.9375rem", alignItems: "center" }}>
            <button
              className="btn btn-primary"
              onClick={this.handleSafeReload}
            >
              <span aria-hidden="true">🔄</span> Ricarica pagina
            </button>
            <button
              className="btn ui-error-boundary-4"

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
