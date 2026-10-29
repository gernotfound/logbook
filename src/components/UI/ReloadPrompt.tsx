import React, { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { isReloadSessionCurrent, prepareForReload } from '../../lib/sync/reloadBarrier';
import { applyPWAUpdate, checkForWaitingServiceWorker } from '../../lib/pwaUpdate';

const ReloadPrompt: React.FC = () => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updateInFlight = useRef(false);
  const activationAbortRef = useRef<AbortController | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<'saving' | 'activating'>('saving');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [activationDelayed, setActivationDelayed] = useState(false);
  const [chunkFailed, setChunkFailed] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    // Workbox otherwise reloads on "controlling" independently of this UI,
    // bypassing the owner-scoped reload barrier (including on another tab).
    onNeedReload: () => undefined,
    onRegistered(r) {
      if (r && typeof r.update === 'function') {
        const requestUpdate = () => {
          try {
            const updateRes = r.update();
            if (updateRes && typeof updateRes.catch === 'function') {
              updateRes.catch(err => console.log('SW update error:', err));
            }
          } catch (err) {
            console.log('SW update synchronous error:', err);
          }
        };

        // Controlla subito: iOS/PWA può tenere aperta una build per molto tempo.
        requestUpdate();

        // Mantieni anche il controllo periodico come fallback.
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(requestUpdate, 60 * 60 * 1000);
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

  useEffect(() => {
    return () => {
      activationAbortRef.current?.abort();
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
                void checkForWaitingServiceWorker(reg)
                  .then(waiting => {
                    if (waiting) setNeedRefresh(true);
                  })
                  .catch(err => console.log('SW visibility update error:', err));
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
  }, [setNeedRefresh]);

  useEffect(() => {
    const handleWaitingUpdate = () => setNeedRefresh(true);
    window.addEventListener('logbook:pwa-update-waiting', handleWaitingUpdate);
    return () => window.removeEventListener('logbook:pwa-update-waiting', handleWaitingUpdate);
  }, [setNeedRefresh]);

  if (!needRefresh && !chunkFailed) {
    return null;
  }

  const handleUpdate = async () => {
    if (updateInFlight.current) return;
    const activation = new AbortController();
    activationAbortRef.current = activation;
    updateInFlight.current = true;
    setUpdating(true);
    setUpdatePhase('saving');
    setUpdateError(null);
    setActivationDelayed(false);
    try {
      // A missing hashed module can leave the old app shell active just like
      // a waiting update. Both cases must use the same SW activation path.
      // Never activate or reload until the durable owner-scoped barrier passed.
      const session = await prepareForReload();
      if (!isReloadSessionCurrent(session)) throw new Error('Sessione cambiata.');
      setUpdatePhase('activating');
      await applyPWAUpdate(
        typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
        async () => {
          if (activation.signal.aborted) throw new DOMException('Aggiornamento annullato.', 'AbortError');
          if (!isReloadSessionCurrent(session)) throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
          // The user can keep editing while the browser activates its worker.
          // Recheck durable data immediately before the actual navigation.
          const finalSession = await prepareForReload();
          if (activation.signal.aborted) throw new DOMException('Aggiornamento annullato.', 'AbortError');
          if (!isReloadSessionCurrent(session) || !isReloadSessionCurrent(finalSession)) {
            throw new Error('Sessione cambiata. Ripeti l’aggiornamento.');
          }
          window.location.reload();
        },
        undefined,
        {
          signal: activation.signal,
          onActivationDelayed: () => {
            if (!activation.signal.aborted) setActivationDelayed(true);
          },
        },
      );
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setUpdateError(err instanceof Error ? err.message : 'Aggiornamento non riuscito. Riprova.');
      }
    } finally {
      if (activationAbortRef.current === activation) activationAbortRef.current = null;
      updateInFlight.current = false;
      setUpdating(false);
      setActivationDelayed(false);
    }
  };

  const handleClose = () => {
    activationAbortRef.current?.abort();
    setNeedRefresh(false);
    setChunkFailed(false);
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      className="reload-prompt-toast"
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "center", textAlign: "center" }}
    >
      <div
        className="ui-reload-prompt-1" style={{ fontWeight: 700 }}
      >
        {chunkFailed ? 'Aggiornamento richiesto per caricare questa schermata' : 'Nuova versione disponibile'}
      </div>
      {updateError && <p role="alert" className="ui-reload-prompt-2" style={{ margin: 0 }}>{updateError}</p>}
      {activationDelayed && <p role="status" className="ui-reload-prompt-2" style={{ margin: 0 }}>
        Il browser sta impiegando più tempo per attivare la nuova versione. Puoi attendere oppure chiudere l’avviso e riprovare.
      </p>}

      <div className="reload-prompt-actions" style={{ display: "flex", gap: "0.625rem", width: "100%", justifyContent: "center" }}>
        <button
          type="button"
          aria-label="Aggiorna applicazione"
          className="btn btn-primary btn-small ui-reload-prompt-3"
          onClick={handleUpdate}
          disabled={updating}
          style={{ flex: 1, padding: "0.625rem", margin: 0, minHeight: "2.75rem", cursor: "pointer" }}
        >
          {updating ? (updatePhase === 'saving' ? 'Salvataggio…' : 'Aggiornamento…') : 'Aggiorna'}
        </button>
        <button
          type="button"
          aria-label="Chiudi notifica"
          className="btn btn-secondary btn-small ui-reload-prompt-4"
          onClick={handleClose}
          disabled={updating && !activationDelayed}
          style={{ flex: 1, padding: "0.625rem", margin: 0, minHeight: "2.75rem", cursor: "pointer" }}
        >
          Chiudi
        </button>
      </div>
    </div>
  );
};

export default ReloadPrompt;
