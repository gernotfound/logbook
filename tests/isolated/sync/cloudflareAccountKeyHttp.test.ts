import { describe, expect, it, vi } from 'vitest';
import api from '../../../cloudflare/api/worker.mjs';
import { createCloudKeyHttpFixture, ORIGIN, renewSessionWithoutEmail } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { acquireCloudflareAccountKeyCandidate } from '../../../src/lib/sync/cloudflareAccountKeyCandidate';
import { CloudKeyAccessUnavailableError } from '../../../src/lib/sync/cloudAccountKeyMaterial';
import { CloudCiphertextError, openCloudDocument, sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';

vi.mock('../../../src/lib/firebase', () => { throw new Error('Workers key access must not initialize Firebase'); });

const A = 'k_' + 'a'.repeat(43);
const B = 'k_' + 'b'.repeat(43);
type Fixture = Awaited<ReturnType<typeof createCloudKeyHttpFixture>>;

function transport(f: Fixture, cookieOwner: string): typeof fetch {
    return async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('origin', ORIGIN);
        headers.set('cookie', f.sessions.get(cookieOwner)!.cookies);
        return api.fetch(new Request(new URL(String(input), ORIGIN), { ...init, headers }), f.env);
    };
}
function requestKey(f: Fixture, uid: string, purpose: 'sync' | 'rights-export' = 'sync', fenceEpoch = 1) {
    return acquireCloudflareAccountKeyCandidate({
        expected: { uid, consentRevision: 1, fenceEpoch }, purpose,
        stillCurrent: () => true, csrfToken: () => f.sessions.get(uid)!.csrf,
        send: transport(f, uid),
    });
}

