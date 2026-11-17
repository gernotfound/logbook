/**
 * useWakeLock — Previene lo spegnimento automatico dello schermo durante la sessione.
 *
 * Compatibilità:
 * - Safari browser: iOS 16.4+
 * - PWA installata (Home Screen): iOS/iPadOS 18.4+ (WebKit bug #254545)
 * - Android Chrome/Edge: supportato da versioni recenti
 * - Se l'API non è disponibile o la richiesta viene rifiutata: fallback silenzioso.
 */
import { useEffect, useRef } from 'react';

export function useWakeLock(enabled: boolean): void {
    // Ref del sentinel attivo (null se non acquisito)
    const sentinelRef = useRef<WakeLockSentinel | null>(null);
    useEffect(() => {
        // Each effect instance retains its own cancellation state.
        const lifecycle = { isCancelled: false, retryHandle: null as ReturnType<typeof setTimeout> | null, acquiring: false, retryCount: 0 };

        // Verifica supporto API
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
            return;
        }

        
        
        
        const MAX_SPONTANEOUS_RETRIES = 2;

        const clearRetry = () => {
            if (lifecycle.retryHandle) clearTimeout(lifecycle.retryHandle);
            lifecycle.retryHandle = null;
        };

        const acquire = async () => {
            // Non acquisire se disabilitato, già acquisito/in-flight o documento non visibile.
            if (!enabled || lifecycle.acquiring || sentinelRef.current || document.visibilityState !== 'visible') return;
            lifecycle.acquiring = true;

            try {
                const sentinel = await navigator.wakeLock.request('screen');

                // Race condition: se nel frattempo è stato disabilitato/smontato, rilascia subito.
                if (lifecycle.isCancelled || !enabled || document.visibilityState !== 'visible') {
                    sentinel.release().catch(() => {});
                    return;
                }

                sentinelRef.current = sentinel;

                // Se l'OS rilascia spontaneamente mentre il workout è ancora visibile,
                // tenta una riacquisizione limitata. Il budget si resetta soltanto al
                // prossimo vero ritorno in foreground, evitando retry loop persistenti.
                sentinel.addEventListener('release', () => {
                    if (sentinelRef.current !== sentinel) return;
                    sentinelRef.current = null;
                    if (
                        lifecycle.isCancelled
                        || !enabled
                        || document.visibilityState !== 'visible'
                        || lifecycle.retryCount >= MAX_SPONTANEOUS_RETRIES
                    ) return;

                    lifecycle.retryCount += 1;
                    clearRetry();
                    lifecycle.retryHandle = setTimeout(() => {
                        lifecycle.retryHandle = null;
                        void acquire();
                    }, 500 * lifecycle.retryCount);
                });
            } catch {
                // Rifiuto dell'OS, API non disponibile, PWA su iOS < 18.4: silenzioso.
            } finally {
                lifecycle.acquiring = false;
            }
        };

        const release = () => {
            clearRetry();
            const sentinel = sentinelRef.current;
            sentinelRef.current = null;
            if (sentinel) sentinel.release().catch(() => {});
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && enabled) {
                lifecycle.retryCount = 0;
                void acquire();
            } else {
                release();
            }
        };

        if (enabled) {
            void acquire();
        } else {
            release();
        }

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            // Segnala che qualsiasi Promise pendente è obsoleta
            lifecycle.isCancelled = true;
            clearRetry();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            release();
        };
    }, [enabled]);
}
