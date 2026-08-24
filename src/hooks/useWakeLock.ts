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

        const acquire = async () => {
            // Non acquisire se disabilitato o documento non visibile
            if (!enabled || document.visibilityState !== 'visible') return;

            try {
                const sentinel = await navigator.wakeLock.request('screen');

                // Race condition: se nel frattempo è stato disabilitato/smontato, rilascia subito
                if (cancelledRef.current) {
                    sentinel.release().catch(() => {});
                    return;
                }

                sentinelRef.current = sentinel;

                // Ascolta il rilascio spontaneo dell'OS (policy energetica, ecc.)
                sentinel.addEventListener('release', () => {
                    // Solo se siamo ancora al sentinel corrente, azzera il ref
                    if (sentinelRef.current === sentinel) {
                        sentinelRef.current = null;
                    }
                });
            } catch {
                // Rifiuto dell'OS, API non disponibile, PWA su iOS < 18.4: silenzioso
            }
        };

        const release = () => {
            if (sentinelRef.current) {
                sentinelRef.current.release().catch(() => {});
                sentinelRef.current = null;
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && enabled) {
                acquire();
            } else {
                release();
            }
        };

        if (enabled) {
            acquire();
        } else {
            release();
        }

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            // Segnala che qualsiasi Promise pendente è obsoleta
            cancelledRef.current = true;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            release();
        };
    }, [enabled]);
}
