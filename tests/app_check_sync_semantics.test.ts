import { describe, expect, it } from 'vitest';
import { formatAppCheckTelemetryMessage, mapFirebaseErrorCode } from '../src/lib/errorHandler';
import { classifySyncFailure } from '../src/lib/sync/syncFailure';

describe('Audit 21 App Check and rejected-sync semantics', () => {
    it('fails closed for permanent App Check failures and retries only explicit transient failures', () => {
        const permanent = Object.assign(new Error('App Check unsupported'), {
            code: 'app-check-unavailable',
            phase: 'unsupported',
            retryable: false,
        });
        const transient = Object.assign(new Error('App Check network unavailable'), {
            code: 'app-check-unavailable',
            phase: 'token-error',
            retryable: true,
        });

        expect(classifySyncFailure(permanent).status).toBe('failed');
        expect(classifySyncFailure(transient).status).toBe('local-pending');
    });

    it('preserves permission-denied through a wrapping Error cause', () => {
        const firebaseError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        });
        const wrapped = new Error('Sincronizzazione rifiutata dal server.', { cause: firebaseError });

        const formatted = mapFirebaseErrorCode(wrapped);

        expect(formatted.code).toBe('ERR_FIRESTORE_PERMISSION');
        expect(formatted.category).toBe('permission');
        expect(formatted.isOfflineSafe).toBe(false);
        expect(formatted.canRetry).toBe(false);
    });

    it('does not turn structural App Check failures into offline success messaging', () => {
        const unsupported = Object.assign(new Error('Verifica di sicurezza non supportata'), {
            code: 'app-check-unavailable',
            phase: 'unsupported',
            retryable: false,
        });

        const formatted = mapFirebaseErrorCode(unsupported);

        expect(formatted.code).toBe('ERR_APP_CHECK_UNSUPPORTED');
        expect(formatted.isOfflineSafe).toBe(false);
        expect(formatted.canRetry).toBe(false);
    });

    it('maps limited-use and reCAPTCHA provider failures to App Check diagnostics', () => {
        const limited = Object.assign(new Error('Token App Check limited-use non disponibile'), {
            code: 'app-check-limited-use-unavailable',
        });
        const recaptcha = Object.assign(new Error('assessment rejected'), {
            code: 'appCheck/recaptcha-error',
        });

        expect(mapFirebaseErrorCode(limited)).toMatchObject({
            code: 'ERR_APP_CHECK_BLOCKED',
            category: 'app_check',
        });
        expect(mapFirebaseErrorCode(recaptcha)).toMatchObject({
            code: 'ERR_APP_CHECK_BLOCKED',
            category: 'app_check',
        });
    });

    it('builds privacy-safe App Check telemetry from a wrapped provider cause', () => {
        const provider = Object.assign(new Error('provider detail that must not be copied'), {
            code: 'appCheck/recaptcha-error',
            status: 403,
        });
        const wrapped = Object.assign(new Error('Verifica App Check non disponibile.'), {
            code: 'app-check-unavailable',
            phase: 'token-error',
            retryable: false,
            cause: provider,
        });

        expect(formatAppCheckTelemetryMessage(wrapped)).toBe(
            'App Check failure; code=appCheck/recaptcha-error; status=403; phase=token-error; retryable=false',
        );
        expect(formatAppCheckTelemetryMessage(new Error('ordinary failure'))).toBeUndefined();
    });

    it('keeps unknown cloud failures fail-closed in presentation', () => {
        const formatted = mapFirebaseErrorCode(new Error('unexpected cloud runtime failure'));

        expect(formatted.code).toBe('ERR_UNKNOWN');
        expect(formatted.isOfflineSafe).toBe(false);
        expect(formatted.canRetry).toBe(false);
    });
});