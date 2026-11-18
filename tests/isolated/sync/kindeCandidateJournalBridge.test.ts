import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { acquireCloudflareAccountKeyCandidate } from '../../../src/lib/sync/cloudflareAccountKeyCandidate';
import { deliverCloudflareJournalCandidate } from '../../../src/lib/sync/cloudflareJournalCandidate';
import type { LocalEnvelope } from '../../../src/lib/sync/localRepository';

vi.mock('../../../src/lib/sync/localArchiveBootstrap', () => ({ readLocal: vi.fn() }));
vi.mock('../../../src/lib/sync/cloudflareAccountKeyCandidate',
    () => ({ acquireCloudflareAccountKeyCandidate: vi.fn() }));
vi.mock('../../../src/lib/sync/cloudflareJournalCandidate',
    () => ({ deliverCloudflareJournalCandidate: vi.fn() }));

const UID = 'k_' + 'A'.repeat(43);
const OTHER = 'k_' + 'B'.repeat(43);
const CSRF_A = 'A'.repeat(43);
const CSRF_B = 'B'.repeat(42) + 'A';
const principal = (uid = UID) => ({
    authenticated: true, uid, emailVerified: true, fenceEpoch: 1, healthConsentRevision: 1,
});
const accepted = (uid = UID) => ({
    uid, status: 'active', revision: 1, fenceEpoch: 1,
    acceptedAt: '2026-11-15T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
});
const reply = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
function responses(...data: Response[]): typeof fetch {
    return vi.fn(async () => {
        const result = data.shift();
        if (!result) throw new Error('Unexpected HTTP request');
        return result;
    }) as typeof fetch;
}
function acceptedSession(uid = UID): typeof fetch {
    return responses(reply(principal(uid)), reply(accepted(uid)), reply(principal(uid)));
}
function mockLocal(pending: unknown[] = [], extra: Record<string, unknown> = {}): void {
    vi.mocked(readLocal).mockResolvedValue({
        pending, consentRevision: 1, ...extra,
    } as unknown as LocalEnvelope);
}
function cookie(value = CSRF_A) { return '__Host-logbook_csrf=' + value; }

beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('Kinde candidate trusted D1 journal bridge (no Firebase or production bindings)', () => {
    it('does not request a cloud key or ACK if there is no durable local journal', async () => {
        mockLocal();
        const send = vi.fn(acceptedSession());
        const result = await deliverKindeCandidateJournal({
            send: send as typeof fetch, stillCurrent: () => true, browserCookies: () => cookie(),
        });
        expect(result).toBe('idle');
        expect(send).toHaveBeenCalledTimes(3);
        expect(vi.mocked(readLocal)).toHaveBeenCalledWith('user:' + UID);
        expect(acquireCloudflareAccountKeyCandidate).not.toHaveBeenCalled();
        expect(deliverCloudflareJournalCandidate).not.toHaveBeenCalled();
    });

    it('pins trusted UID, consent, CSRF and erases the temporary key after confirmed delivery', async () => {
        mockLocal([{ seq: 1 }]);
        const key = new Uint8Array(32).fill(41);
        vi.mocked(acquireCloudflareAccountKeyCandidate).mockResolvedValue(key);
        vi.mocked(deliverCloudflareJournalCandidate).mockImplementation(async (owner, adk, transport, csrf, guard, expected) => {
            expect(owner).toBe('user:' + UID);
            expect(adk).toBe(key);
            expect(typeof transport.control).toBe('function');
            expect(csrf).toBe(CSRF_A);
            expect(guard()).toBe(true);
            expect(expected).toEqual({ consentRevision: 1, fenceEpoch: 1 });
            return 'acknowledged';
        });
        const send = vi.fn(acceptedSession());
        await expect(deliverKindeCandidateJournal({
            send: send as typeof fetch, stillCurrent: () => true, browserCookies: () => cookie(),
        })).resolves.toBe('acknowledged');
        expect(vi.mocked(acquireCloudflareAccountKeyCandidate)).toHaveBeenCalledWith({
            expected: { uid: UID, consentRevision: 1, fenceEpoch: 1 },
            purpose: 'sync', stillCurrent: expect.any(Function),
            csrfToken: expect.any(Function), send: send as typeof fetch,
        });
        expect(key.every(byte => byte === 0)).toBe(true);
    });

    it('rejects signed-out, unverified and suspended consent before reading any owner archive', async () => {
        for (const send of [
            responses(reply({ error: 'unauthorized' }, 401)),
            responses(reply(principal()), reply({ ...accepted(), status: 'withdrawn' }), reply(principal())),
            responses(reply({ ...principal(), emailVerified: false })),
            responses(reply(principal()), reply(accepted(OTHER)), reply(principal())),
        ]) {
            await expect(deliverKindeCandidateJournal({
                send, stillCurrent: () => true, browserCookies: () => cookie(),
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        expect(readLocal).not.toHaveBeenCalled();
        expect(acquireCloudflareAccountKeyCandidate).not.toHaveBeenCalled();
    });

    it('rejects pending account withdrawal before decrypting the owner journal', async () => {
        mockLocal([{ seq: 1 }]);
        localStorage.setItem(`logbook:v2:user:${UID}:health-consent-withdrawal`, 'pending:1');
        await expect(deliverKindeCandidateJournal({
            send: acceptedSession(), stillCurrent: () => true, browserCookies: () => cookie(),
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(readLocal).not.toHaveBeenCalled();
        expect(acquireCloudflareAccountKeyCandidate).not.toHaveBeenCalled();
    });
    it('keeps a different consent generation in recovery before requesting any cloud key', async () => {
        mockLocal([{ seq: 1 }], { consentRevision: 2 });
        await expect(deliverKindeCandidateJournal({
            send: acceptedSession(), stillCurrent: () => true, browserCookies: () => cookie(),
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(acquireCloudflareAccountKeyCandidate).not.toHaveBeenCalled();
        expect(deliverCloudflareJournalCandidate).not.toHaveBeenCalled();
    });

    it('refuses an active or malformed guest ownership flag before network access', async () => {
        for (const guestFlag of ['true', 'malformed']) {
            localStorage.setItem('logbook_is_guest', guestFlag);
            const send = vi.fn(acceptedSession());
            await expect(deliverKindeCandidateJournal({
                send: send as typeof fetch, stillCurrent: () => true, browserCookies: () => cookie(),
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
    });

    it('does not acquire ADK when consent or tab changed during the owner archive read', async () => {
        vi.mocked(readLocal).mockImplementation(async () => {
            localStorage.setItem('logbook_is_guest', 'true');
            return { pending: [{ seq: 1 }] } as unknown as LocalEnvelope;
        });
        await expect(deliverKindeCandidateJournal({
            send: acceptedSession(), stillCurrent: () => true, browserCookies: () => cookie(),
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(acquireCloudflareAccountKeyCandidate).not.toHaveBeenCalled();
    });

    it('rejects same-owner re-login and A→B→A via CSRF change, wipes ADK and cannot ACK', async () => {
        for (const nextCookie of [CSRF_B, '']) {
            mockLocal([{ seq: 1 }]);
            let currentCookie = cookie();
            const key = new Uint8Array(32).fill(63);
            vi.mocked(acquireCloudflareAccountKeyCandidate).mockImplementation(async () => {
                currentCookie = nextCookie ? cookie(nextCookie) : '';
                return key;
            });
            const sent = acceptedSession();
            await expect(deliverKindeCandidateJournal({
                send: sent, stillCurrent: () => true, browserCookies: () => currentCookie,
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(deliverCloudflareJournalCandidate).not.toHaveBeenCalled();
            expect(key.every(byte => byte === 0)).toBe(true);
        }
    });

    it('preserves the interrupted operation and zeroes the key on ambiguous remote commit', async () => {
        mockLocal([{ seq: 1 }]);
        const key = new Uint8Array(32).fill(64);
        vi.mocked(acquireCloudflareAccountKeyCandidate).mockResolvedValue(key);
        vi.mocked(deliverCloudflareJournalCandidate).mockImplementation(async () => {
            throw new Error('Lost ACK: unconfirmed remote commit');
        });
        await expect(deliverKindeCandidateJournal({
            send: acceptedSession(), stillCurrent: () => true, browserCookies: () => cookie(),
        })).rejects.toThrow('Lost ACK');
        expect(key.every(byte => byte === 0)).toBe(true);
        // The bridge itself never writes IndexedDB or sends a fabricated receipt.
    });

    it('does not deliver a fenced or retiring replica even with active consent', async () => {
        for (const fence of [
            { cloudIntegrityFence: { reason: 'synthetic' } },
            { cloudflareReplicaClaim: { mutationId: 'pending' } },
            { cloudflareReplicaRetirement: { mutationId: 'pending' } },
        ]) {
            mockLocal([{ seq: 1 }], fence);
            await expect(deliverKindeCandidateJournal({
                send: acceptedSession(), stillCurrent: () => true, browserCookies: () => cookie(),
            })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        expect(acquireCloudflareAccountKeyCandidate).not.toHaveBeenCalled();
    });
});
