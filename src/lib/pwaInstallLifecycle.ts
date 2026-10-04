export interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(listener => listener());

export function initializePWAInstallLifecycle(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredPrompt = event as BeforeInstallPromptEvent;
        notify();
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        notify();
    });
}

export function subscribePWAInstall(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getPWAInstallPrompt(): BeforeInstallPromptEvent | null {
    return deferredPrompt;
}

export async function promptPWAInstall(): Promise<void> {
    const prompt = deferredPrompt;
    if (!prompt) return;

    deferredPrompt = null;
    notify();
    try {
        await prompt.prompt();
        await prompt.userChoice;
    } catch (error) {
        console.warn('Installazione PWA non disponibile:', error);
    }
}
