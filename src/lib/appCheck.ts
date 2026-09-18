/**
 * Firebase App Check Security Module (LogBook PWA)
 *
 * Provider: ReCaptchaEnterpriseProvider (Google reCAPTCHA Enterprise).
 * The provider is initialized synchronously before Firestore so protected
 * services never race the App Check provider bootstrap. Token acquisition is
 * tracked separately because it is asynchronous and may fail transiently.
 */

import {
    initializeAppCheck,
    ReCaptchaEnterpriseProvider,
    getToken,
    type AppCheck,
    type AppCheckTokenResult,
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

export interface AppCheckInitOptions {
    siteKey?: string;
    isTokenAutoRefreshEnabled?: boolean;
    debugToken?: boolean | string;
}

export type AppCheckPhase =
    | 'uninitialized'
    | 'disabled'
    | 'unsupported'
    | 'provider-ready'
    | 'token-ready'
    | 'token-error'
    | 'error';

export interface AppCheckResult {
    success: boolean;
    appCheck: AppCheck | null;
    isFallbackOffline: boolean;
    disabled?: boolean;
    reason?: string;
    phase: AppCheckPhase;
    providerInitialized: boolean;
    tokenAvailable: boolean;
    tokenError?: string;
}

export interface AppCheckStatusDetails {
    initialized: boolean;
    providerInitialized: boolean;
    supported: boolean;
    fallbackOffline: boolean;
    hasToken: boolean;
    tokenAvailable: boolean;
    tokenError: string | null;
    provider: 'ReCaptchaEnterpriseProvider' | 'none';
    phase: AppCheckPhase;
}

export const APP_CHECK_STRINGS = {
    unsupportedTitle: 'Verifica di sicurezza non supportata',
    unsupportedMessage: 'Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.',
    initErrorTitle: 'Errore controllo di sicurezza',
    initErrorMessage: 'Non è stato possibile completare la verifica di sicurezza con il server. La sincronizzazione cloud è temporaneamente sospesa; i tuoi dati sono salvati in sicurezza sul dispositivo.',
    missingSiteKeyWarning: 'Chiave reCAPTCHA Enterprise (VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) non configurata. App Check non inizializzato.',
} as const;

let appCheckInstance: AppCheck | null = null;
let isSupportedCached: boolean | null = null;
let isFallbackOfflineMode = false;
let lastToken: AppCheckTokenResult | null = null;
let lastTokenError: string | null = null;
let appCheckPhase: AppCheckPhase = 'uninitialized';

function resolveSiteKey(options?: AppCheckInitOptions): string | undefined {
    return options?.siteKey
        || import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
        || import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY
        || import.meta.env.VITE_RECAPTCHA_SITE_KEY;
}

function runtimeSupportsAppCheck(): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    return typeof window.crypto !== 'undefined' && typeof window.fetch !== 'undefined';
}

function currentResult(reason?: string): AppCheckResult {
    return {
        success: appCheckPhase === 'token-ready',
        appCheck: appCheckInstance,
        isFallbackOffline: isFallbackOfflineMode,
        disabled: appCheckPhase === 'disabled',
        reason,
        phase: appCheckPhase,
        providerInitialized: appCheckInstance !== null,
        tokenAvailable: Boolean(lastToken?.token),
        tokenError: lastTokenError ?? undefined,
    };
}

/**
 * Synchronous provider bootstrap used by firebase.ts before initializeFirestore().
 * It intentionally does not fetch a token: token acquisition is asynchronous and
 * is handled by initAppCheck().
 */
