import React, { useState, useEffect } from 'react';
import { readBrowserValue, tryWriteBrowserValue } from '../../lib/sync/browserStorage';

export const InstallPrompt: React.FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Check se è un dispositivo iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    // Check se è già in modalità standalone (installata)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as any).standalone === true);

    // Preferenza non critica: storage non disponibile equivale a prompt non ancora visto.
    const hasSeenPrompt = readBrowserValue('logbook_ios_install_prompt') === 'true';

    if (isIOS && !isStandalone && !hasSeenPrompt) {
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    tryWriteBrowserValue('logbook_ios_install_prompt', 'true');
  };

  if (!showPrompt) return null;

  return (
    <div className="install-prompt card safe-bottom" style={{
      position: 'fixed',
      bottom: '90px',
      left: '20px',
      right: '20px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      animation: 'fadeSlideUp 0.3s ease-out'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{margin: 0}}>Installa LogBook</h3>
        <button onClick={handleDismiss} className="btn-icon" aria-label="Chiudi" style={{ margin: '-5px -5px 0 0' }}>
          &times;
        </button>
      </div>
      <p style={{ margin: 0, fontSize: '0.95rem' }}>
        Per un'esperienza ottimale in palestra, installa l'app:
      </p>
      <ol style={{ margin: '0 0 0 20px', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
        <li>Tocca l'icona Condividi <span style={{ display: 'inline-block', border: '1px solid currentColor', borderRadius: '4px', padding: '0 4px', fontSize: '1.1rem' }}>[↑]</span> in basso</li>
        <li>Scegli <strong>"Aggiungi alla schermata Home"</strong></li>
      </ol>
    </div>
  );
};
