import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde rights and withdrawal must not import Firebase');
});

import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { KindeCandidateBoundaryError, readKindeCandidateAccess } from '../../../src/lib/auth/kindeCandidateClient';
import { reconcileKindeCandidateWithdrawal, withdrawKindeCandidateHealthConsent } from '../../../src/lib/auth/kindeCandidateWithdrawal';
import { withKindeCandidateRightsKey } from '../../../src/lib/auth/kindeCandidateRightsKey';
import { uid, expected, marker, browser, provisionKey } from './kindeWithdrawalRightsFixture';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Kinde withdrawal failure handling and rights-only access against first-party Workers and D1 SQL', () => {
    it('rejects a replaced session or failed marker write without clearing the denial', async () => {
        for (const mode of ['session', 'storage'] as const) {
            localStorage.clear();
            const fixture = await createCloudKeyHttpFixture([uid]);
            try {
                await fixture.consent(uid);
                await fixture.withdraw(uid);
                localStorage.setItem(marker, 'pending:1');
                let client: ReturnType<typeof browser>;
                client = browser(fixture, (path, response) => {
                    if (mode === 'session' && path === '/v1/consent/status') {
                        client.replaceCookie('__Host-logbook_csrf=' + 'B'.repeat(43));
                    }
                    return response;
                });
                if (mode === 'storage') {
                    const original = localStorage.setItem.bind(localStorage);
                    const failedWrite = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
                        if (key === marker && value === 'withdrawn') throw new Error('Storage unavailable');
                        return original(key, value);
                    });
                    await expect(reconcileKindeCandidateWithdrawal({ ...client, expected }))
                        .rejects.toThrow();
                    failedWrite.mockRestore();
                } else {
                    await expect(reconcileKindeCandidateWithdrawal({ ...client, expected }))
                        .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
                }
                expect(localStorage.getItem(marker)).toBe('pending:1');
                expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            } finally {
                fixture.close();
            }
        }
    });

    it('rejects malformed response and changed CSRF while retaining the pending decision', async () => {
        for (const mode of ['malformed', 'rotated'] as const) {
            localStorage.clear();
            const fixture = await createCloudKeyHttpFixture([uid]);
            try {
                await fixture.consent(uid);
                let client: ReturnType<typeof browser>;
                client = browser(fixture, (path, response) => {
                    if (path !== '/v1/consent/withdraw') return response;
                    if (mode === 'rotated') {
                        client.replaceCookie('__Host-logbook_csrf=' + 'B'.repeat(43));
                        return response;
                    }
                    return Response.json({ status: 'withdrawn', deletionStatus: 'complete' },
                        { headers: { 'Cache-Control': 'no-store' } });
                });
                await expect(withdrawKindeCandidateHealthConsent({
                    ...client, expected, confirmsErasure: true,
                })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
                expect(localStorage.getItem(marker)).toBe('pending:1');
                expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            } finally {
                fixture.close();
            }
        }
    });

    it('does not request withdrawal without explicit decision, with guest data, or if local fence storage fails', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const sent: string[] = [];
            const client = browser(fixture, (path, response) => {
                sent.push(path);
                return response;
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: false,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(sent).toHaveLength(0);
            localStorage.setItem('logbook_is_guest', 'true');
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(sent).toHaveLength(0);
            localStorage.removeItem('logbook_is_guest');

            const original = localStorage.setItem.bind(localStorage);
            const rejectWrite = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
                if (key === marker) throw new Error('localStorage quota exceeded');
                return original(key, value);
            });
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).rejects.toThrow();
            expect(sent).not.toContain('/v1/consent/withdraw');
            rejectWrite.mockRestore();
            expect(fixture.count('health_erasure_jobs', uid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('keeps revocation and rights open when the browser sees unverified email, without fitness access', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const originalKey = await provisionKey(fixture);
            // The canonical D1 schema forbids regressing a verified
            // principal. Model a stale/unverified browser identity response
            // without mutating the server's verified-account history.
            const client = browser(fixture, async (path, response) => {
                if (path !== '/api/auth/session') return response;
                const identity = await response.json() as Record<string, unknown>;
                return Response.json({ ...identity, emailVerified: false }, {
                    status: response.status, headers: { 'Cache-Control': 'no-store' },
                });
            });
            await expect(readKindeCandidateAccess(client)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            await expect(withdrawKindeCandidateHealthConsent({
                ...client, expected, confirmsErasure: true,
            })).resolves.toEqual({ kind: 'withdrawal-recorded', deletionStatus: 'pending' });
            expect(localStorage.getItem(marker)).toBe('withdrawn');
            const key = await withKindeCandidateRightsKey({
                ...client, expected, consumeKey: async adk => adk.slice(),
            });
            expect(key).toEqual(originalKey);
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            expect((await fixture.call(uid, '/v1/cloud-key/sync')).response.status).not.toBe(200);
        } finally {
            fixture.close();
        }
    });

    it('rights-only cannot provision a new ADK after withdrawal or grant rights while consent is active', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const client = browser(fixture);
            let keyCalls = 0;
            await expect(withKindeCandidateRightsKey({
                ...client, expected, consumeKey: async () => { keyCalls += 1; },
            })).rejects.toThrow();
            expect(keyCalls).toBe(0);
            await fixture.withdraw(uid);
            await expect(withKindeCandidateRightsKey({
                ...client, expected, consumeKey: async () => { keyCalls += 1; },
            })).rejects.toThrow();
            expect(keyCalls).toBe(0);
            expect(fixture.count('cloud_account_keys', uid)).toBe(0);
        } finally {
            fixture.close();
        }
    });

    it('zeroes a borrowed rights key after an async session replacement', async () => {
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            await provisionKey(fixture);
            await fixture.withdraw(uid);
            const client = browser(fixture);
            let borrowed: Uint8Array | undefined;
            await expect(withKindeCandidateRightsKey({
                ...client, expected, consumeKey: async key => {
                    borrowed = key;
                    client.replaceCookie('__Host-logbook_csrf=' + 'B'.repeat(43));
                },
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(borrowed).toEqual(new Uint8Array(32));
        } finally {
            fixture.close();
        }
    });
});
