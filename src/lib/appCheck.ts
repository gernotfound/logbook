/**
 * Firebase App Check Security Module (TheLogBook PWA)
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
    getLimitedUseToken,
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
    retryable: boolean;
    error?: unknown;
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
    unsupportedMessage: 'Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. TheLogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.',
    initErrorTitle: 'Errore controllo di sicurezza',
    initErrorMessage: 'Non è stato possibile completare la verifica di sicurezza con il server. La sincronizzazione cloud è temporaneamente sospesa; i tuoi dati sono salvati in sicurezza sul dispositivo.',
    missingSiteKeyWarning: 'Chiave reCAPTCHA Enterprise (VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) non configurata. App Check non inizializzato.',
} as const;

let appCheckInstance: AppCheck | null = null;
let isSupportedCached: boolean | null = null;
let isFallbackOfflineMode = false;
let lastToken: AppCheckTokenResult | null = null;
let lastTokenError: string | null = null;
let lastTokenRetryable = false;
let lastFailure: unknown = null;
let appCheckPhase: AppCheckPhase = 'uninitialized';

type AppCheckErrorDetails = {
    code: string | null;
    status: number | null;
};

function appCheckErrorDetails(error: unknown): AppCheckErrorDetails {
    if (!error || typeof error !== 'object') return { code: null, status: null };
    const candidate = error as { code?: unknown; status?: unknown };
    return {
        code: typeof candidate.code === 'string' ? candidate.code : null,
        status: typeof candidate.status === 'number' ? candidate.status : null,
    };
}

function appCheckErrorText(error: unknown): string {
    if (!error || typeof error !== 'object') return String(error ?? '');
    const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
    return [
        typeof candidate.code === 'string' ? candidate.code : '',
        typeof candidate.message === 'string' ? candidate.message : '',
        typeof candidate.status === 'number' ? String(candidate.status) : '',
    ].filter(Boolean).join(' ').toLowerCase();
}

function isRetryableTokenError(error: unknown): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

    const { code, status } = appCheckErrorDetails(error);
    const normalizedCode = code?.toLowerCase() ?? '';
    if ([
        'appcheck/fetch-network-error',
        'appcheck/throttled',
        'appcheck/initial-throttle',
    ].includes(normalizedCode)) {
        return true;
    }
    if (status === 408 || status === 429 || (status !== null && status >= 500 && status <= 599)) {
        return true;
    }

    const text = appCheckErrorText(error);
    if (!text) return false;
    return [
        'network',
        'failed to fetch',
        'timeout',
        'timed out',
        'unavailable',
        'deadline-exceeded',
        'initial-throttle',
        'throttled',
        'too-many-requests',
        '429',
        '500',
        '502',
        '503',
        '504',
    ].some(marker => text.includes(marker));
}

export class AppCheckLimitedUseTokenError extends Error {
    readonly code = 'app-check-limited-use-unavailable';
    readonly firebaseCode: string | null;
    readonly status: number | null;
    readonly retryable: boolean;

    constructor(error: unknown) {
        const details = appCheckErrorDetails(error);
        const diagnostics = [
            details.code ? 'code=' + details.code : 'code=unknown',
            details.status !== null ? 'status=' + details.status : null,
        ].filter(Boolean).join(', ');
        super(
            'Token App Check limited-use non disponibile (' + diagnostics + ').',
            error instanceof Error ? { cause: error } : undefined,
        );
        this.name = 'AppCheckLimitedUseTokenError';
        this.firebaseCode = details.code;
        this.status = details.status;
        this.retryable = isRetryableTokenError(error);
    }
}

function resolveSiteKey(options?: AppCheckInitOptions): string | undefined {
    return options?.siteKey
        || import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
}

function runtimeSupportsAppCheck(): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    return typeof window.crypto !== 'undefined' && typeof window.fetch !== 'undefined';
}

function currentResult(reason?: string): AppCheckResult {
    const tokenAvailable = Boolean(lastToken?.token);
    return {
        success: appCheckPhase === 'token-ready' && tokenAvailable,
        appCheck: appCheckInstance,
        isFallbackOffline: isFallbackOfflineMode,
        disabled: appCheckPhase === 'disabled',
        reason,
        phase: appCheckPhase,
        providerInitialized: appCheckInstance !== null,
        tokenAvailable,
        tokenError: lastTokenError ?? undefined,
        retryable: appCheckPhase === 'token-error' && lastTokenRetryable,
        error: lastFailure ?? undefined,
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
        lastTokenRetryable = false;
        lastFailure = null;
        appCheckPhase = 'disabled';
        return currentResult('Site key not configured');
    }

    const supported = runtimeSupportsAppCheck();
    isSupportedCached = supported;
    if (!supported) {
        console.warn('[AppCheck] Ambiente non supportato da reCAPTCHA Enterprise. Attivazione modalità locale offline.');
        isFallbackOfflineMode = true;
        lastTokenRetryable = false;
        lastFailure = null;
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
        lastTokenRetryable = false;
        lastFailure = null;
        appCheckPhase = 'provider-ready';
        return currentResult();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : APP_CHECK_STRINGS.initErrorMessage;
        console.error('[AppCheck] Errore durante l\'inizializzazione del provider:', error);
        appCheckInstance = null;
        isFallbackOfflineMode = true;
        lastTokenRetryable = false;
        lastFailure = error;
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

    try {
        // Firebase App Check owns token caching and freshness. Always ask the SDK
        // for the current valid token instead of treating a token obtained by this
        // module in the past as proof that App Check is still ready.
        const tokenResult = await getToken(appCheckInstance!, false);
        lastToken = tokenResult;
        lastTokenError = null;
        lastTokenRetryable = false;
        lastFailure = null;
        isFallbackOfflineMode = false;
        appCheckPhase = 'token-ready';
        return currentResult();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Token App Check non disponibile';
        console.warn('[AppCheck] Token iniziale non acquisito; la sincronizzazione cloud resta sospesa finché il token non è disponibile:', error);
        lastToken = null;
        lastTokenError = message;
        lastTokenRetryable = isRetryableTokenError(error);
        lastFailure = error;
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
        lastTokenRetryable = false;
        lastFailure = null;
        isFallbackOfflineMode = false;
        appCheckPhase = 'token-ready';
        return tokenResult.token;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Token App Check non disponibile';
        console.error('[AppCheck] Errore durante il recupero del token:', error);
        lastToken = null;
        lastTokenError = message;
        lastTokenRetryable = isRetryableTokenError(error);
        lastFailure = error;
        isFallbackOfflineMode = true;
        appCheckPhase = 'token-error';
        return null;
    }
}

export async function getLimitedUseAppCheckToken(): Promise<string> {
    if (!appCheckInstance) {
        throw new AppCheckLimitedUseTokenError(
            Object.assign(new Error('Provider App Check non inizializzato.'), {
                code: 'appcheck/provider-unavailable',
            }),
        );
    }
    try {
        const tokenResult = await getLimitedUseToken(appCheckInstance);
        if (!tokenResult.token) {
            throw Object.assign(new Error('Token App Check limited-use vuoto.'), {
                code: 'appcheck/empty-token',
            });
        }
        return tokenResult.token;
    } catch (error: unknown) {
        console.error('[AppCheck] Errore durante il recupero del token limited-use:', error);
        // Limited-use tokens protect custom backend requests and have their own
        // one-shot lifecycle. Their failure must not overwrite the freshness state
        // of the standard token used to represent Firebase cloud readiness.
        if (error instanceof AppCheckLimitedUseTokenError) throw error;
        throw new AppCheckLimitedUseTokenError(error);
    }
}

export function getAppCheckStatus(): AppCheckStatusDetails {
    const tokenAvailable = Boolean(lastToken?.token);
    return {
        initialized: appCheckInstance !== null,
        providerInitialized: appCheckInstance !== null,
        supported: isSupportedCached === true,
        fallbackOffline: isFallbackOfflineMode,
        hasToken: tokenAvailable,
        tokenAvailable,
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
    lastTokenRetryable = false;
    lastFailure = null;
    appCheckPhase = 'uninitialized';
}