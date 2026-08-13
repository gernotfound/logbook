import { useState, useEffect } from 'react';

// Extend window object to include beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed', platform: string }>;
}

export function usePWAInstall() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Stash the event so it can be triggered later.
            setDeferredPrompt(e as BeforeInstallPromptEvent);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const promptInstall = async () => {
        if (!deferredPrompt) return;

        try {
            // Mostra il prompt di installazione PWA
            deferredPrompt.prompt();

            // Attende la risposta dell'utente
            const { outcome } = await deferredPrompt.userChoice;
            
            if (outcome === 'accepted') {
                console.log('Utente ha accettato l\'installazione PWA');
            } else {
                console.log('Utente ha rifiutato l\'installazione PWA');
            }
        } catch (e) {
            // Il browser può revocare il permesso o la PWA è già installata:
            // in questi casi ignoriamo silenziosamente senza crashare.
            console.warn('Installazione PWA non disponibile:', e);
        } finally {
            // Il prompt può essere usato una sola volta: lo azzeriamo sempre
            setDeferredPrompt(null);
        }
    };
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

