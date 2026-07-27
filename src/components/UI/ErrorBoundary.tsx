import React, { Component, ErrorInfo, ReactNode } from 'react';

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
          <h1 style={{ color: 'var(--danger-color)', marginBottom: '10px' }}>Ops, qualcosa è andato storto!</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            Si è verificato un errore imprevisto. Prova a ricaricare la pagina.
          </p>
          <div style={{ 
            background: 'rgba(239, 68, 68, 0.1)', 
            padding: '15px', 
            borderRadius: '8px',
            border: '1px solid var(--danger-color)',
            color: '#fca5a5',
            fontSize: '0.85rem',
            textAlign: 'left',
            maxWidth: '500px',
            overflowX: 'auto',
            marginBottom: '20px'
          }}>
            {this.state.error?.toString()}
          </div>
          <button 
            className="btn btn-primary" 
            onClick={() => window.location.reload()}
          >
            Ricarica App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
