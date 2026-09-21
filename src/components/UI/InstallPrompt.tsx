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
    <aside className="install-prompt card ui-install-prompt-1" aria-label="Installa LogBook">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3 style={{ margin: 0 }}>Installa LogBook</h3>
        <button type="button" onClick={handleDismiss} className="btn-icon" aria-label="Chiudi suggerimento installazione" style={{ margin: "-0.3125rem -0.3125rem 0 0" }}>
          &times;
        </button>
      </div>
      <p className="ui-install-prompt-2" style={{ margin: 0 }}>
        Per un'esperienza ottimale in palestra, installa l'app:
      </p>
      <ol className="ui-install-prompt-3" style={{ margin: "0 0 0 1.25rem" }}>
        <li>Tocca l'icona Condividi <span className="ui-install-prompt-4" style={{ display: "inline-block", padding: "0 0.25rem" }}>[↑]</span> in basso</li>
        <li>Scegli <strong>"Aggiungi alla schermata Home"</strong></li>
      </ol>
    </aside>
  );
};