export function ensureAppCheckProvider(
    app: FirebaseApp,
    options?: AppCheckInitOptions,
): AppCheckResult {
    if (appCheckInstance) return currentResult();

    const siteKey = resolveSiteKey(options);
    if (!siteKey || siteKey.trim() === '') {
        console.warn(APP_CHECK_STRINGS.missingSiteKeyWarning);
        isFallbackOfflineMode = true;
        isSupportedCached = runtimeSupportsAppCheck();
        appCheckPhase = 'disabled';
        return currentResult('Site key not configured');
    }

    const supported = runtimeSupportsAppCheck();
    isSupportedCached = supported;
    if (!supported) {
        console.warn('[AppCheck] Ambiente non supportato da reCAPTCHA Enterprise. Attivazione modalità locale offline.');
        isFallbackOfflineMode = true;
        appCheckPhase = 'unsupported';
        return currentResult(APP_CHECK_STRINGS.unsupportedMessage);
    }

    const isDev = Boolean(import.meta.env?.DEV);
    if (typeof window !== 'undefined' && (isDev || options?.debugToken)) {
        // Firebase reads this global before provider initialization.
        (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = options?.debugToken ?? true;
    }

    try {
        appCheckInstance = initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(siteKey.trim()),
            isTokenAutoRefreshEnabled: options?.isTokenAutoRefreshEnabled ?? true,
        });
        isFallbackOfflineMode = false;
        lastTokenError = null;
        appCheckPhase = 'provider-ready';
        return currentResult();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : APP_CHECK_STRINGS.initErrorMessage;
        console.error('[AppCheck] Errore durante l\'inizializzazione del provider:', error);
        appCheckInstance = null;
        isFallbackOfflineMode = true;
        appCheckPhase = 'error';
        return currentResult(message);
    }
}

/**
 * Checks whether the current runtime environment supports App Check.
 * Kept async for API compatibility with existing consumers/tests.
 */
export async function isAppCheckSupported(): Promise<boolean> {
    if (isSupportedCached !== null) return isSupportedCached;
    try {
        isSupportedCached = runtimeSupportsAppCheck();
        return isSupportedCached;
    } catch (error) {
        console.warn('[AppCheck] Impossibile verificare il supporto del browser:', error);
        isSupportedCached = false;
        return false;
    }
}

/**
 * Initializes the provider if needed, then resolves the initial token state.
 * A provider without a token is not reported as healthy/active.
 */
export async function initAppCheck(
    app: FirebaseApp,
    options?: AppCheckInitOptions,
): Promise<AppCheckResult> {
    const providerResult = ensureAppCheckProvider(app, options);
    if (!providerResult.providerInitialized) return providerResult;
    if (lastToken?.token) {
        appCheckPhase = 'token-ready';
        isFallbackOfflineMode = false;
        return currentResult();
    }

    try {
        lastToken = await getToken(appCheckInstance!, false);
        lastTokenError = null;
        isFallbackOfflineMode = false;
        appCheckPhase = 'token-ready';
        return currentResult();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Token App Check non disponibile';
        console.warn('[AppCheck] Token iniziale non acquisito; la sincronizzazione cloud resta sospesa finché il token non è disponibile:', error);
        lastToken = null;
        lastTokenError = message;
        isFallbackOfflineMode = true;
        appCheckPhase = 'token-error';
        return currentResult(message);
    }
}

export function getAppCheckInstance(): AppCheck | null {
    return appCheckInstance;
}

export function isAppCheckActive(): boolean {
    return appCheckInstance !== null && Boolean(lastToken?.token) && !isFallbackOfflineMode;
}

export function isAppCheckFallbackOffline(): boolean {
    return isFallbackOfflineMode;
}

export function setAppCheckFallbackOffline(fallback: boolean): void {
    isFallbackOfflineMode = fallback;
}

export async function getAppCheckToken(forceRefresh = false): Promise<string | null> {
    if (!appCheckInstance) return null;
    try {
        const tokenResult = await getToken(appCheckInstance, forceRefresh);
        lastToken = tokenResult;
        lastTokenError = null;
        isFallbackOfflineMode = false;
        appCheckPhase = 'token-ready';
        return tokenResult.token;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Token App Check non disponibile';
        console.error('[AppCheck] Errore durante il recupero del token:', error);
        lastToken = null;
        lastTokenError = message;
        isFallbackOfflineMode = true;
        appCheckPhase = 'token-error';
        return null;
    }
}

export function getAppCheckStatus(): AppCheckStatusDetails {
    return {
        initialized: appCheckInstance !== null,
        providerInitialized: appCheckInstance !== null,
        supported: isSupportedCached === true,
        fallbackOffline: isFallbackOfflineMode,
        hasToken: Boolean(lastToken?.token),
        tokenAvailable: Boolean(lastToken?.token),
        tokenError: lastTokenError,
        provider: appCheckInstance ? 'ReCaptchaEnterpriseProvider' : 'none',
        phase: appCheckPhase,
    };
}

export function resetAppCheckStateForTesting(): void {
    appCheckInstance = null;
    isSupportedCached = null;
    isFallbackOfflineMode = false;
    lastToken = null;
    lastTokenError = null;
    appCheckPhase = 'uninitialized';
}
