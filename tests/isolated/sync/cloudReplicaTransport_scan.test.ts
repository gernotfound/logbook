import { describe, expect, it, vi } from 'vitest';
import { CloudReplicaTransportError, createCloudflareReplicaTransport, createCloudflareRightsScanTransport } from '../../../src/lib/sync/cloudReplicaTransport';
import { readAuthenticatedCloudflareCheckpoint } from '../../../src/lib/sync/cloudReplicaCheckpoint';
import { CloudCiphertextError, sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

describe('Cloudflare transport: paginated and rights-only AEAD checkpoint', () => {
    it('loads every monthly page and does not treat a page as a complete account', async () => {
        const paths = ['', ...Array.from({ length: 8 }, (_, i) =>
            `history_months/2026-${String(i + 1).padStart(2, '0')}`)];
        const document = { _sealed: { ciphertext: 'unverified, never hydrated by transport alone' } };
        const pages = [
            { revision: 2, fenceEpoch: 5, consentRevision: 1, complete: false, nextAfter: paths[7],
                documents: paths.slice(0, 8).map(path => ({ path, revision: 2, document })) },
            { revision: 2, fenceEpoch: 5, consentRevision: 1, complete: true, nextAfter: null,
                documents: paths.slice(8).map(path => ({ path, revision: 2, document })) },
        ];
        let index = 0;
        const fetcher = vi.fn(async () => new Response(JSON.stringify(pages[index++])));
        const remote = createCloudflareReplicaTransport(fetcher as typeof fetch);
        const result = await remote.scanAll();
        expect(result).toEqual({ revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: pages.flatMap(page => page.documents) });
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({ after: null, expectedRevision: null });
        expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({ after: paths[7], expectedRevision: 2 });
    });


    it('rights-only transport validates all pages without ever calling a fitness endpoint', async () => {
        const paths = ['', ...Array.from({ length: 8 }, (_, i) =>
            `nutrition_months/2026-${String(i + 1).padStart(2, '0')}`)];
        const page = (selected: string[], complete: boolean) => ({
            revision: 2, fenceEpoch: 1, consentRevision: 1, complete,
            nextAfter: complete ? null : selected.at(-1),
            documents: selected.map(path => ({ path, revision: 2, document: { _sealed: {} } })),
        });
        const pages = [page(paths.slice(0, 8), false), page(paths.slice(8), true)];
        let index = 0;
        const fetcher = vi.fn(async () => Response.json(pages[index++], {
            headers: { 'Cache-Control': 'no-store' },
        }));
        const rights = createCloudflareRightsScanTransport(fetcher as typeof fetch);
        await expect(rights.scanAll('test-csrf')).resolves.toEqual({
            revision: 2, fenceEpoch: 1, consentRevision: 1,
            documents: pages.flatMap(p => p.documents),
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
        for (const [url, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
            expect(url).toBe('/v1/rights/scan');
            expect(init).toMatchObject({
                method: 'POST', credentials: 'include', mode: 'same-origin',
                cache: 'no-store', redirect: 'error',
            });
            expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('test-csrf');
        }
        expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string))
            .toEqual({ after: paths[7], expectedRevision: 2 });
    });

    it('rights-only scan fails closed on missing CSRF, stale page, unsafe cache and oversized response', async () => {
        const valid = { revision: 1, fenceEpoch: 1, consentRevision: 1,
            complete: true, nextAfter: null, documents: [] };
        const send = vi.fn(async () => Response.json(valid, {
            headers: { 'Cache-Control': 'no-store' },
        }));
        await expect(createCloudflareRightsScanTransport(send as typeof fetch).scanAll(''))
            .rejects.toBeInstanceOf(CloudReplicaTransportError);
        expect(send).not.toHaveBeenCalled();
        for (const response of [
            Response.json(valid),
            new Response('external', { status: 200, headers: { 'Cache-Control': 'no-store' } }),
            Response.json({ ...valid, complete: false, nextAfter: '', documents: [] },
                { headers: { 'Cache-Control': 'no-store' } }),
            new Response('{}', { headers: {
                'Content-Type': 'application/json', 'Cache-Control': 'no-store',
                'Content-Length': String(8 * 950_000 + 16_385),
            } }),
        ]) {
            const transport = createCloudflareRightsScanTransport(
                vi.fn(async () => response) as typeof fetch,
            );
            await expect(transport.scanAll('test-csrf'))
                .rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
    });

    it('rejects incomplete, stale, non-monotone and malformed paginated snapshots', async () => {
        const paths = ['', ...Array.from({ length: 7 }, (_, i) =>
            `nutrition_months/2026-${String(i + 1).padStart(2, '0')}`)];
        const first = { revision: 2, fenceEpoch: 5, consentRevision: 1, complete: false,
            nextAfter: paths[7], documents: paths.map(path => ({
                path, revision: 2, document: { _sealed: {} },
            })) };
        for (const bad of [
            { ...first, revision: 3, complete: true, nextAfter: null, documents: [] },
            { ...first, fenceEpoch: 6, complete: true, nextAfter: null, documents: [] },
            { ...first, consentRevision: 2, complete: true, nextAfter: null, documents: [] },
            { ...first, complete: true, nextAfter: null,
                documents: [{ path: paths[7], revision: 2, document: {} }] },
            { ...first, complete: false, nextAfter: paths[7], documents: [] },
        ]) {
            let calls = 0;
            const transport = createCloudflareReplicaTransport(vi.fn(async () =>
                new Response(JSON.stringify(calls++ === 0 ? first : bad))) as typeof fetch);
            await expect(transport.scanAll()).rejects.toBeInstanceOf(CloudReplicaTransportError);
        }
        let calls = 0;
        const conflict = createCloudflareReplicaTransport(vi.fn(async () =>
            calls++ === 0 ? new Response(JSON.stringify(first))
                : new Response(JSON.stringify({ error: 'snapshot-changed' }), { status: 409 })) as typeof fetch);
        await expect(conflict.scanAll()).rejects.toMatchObject({ status: 409 });
    });

    it('opens every document with ADK/UID/path before publishing a checkpoint', async () => {
        const key = crypto.getRandomValues(new Uint8Array(32));
        const metadata: SyncMeta = { protocolVersion: 3, clock: { s00: 1 },
            fields: {}, writer: { slot: 's00', replicaId: 'device-synthetic', generation: 1,
                seq: 1, consentRevision: 1 } };
        const business = { profile: { notes: 'synthetic-health-only' } };
        const ciphertext = sealCloudDocument(key, 'synthetic-account', '', business, metadata);
        const scan = async () => ({ revision: 1, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 1, document: ciphertext }] });
        await expect(readAuthenticatedCloudflareCheckpoint(scan, 'synthetic-account', key, 2, () => true))
            .rejects.toBeInstanceOf(CloudCiphertextError);
        const verified = await readAuthenticatedCloudflareCheckpoint(
            scan, 'synthetic-account', key, 1, () => true,
        );
        expect(verified.documents.get('')?.business).toEqual(business);
        await expect(readAuthenticatedCloudflareCheckpoint(scan, 'different-account', key, 1, () => true))
            .rejects.toBeInstanceOf(CloudCiphertextError);
        await expect(readAuthenticatedCloudflareCheckpoint(async () => ({ revision: 1, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: '', revision: 1, document: { ...ciphertext,
                _sync: { ...ciphertext._sync, clock: { s00: 2 } } } }] }),
        'synthetic-account', key, 1, () => true)).rejects.toBeInstanceOf(CloudCiphertextError);
        let current = true;
        await expect(readAuthenticatedCloudflareCheckpoint(async () => {
            current = false;
            return scan();
        }, 'synthetic-account', key, 1, () => current)).rejects.toBeInstanceOf(CloudCiphertextError);
    });
});
