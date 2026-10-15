import { describe, expect, it, vi } from 'vitest';
import {
    classifyRecoveryFailure,
    DeletionDeviceOperationError,
    RecoveryDiagnosticTracker,
} from '../src/lib/deletionRecoveryDiagnostics';

describe('account deletion recovery diagnostics', () => {
    it('classifies each phase without inspecting exception message text', () => {
        const failure = new DeletionDeviceOperationError('device-registration', 'auth-token', 'provider');
        expect(classifyRecoveryFailure('device-registration', failure)).toMatchObject({
            operation: 'device-registration',
            phase: 'auth-token',
            kind: 'provider',
            transient: true,
        });
        expect(classifyRecoveryFailure('routine-check', Object.assign(new Error('corrupt'), {
            code: 'account-deletion-device-credential-corrupt',
        }))).toMatchObject({ phase: 'storage', kind: 'integrity', transient: false });
    });

    it('aggregates transients by phase, resets on success and keeps different operations independent', () => {
        const tracker = new RecoveryDiagnosticTracker();
        const emit = vi.fn();
        const failure = new DeletionDeviceOperationError('routine-check', 'http', 'transport');
        tracker.recordFailure('routine-check', failure, emit);
        tracker.recordFailure('routine-check', failure, emit);
        expect(emit).not.toHaveBeenCalled();
        tracker.recordFailure('routine-check', failure, emit);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('consecutive=3') }),
            'account_deletion_routine_check',
        );

        tracker.recordSuccess('routine-check');
        tracker.recordFailure('routine-check', failure, emit);
        expect(emit).toHaveBeenCalledTimes(1);
        tracker.recordFailure('pending-deletion', new Error('unrecognized failure'), emit);
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit.mock.calls[1][1]).toBe('account_deletion_pending_deletion');
    });

    it('does not emit raw error messages, UID or credentials in the technical summary', () => {
        const tracker = new RecoveryDiagnosticTracker();
        const emit = vi.fn();
        const error = new DeletionDeviceOperationError(
            'routine-check', 'http', 'server', 503,
            new Error('Bearer private-secret user uid-abc'),
        );
        for (let i = 0; i < 3; i++) tracker.recordFailure('routine-check', error, emit);
        const summary = emit.mock.calls[0]?.[0] as Error;
        expect(summary.message).toContain('http=503');
        expect(summary.message).not.toContain('private-secret');
        expect(summary.message).not.toContain('uid-abc');
        expect(summary.cause).toBeUndefined();
    });

    it('does not report stale session races as service outages', () => {
        const tracker = new RecoveryDiagnosticTracker();
        const emit = vi.fn();
        tracker.recordFailure('device-registration', new DeletionDeviceOperationError(
            'device-registration', 'auth-token', 'stale-session',
        ), emit);
        expect(emit).not.toHaveBeenCalled();
    });
});
