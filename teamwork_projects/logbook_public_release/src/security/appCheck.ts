/**
 * Firebase App Check Security Module (LogBook PWA)
 * 
 * Provider: ReCaptchaV3Provider (Standard Google reCAPTCHA v3)
 * Cost Tier: 100% Free on Firebase Spark (1,000,000 evaluations/month included)
 * 
 * Key Constraints:
 * - NO reCAPTCHA Enterprise / App Check Enterprise (prohibited under zero-cost mandate).
 * - Site key is a public identifier embedded safely in the client bundle.
 * - Automatic background token refresh enabled (standard TTL = 1 hour).
 * - Graceful fallback to offline mode if browser lacks Web Crypto / iframe sandboxing (isSupported() === false).
 * - User notifications strictly formatted in Italian Sentence case.
 */

import { 
    initializeAppCheck, 
    ReCaptchaV3Provider, 
    getToken, 
    type AppCheck, 
    type AppCheckToken,
    isSupported as isAppCheckSupportedSdk 
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

export interface AppCheckInitOptions {
    siteKey?: string;
    isTokenAutoRefreshEnabled?: boolean;
    debugToken?: boolean | string;
}

export interface AppCheckResult {
    success: boolean;
    appCheck: AppCheck | null;
    isFallbackOffline: boolean;
    reason?: string;
}

export interface AppCheckStatusDetails {
    initialized: boolean;
    supported: boolean;
    fallbackOffline: boolean;
    hasToken: boolean;
    tokenExpireTimestamp?: number;
    provider: 'ReCaptchaV3Provider' | 'none';
}

export const APP_CHECK_STRINGS = {
    unsupportedTitle: "Verifica di sicurezza non supportata",
    unsupportedMessage: "Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.",
    initErrorTitle: "Errore controllo di sicurezza",
    initErrorMessage: "Non è stato possibile completare la verifica di sicurezza con il server. La sincronizzazione cloud è temporaneamente sospesa; i tuoi dati sono salvati in sicurezza sul dispositivo.",
    missingSiteKeyWarning: "Chiave reCAPTCHA v3 (VITE_RECAPTCHA_V3_SITE_KEY) non configurata. App Check non inizializzato."
} as const;

let appCheckInstance: AppCheck | null = null;
let isSupportedCached: boolean | null = null;
let isFallbackOfflineMode: boolean = false;
let lastToken: AppCheckToken | null = null;

/**
 * Checks whether the current runtime environment (browser, WebView, PWA) supports App Check.
 */
export async function isAppCheckSupported(): Promise<boolean> {
    if (isSupportedCached !== null) {
        return isSupportedCached;
    }
    try {
        if (typeof window === 'undefined') {
            isSupportedCached = false;
            return false;
        }
        isSupportedCached = await isAppCheckSupportedSdk();
        return isSupportedCached;
    } catch (err) {
        console.warn("[AppCheck] Impossibile verificare il supporto del browser:", err);
        isSupportedCached = false;
        return false;
    }
}

/**
 * Initializes Firebase App Check with ReCaptchaV3Provider.
 * Falls back safely to offline-only operation if unsupported or failed.
 */
export async function initAppCheck(
    app: FirebaseApp, 
    options?: AppCheckInitOptions
): Promise<AppCheckResult> {
    const siteKey = options?.siteKey || 
        import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY || 
        import.meta.env.VITE_RECAPTCHA_SITE_KEY;

    // Enable debug token in development mode if requested or running on localhost
    const isDev = Boolean(import.meta.env?.DEV);
    if (typeof window !== 'undefined' && (isDev || options?.debugToken)) {
        // @ts-ignore
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = options?.debugToken ?? true;
    }

    if (!siteKey || siteKey.trim() === '') {
        console.warn(`[AppCheck] ${APP_CHECK_STRINGS.missingSiteKeyWarning}`);
        isFallbackOfflineMode = true;
        return {
            success: false,
            appCheck: null,
            isFallbackOffline: true,
            reason: APP_CHECK_STRINGS.missingSiteKeyWarning
        };
    }

    const supported = await isAppCheckSupported();
    if (!supported) {
        console.warn("[AppCheck] Ambiente non supportato da reCAPTCHA v3. Attivazione modalità locale offline.");
        isFallbackOfflineMode = true;
        return {
            success: false,
            appCheck: null,
            isFallbackOffline: true,
            reason: APP_CHECK_STRINGS.unsupportedMessage
        };
    }

    try {
        appCheckInstance = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: options?.isTokenAutoRefreshEnabled ?? true
        });

        // Attempt initial token acquisition to verify readiness
        try {
            lastToken = await getToken(appCheckInstance, false);
            isFallbackOfflineMode = false;
        } catch (tokenErr) {
            console.warn("[AppCheck] Token iniziale non acquisito, il provider riproverà automaticamente:", tokenErr);
        }

        return {
            success: true,
            appCheck: appCheckInstance,
            isFallbackOffline: false
        };
    } catch (err: any) {
        console.error("[AppCheck] Errore durante l'inizializzazione:", err);
        isFallbackOfflineMode = true;
        return {
            success: false,
            appCheck: null,
            isFallbackOffline: true,
            reason: err?.message || APP_CHECK_STRINGS.initErrorMessage
        };
    }
}

/**
 * Returns the active App Check instance if initialized.
 */
export function getAppCheckInstance(): AppCheck | null {
    return appCheckInstance;
}

/**
 * Returns true if App Check is currently active and healthy.
 */
export function isAppCheckActive(): boolean {
    return appCheckInstance !== null && !isFallbackOfflineMode;
}

/**
 * Returns true if the client has fallen back to offline mode due to App Check constraints.
 */
export function isAppCheckFallbackOffline(): boolean {
    return isFallbackOfflineMode;
}

/**
 * Manually toggle fallback offline mode (e.g. for testing or when cloud enforcement fails).
 */
export function setAppCheckFallbackOffline(fallback: boolean): void {
    isFallbackOfflineMode = fallback;
}

/**
 * Retrieves a fresh or cached App Check token string.
 */
export async function getAppCheckToken(forceRefresh: boolean = false): Promise<string | null> {
    if (!appCheckInstance || isFallbackOfflineMode) {
        return null;
    }
    try {
        const tokenResult = await getToken(appCheckInstance, forceRefresh);
        lastToken = tokenResult;
        return tokenResult.token;
    } catch (err) {
        console.error("[AppCheck] Errore durante il recupero del token:", err);
        return null;
    }
}

/**
 * Returns comprehensive telemetry status of the App Check module.
 */
export function getAppCheckStatus(): AppCheckStatusDetails {
    return {
        initialized: appCheckInstance !== null,
        supported: isSupportedCached === true,
        fallbackOffline: isFallbackOfflineMode,
        hasToken: Boolean(lastToken?.token),
        tokenExpireTimestamp: lastToken?.expireTimeMillis,
        provider: appCheckInstance ? 'ReCaptchaV3Provider' : 'none'
    };
}

/**
 * Reset internal state for unit/e2e testing.
 */
export function resetAppCheckStateForTesting(): void {
    appCheckInstance = null;
    isSupportedCached = null;
    isFallbackOfflineMode = false;
    lastToken = null;
}
