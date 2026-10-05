import { describe, expect, it } from 'vitest';
import { mapFirebaseErrorCode } from '../src/lib/errorHandler';
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

    it('keeps unknown cloud failures fail-closed in presentation', () => {
        const formatted = mapFirebaseErrorCode(new Error('unexpected cloud runtime failure'));

        expect(formatted.code).toBe('ERR_UNKNOWN');
        expect(formatted.isOfflineSafe).toBe(false);
        expect(formatted.canRetry).toBe(false);
    });
});
