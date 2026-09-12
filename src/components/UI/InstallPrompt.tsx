import React, { useEffect, useState } from 'react';
import { Share2, Smartphone, X } from 'lucide-react';

export const InstallPrompt: React.FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as any).standalone === true);
    const hasSeenPrompt = localStorage.getItem('logbook_ios_install_prompt') === 'true';

    if (isIOS && !isStandalone && !hasSeenPrompt) {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('logbook_ios_install_prompt', 'true');
  };

  if (!showPrompt) return null;

  return (
    <aside className="install-prompt product-toast product-toast--install safe-bottom" role="status">
      <div className="product-toast__icon"><Smartphone size={19} aria-hidden="true" /></div>
      <div className="product-toast__content">
        <strong>Installa LogBook</strong>
        <span>In palestra puoi usarla a schermo intero, come una normale app.</span>
        <div className="install-prompt__steps">
          <span><Share2 size={14} aria-hidden="true" /> Tocca Condividi in Safari</span>
          <span><Smartphone size={14} aria-hidden="true" /> Scegli “Aggiungi alla schermata Home”</span>
        </div>
      </div>
      <button type="button" onClick={handleDismiss} className="product-toast__close" aria-label="Chiudi">
        <X size={17} aria-hidden="true" />
      </button>
    </aside>
  );
};
