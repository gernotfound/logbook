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
    // Flag per rilevare componente smontato o richiesta obsoleta
    const cancelledRef = useRef(false);

    useEffect(() => {
        cancelledRef.current = false;

        // Verifica supporto API
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
            return;
        }

        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let spontaneousRetries = 0;
        let acquireInFlight = false;
        const MAX_SPONTANEOUS_RETRIES = 2;

        const clearRetry = () => {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
        };

        const acquire = async () => {
            // Non acquisire se disabilitato, già acquisito/in-flight o documento non visibile.
            if (!enabled || acquireInFlight || sentinelRef.current || document.visibilityState !== 'visible') return;
            acquireInFlight = true;

            try {
                const sentinel = await navigator.wakeLock.request('screen');

                // Race condition: se nel frattempo è stato disabilitato/smontato, rilascia subito.
                if (cancelledRef.current || !enabled || document.visibilityState !== 'visible') {
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
                        cancelledRef.current
                        || !enabled
                        || document.visibilityState !== 'visible'
                        || spontaneousRetries >= MAX_SPONTANEOUS_RETRIES
                    ) return;

                    spontaneousRetries += 1;
                    clearRetry();
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        void acquire();
                    }, 500 * spontaneousRetries);
                });
            } catch {
                // Rifiuto dell'OS, API non disponibile, PWA su iOS < 18.4: silenzioso.
            } finally {
                acquireInFlight = false;
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
                spontaneousRetries = 0;
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
            cancelledRef.current = true;
            clearRetry();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            release();
        };
    }, [enabled]);
}