describe('candidate browser → real Worker/AuthGate/SQLite key boundary', () => {
    it('uses the real wrapped winner across browser operations and authenticates owner-bound ciphertext', async () => {
        const f = await createCloudKeyHttpFixture([A, B]);
        const keys: Uint8Array[] = [];
        try {
            await f.consent(A); await f.consent(B);
            const [first, raced] = await Promise.all([requestKey(f, A), requestKey(f, A)]);
            keys.push(first, raced);
            expect(first).toEqual(raced);
            expect(first).not.toBe(raced);
            expect(f.count('cloud_account_keys', A)).toBe(1);
            expect(f.count('cloud_key_issuance', A)).toBe(1);
            const other = await requestKey(f, B); keys.push(other);
            expect(other).not.toEqual(first);
            const metadata = { protocolVersion: 3 as const, clock: { s00: 1 }, fields: {},
                writer: { slot: 's00' as const, replicaId: 'synthetic-browser-key-device',
                    generation: 1, seq: 1, consentRevision: 1 } };
            const business = { profile: { height: '177' } };
            const sealed = sealCloudDocument(first, A, '', business, metadata);
            expect(openCloudDocument(raced, A, '', sealed).business).toEqual(business);
            expect(() => openCloudDocument(other, A, '', sealed)).toThrow(CloudCiphertextError);
            expect(() => openCloudDocument(first, B, '', sealed)).toThrow(CloudCiphertextError);
            const stored = f.sqlite.prepare('SELECT ciphertext FROM cloud_account_keys WHERE uid=?').get(A)!;
            expect(stored.ciphertext).not.toBe(Buffer.from(first).toString('base64'));
            expect(f.count('sync_documents', A)).toBe(0);
        } finally { for (const key of keys) key.fill(0); f.close(); }
    });

    it('rejects a real B key returned inside an A→B→A attempt even if the caller only checks final UID', async () => {
        const f = await createCloudKeyHttpFixture([A, B]);
        try {
            await f.consent(A); await f.consent(B);
            await expect(acquireCloudflareAccountKeyCandidate({
                expected: { uid: A, consentRevision: 1, fenceEpoch: 1 }, purpose: 'sync',
                stillCurrent: () => true,
                csrfToken: () => f.sessions.get(B)!.csrf, send: transport(f, B),
            })).rejects.toMatchObject({ code: 'cloud-key-unavailable', retryable: false });
            expect(f.count('cloud_account_keys', A)).toBe(0);
            expect(f.count('cloud_account_keys', B)).toBe(1);
        } finally { f.close(); }
    });

    it('exports only the existing withdrawn key with a renewed unverified session and never provisions another', async () => {
        const f = await createCloudKeyHttpFixture([A, B]);
        let first: Uint8Array | undefined;
        let rights: Uint8Array | undefined;
        try {
            await f.consent(A); await f.consent(B);
            first = await requestKey(f, A);
            await f.withdraw(A); await f.withdraw(B);
            await renewSessionWithoutEmail(f, A);
            rights = await requestKey(f, A, 'rights-export', 2);
            expect(rights).toEqual(first);
            await expect(requestKey(f, A, 'rights-export', 1)).rejects.toMatchObject({ retryable: false });
            await expect(requestKey(f, A, 'sync', 2)).rejects.toMatchObject({ retryable: false });
            await expect(requestKey(f, B, 'rights-export')).rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
            expect(f.count('cloud_account_keys', B)).toBe(0);
            expect(f.count('cloud_key_issuance', B)).toBe(0);
            expect(f.count('cloud_key_issuance', A)).toBe(1);
        } finally { first?.fill(0); rights?.fill(0); f.close(); }
    });

    it('fails closed on quota/KEK errors and can recover the same winner without rekey', async () => {
        const f = await createCloudKeyHttpFixture([A, B]);
        let first: Uint8Array | undefined;
        let recovered: Uint8Array | undefined;
        try {
            await f.consent(A);
            first = await requestKey(f, A);
            const original = f.env.CLOUD_ACCOUNT_KEK_V1;
            f.env.CLOUD_ACCOUNT_KEK_V1 = Buffer.alloc(32, 99).toString('base64');
            await expect(requestKey(f, A)).rejects.toMatchObject({ code: 'cloud-key-unavailable', retryable: true });
            f.env.CLOUD_ACCOUNT_KEK_V1 = original;
            const limiter = f.gateEnv.API_RATE_LIMITER;
            f.gateEnv.API_RATE_LIMITER = { limit: async () => ({ success: false }) };
            await expect(requestKey(f, A)).rejects.toMatchObject({ code: 'cloud-key-unavailable', retryable: true });
            f.gateEnv.API_RATE_LIMITER = limiter;
            recovered = await requestKey(f, A);
            expect(recovered).toEqual(first);
            expect(f.count('cloud_key_issuance', A)).toBe(1);
        } finally { first?.fill(0); recovered?.fill(0); f.close(); }
    });

    it('recovers a lost HTTP reply from the same persisted key without issuing another ADK', async () => {
        const f = await createCloudKeyHttpFixture([A]);
        let recovered: Uint8Array | undefined;
        try {
            await f.consent(A);
            let committedKey: string | undefined;
            const actual = transport(f, A);
            const lost: typeof fetch = async (input, init) => {
                const response = await actual(input, init);
                committedKey = (await response.json() as { key: string }).key;
                throw new TypeError('synthetic reply lost after key commit');
            };
            await expect(acquireCloudflareAccountKeyCandidate({
                expected: { uid: A, consentRevision: 1, fenceEpoch: 1 }, purpose: 'sync',
                stillCurrent: () => true, csrfToken: () => f.sessions.get(A)!.csrf, send: lost,
            })).rejects.toMatchObject({ code: 'cloud-key-unavailable', retryable: true });
            expect(f.count('cloud_account_keys', A)).toBe(1);
            recovered = await requestKey(f, A);
            expect(Buffer.from(recovered).toString('base64')).toBe(committedKey);
            expect(f.count('cloud_key_issuance', A)).toBe(1);
        } finally { recovered?.fill(0); f.close(); }
    });
});
