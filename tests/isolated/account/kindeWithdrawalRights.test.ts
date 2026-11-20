import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde rights and withdrawal must not import Firebase');
});

import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { KindeCandidateBoundaryError, readKindeCandidateAccess } from '../../../src/lib/auth/kindeCandidateClient';
import { readKindeCandidateWithdrawalMarker, reconcileKindeCandidateWithdrawal, withdrawKindeCandidateHealthConsent } from '../../../src/lib/auth/kindeCandidateWithdrawal';
import { withKindeCandidateRightsKey } from '../../../src/lib/auth/kindeCandidateRightsKey';
import { isKindeAccountLocalFitnessClear } from '../../../src/lib/sync/kindeOwnerLocalFitnessFence';
import { uid, owner, expected, marker, browser, provisionKey } from './kindeWithdrawalRightsFixture';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Kinde withdrawal and rights-only client against first-party Workers and D1 SQL', () => {
    it('reads an owner-scoped withdrawal marker without treating corrupt storage as permission', () => {
        expect(readKindeCandidateWithdrawalMarker(uid)).toBe('none');
        localStorage.setItem(marker, 'pending:1');
        expect(readKindeCandidateWithdrawalMarker(uid)).toBe('pending');
        localStorage.setItem(marker, 'withdrawn');
        expect(readKindeCandidateWithdrawalMarker(uid)).toBe('withdrawn');
        localStorage.setItem(marker, 'unexpected');
        expect(readKindeCandidateWithdrawalMarker(uid)).toBe('invalid');
        expect(readKindeCandidateWithdrawalMarker('k_' + 'B'.repeat(43))).toBe('none');
        expect(readKindeCandidateWithdrawalMarker('not-an-account')).toBe('invalid');
        const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        expect(readKindeCandidateWithdrawalMarker(uid)).toBe('invalid');
        read.mockRestore();
    });


    it('fences the owner before withdrawal, proves a queued job, preserves rights key and never reopens fitness', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const key = await provisionKey(fixture);
            const observedPaths: string[] = [];
            const client = browser(fixture, (path, response) => {
                observedPaths.push(path);
                if (path === '/v1/consent/withdraw') {
                    expect(localStorage.getItem(marker)).toBe('pending:1');
                    expect(isKindeAccountLocalFitnessClear(owner, 1)).toBe(false);
                }
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).resolves.toEqual({ kind: 'withdrawal-recorded', deletionStatus: 'pending' });
            expect(observedPaths.filter(path => path === '/v1/consent/withdraw')).toHaveLength(1);
            expect(localStorage.getItem(marker)).toBe('withdrawn');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            const suspended = await readKindeCandidateAccess(client);
            expect(suspended).toMatchObject({ kind: 'consent-suspended', status: 'withdrawn' });
            expect((await fixture.call(uid, '/v1/cloud-key/sync')).response.status).not.toBe(200);

            let borrowed: Uint8Array | undefined;
            const used = await withKindeCandidateRightsKey({
                ...client, expected,
                consumeKey: async (adk, current) => {
                    expect(current()).toBe(true);
                    borrowed = adk;
                    return adk.slice();
                },
            });
            expect(used).toEqual(key);
            expect(borrowed).toEqual(new Uint8Array(32));
            expect(localStorage.getItem(marker)).toBe('withdrawn');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('keeps the durable fence and never automatically replays a POST after a lost response', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            await provisionKey(fixture);
            let withdrawCalls = 0;
            const client = browser(fixture, (path, response) => {
                if (path === '/v1/consent/withdraw') {
                    withdrawCalls += 1;
                    expect(response.status).toBe(200);
                    throw new TypeError('HTTP reply lost after D1 commit');
                }
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(localStorage.getItem(marker)).toBe('pending:1');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(withdrawCalls).toBe(1);
            await expect(withKindeCandidateRightsKey({
                ...client, expected, consumeKey: async key => key.slice(),
            })).resolves.toHaveLength(32);
            expect(localStorage.getItem(marker)).toBe('pending:1');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });


    it('reconciles a lost withdrawal reply from the trusted primary without another destructive POST', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            await provisionKey(fixture);
            let withdrawCalls = 0;
            const sent: string[] = [];
            const client = browser(fixture, (path, response) => {
                sent.push(path);
                if (path === '/v1/consent/withdraw') {
                    withdrawCalls += 1;
                    throw new TypeError('Reply lost after server committed withdrawal');
                }
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(localStorage.getItem(marker)).toBe('pending:1');
            const afterInitial = sent.length;
            await expect(reconcileKindeCandidateWithdrawal({ ...client, expected }))
                .resolves.toEqual({ kind: 'withdrawal-proven' });
            expect(sent.slice(afterInitial)).not.toContain('/v1/consent/withdraw');
            expect(localStorage.getItem(marker)).toBe('withdrawn');
            expect(isKindeAccountLocalFitnessClear(owner, 1)).toBe(false);
            await expect(reconcileKindeCandidateWithdrawal({ ...client, expected }))
                .resolves.toEqual({ kind: 'withdrawal-proven' });
            expect(withdrawCalls).toBe(1);
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            expect((await fixture.call(uid, '/v1/cloud-key/sync')).response.status).not.toBe(200);
        } finally {
            fixture.close();
        }
    });

    it('does not clear a pending user decision when the primary still reports active', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let attempts = 0;
            const send: typeof fetch = async (input, init) => {
                if (String(input) === '/v1/consent/withdraw') {
                    attempts += 1;
                    throw new TypeError('Offline before request reached Worker');
                }
                return client.send(input, init);
            };
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, send, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(localStorage.getItem(marker)).toBe('pending:1');
            expect(fixture.count('health_erasure_jobs', uid)).toBe(0);
            await expect(reconcileKindeCandidateWithdrawal({ ...client, send, expected }))
                .resolves.toEqual({ kind: 'still-unconfirmed' });
            expect(localStorage.getItem(marker)).toBe('pending:1');
            expect(isKindeAccountLocalFitnessClear(owner, 1)).toBe(false);
            expect(attempts).toBe(1);
            expect(fixture.count('health_erasure_jobs', uid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('refuses missing, malformed and cross-owner pending markers before network access', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const observed: string[] = [];
            const client = browser(fixture, (path, response) => {
                observed.push(path); return response;
            });
            for (const value of [null, 'pending:2', 'unexpected']) {
                if (value === null) localStorage.removeItem(marker);
                else localStorage.setItem(marker, value);
                await expect(reconcileKindeCandidateWithdrawal({ ...client, expected }))
                    .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            }
            expect(observed).toEqual([]);
            localStorage.setItem(marker, 'pending:1');
            localStorage.setItem('logbook_is_guest', 'true');
            await expect(reconcileKindeCandidateWithdrawal({ ...client, expected }))
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            localStorage.removeItem('logbook_is_guest');
            await expect(reconcileKindeCandidateWithdrawal({
                ...client, expected: { ...expected, uid: 'k_' + 'B'.repeat(43) },
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(observed).toEqual([]);
            expect(localStorage.getItem(marker)).toBe('pending:1');
        } finally {
            fixture.close();
        }
    });
});
