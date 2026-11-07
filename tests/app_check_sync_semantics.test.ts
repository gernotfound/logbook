import { describe, expect, it, vi } from 'vitest';
import { AppCheckLimitedUseTokenError } from '../src/lib/appCheck';
import { SyncTimeoutError } from '../src/lib/db/db_core';
import { classifySyncFailure } from '../src/lib/sync/syncFailure';

// The UI setup mocks key transport; use its real error type without calling that transport.
const { CloudKeyAccessUnavailableError } = await vi.importActual<typeof import('../src/lib/sync/cloudAccountKeyAccess')>(
    '../src/lib/sync/cloudAccountKeyAccess',
);

describe('cloud sync failure classification', () => {
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


    it.each([
        ['appCheck/fetch-network-error', undefined, 'local-pending'],
        ['appCheck/throttled', 429, 'local-pending'],
        ['appCheck/recaptcha-error', 403, 'failed'],
        ['appcheck/provider-unavailable', undefined, 'failed'],
    ] as const)('classifies the real limited-use token error %s without trusting wrappers', (code, status, expected) => {
        const provider = Object.assign(new Error('Provider failure'), { code, status });
        const error = new AppCheckLimitedUseTokenError(provider);
        expect(classifySyncFailure(error).status).toBe(expected);
        const wrapped = Object.assign(new Error('Unsafe bootstrap', { cause: error }), { code: 'unavailable' });
        expect(classifySyncFailure(wrapped).status).toBe('failed');
    });

    it('retries direct Auth network failures while keeping credential denial terminal', () => {
        expect(classifySyncFailure({ code: 'auth/network-request-failed' }).status).toBe('local-pending');
        expect(classifySyncFailure({ code: 'auth/user-token-expired' }).status).toBe('failed');
        expect(classifySyncFailure(new Error('Unsafe wrapper', {
            cause: { code: 'auth/network-request-failed' },
        })).status).toBe('failed');
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

    it.each([
        ['permission denial', Object.assign(new Error('Denied'), { code: 'permission-denied' })],
        ['permanent capability failure', new AppCheckLimitedUseTokenError(
            Object.assign(new Error('Provider unsupported'), { code: 'appcheck/provider-unavailable' }),
        )],
        ['unknown failure', new Error('Unknown remote outcome')],
    ] as const)('fails closed when a transport wrapper hides an uninspected %s', (_, terminal) => {
        let cause: Error = terminal;
        for (let depth = 0; depth < 12; depth++) cause = new Error('Intermediate wrapper', { cause });
        const error = Object.assign(new Error('Transport wrapper', { cause }), { code: 'unavailable' });

        expect(classifySyncFailure(error)).toEqual({ ok: false, status: 'failed', error });
        expect(classifySyncFailure(error, { retryable: false }).status).toBe('failed');
        // This override belongs to callers which have independently re-read the retained batch.
        expect(classifySyncFailure(error, { retryable: true }).status).toBe('local-pending');
    });

    it.each([
        ['sync timeout', new SyncTimeoutError(), 'local-pending'],
        ['Firestore deadline', Object.assign(new Error('Deadline'), { code: 'deadline-exceeded' }), 'local-pending'],
        ['permanent cloud-key failure', new CloudKeyAccessUnavailableError(), 'failed'],
        ['transient cloud-key failure', new CloudKeyAccessUnavailableError(true), 'local-pending'],
        ['Auth network failure', Object.assign(new Error('Auth network'), { code: 'auth/network-request-failed' }), 'local-pending'],
        ['network wrapper around Auth', Object.assign(new Error('Unsafe wrapper', {
            cause: Object.assign(new Error('Auth network'), { code: 'auth/network-request-failed' }),
        }), { code: 'unavailable' }), 'failed'],
        ['unknown runtime failure', new Error('Unexpected runtime failure'), 'failed'],
    ] as const)('preserves the complete failure result for %s', (_, error, status) => {
        const result = classifySyncFailure(error);
        expect(result).toEqual({ ok: false, status, error });
        expect(result.error).toBe(error);
    });

    it.each([null, undefined, 'provider rejected', 7, Object.assign(() => undefined, { code: 'unavailable' })])('fails closed for a non-object rejection: %s', error => {
        expect(classifySyncFailure(error)).toEqual({ ok: false, status: 'failed', error });
    });

    it('does not mistake a timeout name or a wrapped timeout for a direct sync timeout', () => {
        const named = Object.assign(new Error('Not a sync timeout'), { name: 'SyncTimeoutError' });
        const wrapped = new Error('Unsafe wrapper', { cause: new SyncTimeoutError() });
        expect(classifySyncFailure(named)).toEqual({ ok: false, status: 'failed', error: named });
        expect(classifySyncFailure(wrapped)).toEqual({ ok: false, status: 'failed', error: wrapped });
    });

    it('retains a visible permission denial even when later causes remain uninspected', () => {
        let cause: Error = new Error('Unknown outcome');
        for (let depth = 0; depth < 12; depth++) cause = new Error('Intermediate wrapper', { cause });
        const error = Object.assign(new Error('Denied', { cause }), { code: 'permission-denied' });

        expect(classifySyncFailure(error)).toEqual({ ok: false, status: 'rejected', error });
        expect(classifySyncFailure(error, { retryable: true }).status).toBe('rejected');
    });

    it('keeps completely inspected transport causes retryable, including a visited cycle', () => {
        for (const cause of [new Error('Remote context'), null, undefined, 'Remote context', 7]) {
            const short = Object.assign(new Error('Transport', { cause }), { code: 'unavailable' });
            expect(classifySyncFailure(short)).toEqual({ ok: false, status: 'local-pending', error: short });
        }
        const cyclic = Object.assign(new Error('Transport'), { code: 'unavailable', cause: {} as unknown });
        cyclic.cause = cyclic;
        expect(classifySyncFailure(cyclic)).toEqual({ ok: false, status: 'local-pending', error: cyclic });
    });

    it('bounds cyclic error causes and fails closed on unknown failures', () => {
        const cyclic: { cause?: unknown } = {};
        cyclic.cause = cyclic;
        expect(classifySyncFailure(new Error('Unknown', { cause: cyclic })).status).toBe('failed');
    });



});