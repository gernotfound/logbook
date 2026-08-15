import React, { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';

export const ReloadPrompt: React.FC = () => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r && typeof r.update === 'function') {
        // Controllo periodico degli aggiornamenti SW ogni 60 minuti
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(() => {
          if (r && typeof r.update === 'function') {
            try {
              const updateRes = r.update();
              if (updateRes && typeof updateRes.catch === 'function') {
                updateRes.catch(err => console.log('SW periodic update error:', err));
              }
            } catch (err) {
              console.log('SW periodic update synchronous error:', err);
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
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // Al risveglio dell'app o cambio di visibilità, controlla la presenza di aggiornamenti
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
          navigator.serviceWorker.getRegistration().then(reg => {
            if (reg && typeof reg.update === 'function') {
              try {
                const updateRes = reg.update();
                if (updateRes && typeof updateRes.catch === 'function') {
                  updateRes.catch(err => console.log('SW visibility update error:', err));
                }
              } catch (err) {
                console.log('SW visibility update synchronous error:', err);
              }
            }
          }).catch(() => {});
        } catch (err) {
          console.log('SW getRegistration error:', err);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (!needRefresh) {
    return null;
  }

  const handleUpdate = () => {
    try {
      if (typeof updateServiceWorker === 'function') {
        const updatePromise = updateServiceWorker(true);
        if (updatePromise && typeof updatePromise.catch === 'function') {
          updatePromise.catch(err => console.log('SW update trigger error:', err));
        }
      }
    } catch (err) {
      console.log('SW update invocation error:', err);
    }
  };

  const handleClose = () => {
    setNeedRefresh(false);
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      className="reload-prompt-toast"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'rgba(0, 229, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary-color)',
            flexShrink: 0,
          }}
        >
          <RefreshCw size={20} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: '0.92rem',
              color: 'var(--text-main)',
              lineHeight: 1.3,
            }}
          >
            Nuova versione disponibile
          </div>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              marginTop: '2px',
              lineHeight: 1.3,
            }}
          >
            Ricarica l'app per applicare l'aggiornamento.
          </div>
        </div>
      </div>

      <div className="reload-prompt-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          type="button"
          aria-label="Aggiorna applicazione"
          className="btn btn-primary btn-small"
          onClick={handleUpdate}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 14px',
            fontSize: '0.82rem',
            margin: 0,
            cursor: 'pointer',
          }}
        >
          Aggiorna
        </button>
        <button
          type="button"
          aria-label="Chiudi notifica"
          className="btn btn-secondary btn-small"
          onClick={handleClose}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 12px',
            fontSize: '0.82rem',
            margin: 0,
            cursor: 'pointer',
          }}
        >
          Chiudi
        </button>
      </div>
    </div>
  );
};

export default ReloadPrompt;
