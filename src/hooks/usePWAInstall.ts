import { useCallback, useSyncExternalStore } from 'react';
import {
    getPWAInstallPrompt,
    promptPWAInstall,
    subscribePWAInstall,
} from '../lib/pwaInstallLifecycle';

export function usePWAInstall() {
    const deferredPrompt = useSyncExternalStore(
        subscribePWAInstall,
        getPWAInstallPrompt,
        () => null,
    );

    const promptInstall = useCallback(async () => {
        await promptPWAInstall();
    }, []);

    const isIOS = typeof navigator !== 'undefined' && (
        /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );

    const isStandalone = typeof window !== 'undefined' && (
        (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
        Boolean((navigator as Navigator & { standalone?: boolean })?.standalone)
    );

    return {
        isInstallable: deferredPrompt !== null,
        isIOSInstallable: isIOS && !isStandalone,
        isStandalone,
        promptInstall,
    };
}
