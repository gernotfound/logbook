import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { prepareForReload } from '../../lib/sync/reloadBarrier';
import { isCurrentSession } from '../../lib/sync/session';

export const ReloadPrompt: React.FC = () => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updateInFlight = useRef(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [chunkFailed, setChunkFailed] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (registration && typeof registration.update === 'function') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          if (registration && typeof registration.update === 'function') {
            try {
              const result = registration.update();
              if (result && typeof result.catch === 'function') result.catch(error => console.log('SW periodic update error:', error));
            } catch (error) {
              console.log('SW periodic update synchronous error:', error);
            }
          }
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.log('SW registration error:', error);
    },
  });

  useEffect(() => {
    const handlePreloadError = (event: Event) => {
      event.preventDefault();
      setChunkFailed(true);
    };
    window.addEventListener('vite:preloadError', handlePreloadError);
    return () => window.removeEventListener('vite:preloadError', handlePreloadError);
  }, []);

  useEffect(() => () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        navigator.serviceWorker &&
        typeof navigator.serviceWorker.getRegistration === 'function'
      ) {
        try {
          navigator.serviceWorker.getRegistration().then(registration => {
            if (registration && typeof registration.update === 'function') {
              try {
                const result = registration.update();
                if (result && typeof result.catch === 'function') result.catch(error => console.log('SW visibility update error:', error));
              } catch (error) {
                console.log('SW visibility update synchronous error:', error);
              }
            }
          }).catch(() => {});
        } catch (error) {
          console.log('SW getRegistration error:', error);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  if (!needRefresh && !chunkFailed) return null;

  const handleUpdate = async () => {
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    setUpdating(true);
    setUpdateError(null);
    try {
      const session = await prepareForReload();
      if (!isCurrentSession(session)) throw new Error('Sessione cambiata.');
      if (chunkFailed) window.location.reload();
      else await updateServiceWorker(true);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Aggiornamento non riuscito. Riprova.');
    } finally {
      updateInFlight.current = false;
      setUpdating(false);
    }
  };

  const handleClose = () => {
    setNeedRefresh(false);
    setChunkFailed(false);
  };

  const heading = chunkFailed
    ? 'Aggiornamento richiesto per caricare questa schermata'
    : 'Nuova versione disponibile';

  return (
    <aside role="alert" aria-live="polite" aria-atomic="true" className="reload-prompt-toast product-toast">
      <div className="product-toast__icon"><RefreshCw size={19} aria-hidden="true" /></div>
      <div className="product-toast__content">
        <strong>{heading}</strong>
        <span>{chunkFailed ? 'Aggiorna LogBook per caricare correttamente questa schermata.' : 'È pronta una versione più recente dell’app.'}</span>
        {updateError && <span className="product-toast__error" role="alert">{updateError}</span>}
      </div>
      <div className="product-toast__actions">
        <button type="button" aria-label="Aggiorna applicazione" className="btn btn-primary btn-small" onClick={handleUpdate} disabled={updating}>
          <RefreshCw size={15} aria-hidden="true" /> {updating ? 'Salvataggio…' : 'Aggiorna'}
        </button>
        <button type="button" aria-label="Chiudi notifica" className="product-toast__close" onClick={handleClose} disabled={updating}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
};

export default ReloadPrompt;
