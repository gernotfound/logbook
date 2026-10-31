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

    it('classifies permission denial inside a transport wrapper as rejected, never pending', () => {
        const denial = Object.assign(new Error('Firestore denied'), { code: 'permission-denied' });
        const wrapped = Object.assign(new Error('Transport wrapper', { cause: denial }), { code: 'unavailable' });
        expect(classifySyncFailure(wrapped)).toEqual({ ok: false, status: 'rejected', error: wrapped });
        expect(classifySyncFailure(denial, { retryable: true }).status).toBe('rejected');
    });

    it('preserves App Check retryability through error causes without trusting a network wrapper', () => {
        const permanent = Object.assign(new Error('Provider unsupported'), { code: 'app-check-unavailable', retryable: false });
        const transient = Object.assign(new Error('Provider network error'), { code: 'app-check-unavailable', retryable: true });
        expect(classifySyncFailure(new Error('Wrapper', { cause: permanent })).status).toBe('failed');
        // A wrapper can represent a failed durability proof: its transient cause alone cannot authorize pending.
        expect(classifySyncFailure(new Error('Wrapper', { cause: transient })).status).toBe('failed');
        expect(classifySyncFailure(transient).status).toBe('local-pending');
        const misleading = Object.assign(new Error('Network wrapper', { cause: permanent }), { code: 'unavailable' });
        expect(classifySyncFailure(misleading).status).toBe('failed');
    });

    it('classifies direct cloud quota exhaustion as pending without trusting wrapper or local storage quota', () => {
        const quota = Object.assign(new Error('Free-tier quota reached'), { code: 'resource-exhausted' });
        expect(classifySyncFailure(quota).status).toBe('local-pending');
        expect(classifySyncFailure({ code: 'firestore/resource-exhausted' }).status).toBe('local-pending');
        expect(classifySyncFailure({ code: 'quota-exceeded' }).status).toBe('local-pending');
        expect(classifySyncFailure(new Error('Unsafe wrapper', { cause: quota })).status).toBe('failed');
        expect(classifySyncFailure(new DOMException('Local quota', 'QuotaExceededError')).status).toBe('failed');
        expect(mapFirebaseErrorCode(quota)).toMatchObject({ code: 'ERR_FIRESTORE_QUOTA', isOfflineSafe: true });
    });

    it('never converts an unsafe lost-response wrapper into pending from a nested transport error', () => {
        const transport = Object.assign(new Error('Response lost'), { code: 'unavailable' });
        const noDurableBatch = new Error('Delivered batch was not retained', { cause: transport });
        expect(classifySyncFailure(transport).status).toBe('local-pending');
        expect(classifySyncFailure(noDurableBatch).status).toBe('failed');
    });

    it('keeps an independently verified lost-ACK batch pending even if the wrapped cause is denied', () => {
        const denial = Object.assign(new Error('Provider denied'), { code: 'permission-denied' });
        const confirmedRemote = new Error('Remote commit confirmed but local ACK failed', { cause: denial });
        expect(classifySyncFailure(confirmedRemote, { retryable: true }).status).toBe('local-pending');
    });

    it('does not trust inherited provider codes or causes on arbitrary errors', () => {
        const denial = Object.assign(new Error('Denied'), { code: 'permission-denied' });
        const inheritedCode = Object.create({ code: 'permission-denied' }) as object;
        const inheritedCause = Object.create({ cause: denial }) as object;
        expect(classifySyncFailure(inheritedCode).status).toBe('failed');
        expect(classifySyncFailure(inheritedCause).status).toBe('failed');
    });

    it('bounds cyclic error causes and fails closed on unknown failures', () => {
        const cyclic: { cause?: unknown } = {};
        cyclic.cause = cyclic;
        expect(classifySyncFailure(new Error('Unknown', { cause: cyclic })).status).toBe('failed');
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