import { useState, useEffect, useCallback, useRef } from 'react';
import { telemetryHub } from '../lib/telemetryHub';

// Extend window object to include beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        promptRef.current = deferredPrompt;
    }, [deferredPrompt]);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Stash the event so it can be triggered later.
            const promptEvent = e as BeforeInstallPromptEvent;
            promptRef.current = promptEvent;
            setDeferredPrompt(promptEvent);
            // Telemetry: Track install prompt impression
            telemetryHub.trackEvent('pwa_install_impression');
        };

        const handleAppInstalled = () => {
            promptRef.current = null;
            setDeferredPrompt(null);
            // Telemetry: Track native appinstalled event
            telemetryHub.trackEvent('pwa_appinstalled');
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const promptInstall = useCallback(async () => {
        if (!promptRef.current) return;

        const prompt = promptRef.current;
        promptRef.current = null;
        setDeferredPrompt(null);

        try {
            // Telemetry: Track install button click
            telemetryHub.trackEvent('pwa_install_click');

            // Mostra il prompt di installazione PWA
            prompt.prompt();

            // Attende la risposta dell'utente
            const choice = await prompt.userChoice;
            const outcome = choice?.outcome || 'dismissed';
            
            // Telemetry: Track prompt outcome
            telemetryHub.trackEvent('pwa_install_prompt_outcome', { outcome });

            if (outcome === 'accepted') {
                console.log('Utente ha accettato l\'installazione PWA');
            } else {
                console.log('Utente ha rifiutato l\'installazione PWA');
            }
        } catch (e) {
            // Il browser può revocare il permesso o la PWA è già installata:
            // in questi casi ignoriamo silenziosamente senza crashare.
            console.warn('Installazione PWA non disponibile:', e);
        }
    }, []);

    const isIOS = typeof navigator !== 'undefined' && (
        /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) || 
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
    
    const isStandalone = typeof window !== 'undefined' && (
        (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || 
        Boolean((navigator as any)?.standalone)
    );

    const isIOSInstallable = isIOS && !isStandalone;

    return {
        isInstallable: !!deferredPrompt,
        isIOSInstallable,
        isStandalone,
        promptInstall
    };
}

