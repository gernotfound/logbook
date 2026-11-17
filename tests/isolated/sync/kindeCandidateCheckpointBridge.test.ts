import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { inspectKindeCandidateCloudCheckpoint } from '../../../src/lib/sync/kindeCandidateCheckpointBridge';
import { CloudCiphertextError, sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde D1 checkpoint must not initialize the Firebase SDK');
});

const UID = 'k_' + 'A'.repeat(43);
const OTHER = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const key = new Uint8Array(32).fill(37);
const meta: SyncMeta = { protocolVersion: 3, clock: { s00: 1 }, fields: {},
    writer: { slot: 's00', replicaId: 'synthetic-device', generation: 1,
        seq: 1, consentRevision: 1 } };
const business = { profile: { notes: 'synthetic-only-private-value' } };
const session = (uid = UID) => ({ authenticated: true, emailVerified: true, uid,
    fenceEpoch: 1, healthConsentRevision: 1 });
const consent = (uid = UID) => ({ uid, status: 'active', revision: 1, fenceEpoch: 1,
    acceptedAt: '2026-11-16T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms });
const keyResponse = () => ({
    format: 'thelogbook-account-data-key', version: 1, uid: UID, fenceEpoch: 1,
    consentRevision: 1, purpose: 'sync', key: Buffer.from(key).toString('base64'),
});
const encrypted = (uid = UID) => sealCloudDocument(key, uid, '', business, meta);
const scan = (document: unknown = encrypted(), epoch = 1) => ({
    revision: 1, fenceEpoch: epoch, consentRevision: 1, complete: true,
    nextAfter: null, documents: [{ path: '', revision: 1, document }],
});
const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const authorized = (uid = UID) => [
    json(session(uid)), json(consent(uid)), json(session(uid)),
];
function responses(...replies: Response[]): typeof fetch {
    return vi.fn<typeof fetch>().mockImplementation(async () => {
        const result = replies.shift();
        if (!result) throw Error('Unexpected HTTP request');
        return result;
    });
}
function configured(snapshot: unknown = scan()): typeof fetch {
    return responses(...authorized(), json(keyResponse()), json(snapshot), ...authorized());
}
const browser = () => '__Host-logbook_csrf=' + CSRF;
const inspect = (send: typeof fetch, cookies = browser, current = () => true) =>
    inspectKindeCandidateCloudCheckpoint({ send, browserCookies: cookies, stillCurrent: current });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('Kinde and encrypted D1 complete checkpoint observation', () => {
    it('opens only owner-scoped authenticated ciphertext after Kinde consent, then rechecks session', async () => {
        const send = configured();
        const observation = await inspect(send);
        expect(observation.kind).toBe('checkpoint-observed');
        expect(observation.principal).toEqual({
            uid: UID, fenceEpoch: 1, healthConsentRevision: 1,
        });
        expect(observation.checkpoint).toMatchObject({
            revision: 1, fenceEpoch: 1, consentRevision: 1,
        });
        expect(observation.checkpoint.documents.get('')?.business).toEqual(business);
        expect(vi.mocked(send).mock.calls.map(call => call[0])).toEqual([
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/v1/cloud-key/sync', '/v1/sync/scan',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
        ]);
        const keyRequest = vi.mocked(send).mock.calls[3][1];
        expect(keyRequest).toMatchObject({ method: 'POST', credentials: 'same-origin',
            mode: 'same-origin', cache: 'no-store', redirect: 'error' });
        expect(new Headers(keyRequest?.headers).get('x-csrf-token')).toBe(CSRF);
        const scanRequest = vi.mocked(send).mock.calls[4][1];
        expect(scanRequest).toMatchObject({ method: 'POST', credentials: 'include',
            mode: 'same-origin', cache: 'no-store', redirect: 'error' });
        expect(localStorage.length).toBe(0);
    });

    it('reports a genuinely empty D1 checkpoint without creating local ownership or a journal', async () => {
        const send = configured({
            revision: 0, fenceEpoch: 1, consentRevision: 1,
            documents: [], nextAfter: null, complete: true,
        });
        const result = await inspect(send);
        expect(result.checkpoint.documents.size).toBe(0);
        expect(result.checkpoint.revision).toBe(0);
        expect(localStorage.length).toBe(0);
    });

    it('fails before HTTP on guest mode, broken/ambiguous CSRF or invalid caller generation', async () => {
        for (const flag of ['true', 'corrupted']) {
            localStorage.setItem('logbook_is_guest', flag);
            const send = configured();
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
        localStorage.clear();
        for (const value of ['', '__Host-logbook_csrf=invalid', browser() + '; ' + browser()]) {
            const send = configured();
            await expect(inspect(send, () => value)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
        }
        const send = configured();
        await expect(inspect(send, browser, () => false))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
    });

    it('never fetches a cloud key or scan without trusted identity and active account consent', async () => {
        for (const send of [
            responses(json({ error: 'unauthorized' }, 401)),
            responses(json({ ...session(), emailVerified: false })),
            responses(json(session()), json({ uid: UID, status: 'withdrawn',
                revision: 1, fenceEpoch: 1 }), json(session())),
            responses(json(session()), json(consent(OTHER)), json(session())),
            responses(json(session()), json(consent()), json(session(OTHER))),
        ]) {
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(vi.mocked(send).mock.calls.some(call =>
                call[0] === '/v1/cloud-key/sync' || call[0] === '/v1/sync/scan')).toBe(false);
        }
    });

    it('denies a changed session CSRF during the scan, never performing the final read', async () => {
        let value = browser();
        const source = configured();
        const send = vi.fn<typeof fetch>().mockImplementation(async (...args) => {
            const response = await source(...args);
            if (args[0] === '/v1/sync/scan') value = '__Host-logbook_csrf=' + 'B'.repeat(43);
            return response;
        });
        await expect(inspect(send, () => value)).rejects.toBeInstanceOf(CloudCiphertextError);
        expect(send.mock.calls.filter(call => call[0] === '/api/auth/session')).toHaveLength(2);
    });

    it('rejects a wrong D1 fence or consent revision even when the ciphertext decrypts', async () => {
        const wrongFence = configured(scan(undefined, 2));
        await expect(inspect(wrongFence)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        const wrongConsent = configured({ ...scan(), consentRevision: 2 });
        await expect(inspect(wrongConsent)).rejects.toBeInstanceOf(CloudCiphertextError);
    });

    it('never exposes forged ciphertext or another account encrypted using the same key', async () => {
        for (const document of [encrypted(OTHER), { _sealed: { ciphertext: 'forged' } }]) {
            const send = configured(scan(document));
            await expect(inspect(send)).rejects.toBeInstanceOf(CloudCiphertextError);
            expect(vi.mocked(send).mock.calls.filter(call => call[0] === '/api/auth/session'))
                .toHaveLength(2);
        }
    });

    it('discards decrypted observations after a final session switch or consent withdrawal', async () => {
        const changedSessions = [
            [json(session(OTHER)), json(consent(OTHER)), json(session(OTHER))],
            [json(session()), json({ uid: UID, status: 'withdrawn',
                revision: 1, fenceEpoch: 1 }), json(session())],
            [json(session()), json(consent()), json({ ...session(), fenceEpoch: 2 })],
        ];
        for (const tail of changedSessions) {
            const send = responses(...authorized(), json(keyResponse()), json(scan()), ...tail);
            await expect(inspect(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(vi.mocked(send).mock.calls.filter(call => call[0] === '/v1/sync/scan')).toHaveLength(1);
        }
    });

    it('does not substitute an empty checkpoint for failed scan or unavailable cloud ADK', async () => {
        const invalidScan = configured({ ...scan(), complete: false, nextAfter: null });
        await expect(inspect(invalidScan)).rejects.toThrow();
        const noKey = responses(...authorized(), json({ error: 'unavailable' }, 503));
        await expect(inspect(noKey)).rejects.toThrow();
        expect(vi.mocked(noKey).mock.calls.some(call => call[0] === '/v1/sync/scan')).toBe(false);
    });
});
