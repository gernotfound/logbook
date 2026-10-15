import { DeletionDeadlineExceededError } from './deletionDeadline';

export type RecoveryOperation = 'routine-check' | 'device-registration' | 'pending-deletion' | 'local-finalization';
export type RecoveryPhase = 'auth-token' | 'app-check' | 'http' | 'response-body' | 'server-status' | 'storage' | 'local-finalization' | 'unknown';
export type RecoveryKind = 'timeout' | 'transport' | 'provider' | 'server' | 'rejected' | 'invalid-response' | 'remote-failed' | 'integrity' | 'stale-session' | 'unknown';

export class DeletionDeviceOperationError extends Error {
    readonly code = 'account-deletion-device-operation-failed';

    constructor(
        readonly operation: 'routine-check' | 'device-registration',
        readonly phase: RecoveryPhase,
        readonly kind: RecoveryKind,
        readonly httpStatus?: number,
        cause?: unknown,
    ) {
        const detail = httpStatus === undefined ? '' : ` (HTTP ${httpStatus}).`;
        const message = kind === 'remote-failed'
            ? 'Cancellazione cloud non completata: alcuni dati potrebbero essere già stati eliminati. La copia locale rimane conservata.'
            : kind === 'invalid-response'
                ? 'Risposta del servizio di recupero non valida. La copia locale rimane conservata.'
                : phase === 'app-check'
                    ? 'Verifica di sicurezza temporaneamente non disponibile. La copia locale resta conservata; il controllo verrà ripetuto automaticamente.'
                    : operation === 'device-registration'
                        ? 'Registrazione recovery device non riuscita' + detail
                        : 'Verifica recovery device non riuscita' + detail;
        super(message, cause instanceof Error ? { cause } : undefined);
        this.name = 'DeletionDeviceOperationError';
    }
}

export function deviceOperationFailure(
    operation: 'routine-check' | 'device-registration',
    phase: RecoveryPhase,
    error: unknown,
    httpStatus?: number,
): DeletionDeviceOperationError {
    if (error instanceof DeletionDeviceOperationError) return error;
    const kind: RecoveryKind = httpStatus !== undefined
        ? httpStatus >= 500 || httpStatus === 429 ? 'server' : 'rejected'
        : error instanceof DeletionDeadlineExceededError ? 'timeout'
            : phase === 'auth-token' || phase === 'app-check' ? 'provider'
                : phase === 'http' ? 'transport'
                    : phase === 'response-body' || phase === 'server-status' ? 'invalid-response'
                        : 'unknown';
    return new DeletionDeviceOperationError(operation, phase, kind, httpStatus, error);
}

export type RecoveryFailure = {
    operation: RecoveryOperation;
    phase: RecoveryPhase;
    kind: RecoveryKind;
    httpStatus?: number;
    transient: boolean;
};

export function classifyRecoveryFailure(operation: RecoveryOperation, error: unknown): RecoveryFailure {
    if (error instanceof DeletionDeviceOperationError) {
        return {
            operation: error.operation,
            phase: error.phase,
            kind: error.kind,
            httpStatus: error.httpStatus,
            transient: error.kind === 'timeout' || error.kind === 'transport'
                || error.kind === 'provider' || error.kind === 'server',
        };
    }
    const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code : undefined;
    if (operation === 'local-finalization' || code === 'account-deletion-device-finalization-failed') {
        return { operation: 'local-finalization', phase: 'local-finalization', kind: 'integrity', transient: false };
    }
    if (code === 'account-deletion-marker-corrupt' || code === 'account-deletion-device-credential-corrupt'
        || code === 'browser-storage-error') {
        return { operation, phase: 'storage', kind: 'integrity', transient: false };
    }
    if (error instanceof DeletionDeadlineExceededError || error instanceof Error && /TimeoutError$/.test(error.name)) {
        return { operation, phase: 'unknown', kind: 'timeout', transient: true };
    }
    // Unknown failures must never be hidden as routine network timeouts.
    return { operation, phase: 'unknown', kind: 'unknown', transient: false };
}

/**
 * Reports bounded technical summaries, never raw exceptions or owner identifiers.
 * Transient failures are surfaced on the third consecutive occurrence and then
 * every tenth; recovery resets that streak. Integrity failures are immediate.
 */
export class RecoveryDiagnosticTracker {
    private readonly streaks = new Map<RecoveryOperation, { key: string; count: number }>();

    recordFailure(
        operation: RecoveryOperation,
        error: unknown,
        report: (summary: Error, source: string) => void,
    ): RecoveryFailure {
        const failure = classifyRecoveryFailure(operation, error);
        if (failure.kind === 'stale-session') return failure;
        const key = [failure.phase, failure.kind, failure.httpStatus ?? ''].join(':');
        const previous = this.streaks.get(operation);
        const count = previous?.key === key ? previous.count + 1 : 1;
        this.streaks.set(operation, { key, count });
        if ((!failure.transient && count === 1) || (failure.transient && count === 3) || count % 10 === 0) {
            const summary = new Error(
                `operation=${operation}; phase=${failure.phase}; kind=${failure.kind}; http=${failure.httpStatus ?? 'none'}; consecutive=${count}`,
            );
            summary.name = 'AccountDeletionRecoveryDiagnostic';
            report(summary, `account_deletion_${operation.replaceAll('-', '_')}`);
        }
        return failure;
    }

    recordSuccess(operation: RecoveryOperation): void {
        this.streaks.delete(operation);
    }
}
