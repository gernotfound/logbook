import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import type { CachedGlobalCatalog, UserData } from '../../../src/types';
import { UserDataSchema } from '../../../src/lib/schema';
import { deliverCloudflareJournalCandidate } from '../../../src/lib/sync/cloudflareJournalCandidate';
import {
    createCloudflareReplicaTransport, type CloudReplicaBatch,
} from '../../../src/lib/sync/cloudReplicaTransport';
import { readAccountCloudDocument } from '../../../src/lib/sync/cloudDocumentRead';
import {
    adoptReplicaCheckpoint, commitDomainOperations, initializeLocal, readLocal,
} from '../../../src/lib/sync/localRepository';
import type { ReplicaIdentity } from '../../../src/lib/sync/replicaProtocol';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

const owner = 'user:cf04-domain-roundtrip';
const uid = owner.slice('user:'.length);
const storageKey = 'logbook:v2:' + owner;
const csrfToken = 'synthetic-session-bound-csrf';
const adk = new Uint8Array(32).fill(37);
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'cf04-domain-roundtrip', updatedAt: '2026-11-14T00:00:00.000Z',
        schemaVersion: 1, docRefs: { exercises: 'fixture/exercises', foods: 'fixture/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const profile = (height: number) =>
    UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;

function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') {
        const fields = value as Record<string, unknown>;
        return '{' + Object.keys(fields).sort()
            .map(key => JSON.stringify(key) + ':' + canonical(fields[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

function requestHash(batch: CloudReplicaBatch): string {
    return createHash('sha256').update(canonical(batch)).digest('hex');
}

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status, headers: { 'Content-Type': 'application/json' },
    });
}

type CommitFault = 'none' | 'timeout-before-commit' | 'lost-response' | 'conflict';
type ReceiptFault = 'none' | 'hidden' | 'forged-hash';

function syntheticHttpReplica(identity: ReplicaIdentity) {
    const state: {
        revision: number;
        fenceEpoch: number;
        consentRevision: number;
        commitFault: CommitFault;
        receiptFault: ReceiptFault;
        committed: CloudReplicaBatch | null;
        afterRead?: () => void;
        afterCommit?: () => Promise<void> | void;
    } = {
        revision: 0, fenceEpoch: 5, consentRevision: 1,
        commitFault: 'none', receiptFault: 'none', committed: null,
    };
    const requests: string[] = [];
    const sentBatches: CloudReplicaBatch[] = [];

    const send = vi.fn(async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const path = String(resource);
        if (!path.startsWith('/v1/sync/')) throw new Error('Unexpected destination: ' + path);
        expect(init).toMatchObject({
            method: 'POST', mode: 'same-origin', credentials: 'include',
            cache: 'no-store', redirect: 'error',
        });
        const route = path.slice('/v1/sync/'.length);
        requests.push(route);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

        if (route === 'control') {
            const committed = state.committed;
            return json({
                uid, revision: state.revision, fenceEpoch: state.fenceEpoch,
                consentRevision: state.consentRevision,
                replicas: {
                    [identity.slot]: {
                        ...identity, lastSeq: committed?.lastSeq ?? 0, status: 'active',
                        checkpointClock: {},
                    },
                },
            });
        }
        if (route === 'read') {
            const paths = body.paths as string[];
            expect(Array.isArray(paths)).toBe(true);
            const response = json({
                revision: state.revision, fenceEpoch: state.fenceEpoch,
                consentRevision: state.consentRevision,
                documents: paths.map(path => {
                    const item = state.committed?.documents.find(document => document.path === path);
                    return { path, revision: item ? state.revision : null,
                        document: item?.document ?? null };
                }),
            });
            state.afterRead?.();
            return response;
        }
        if (route === 'receipt') {
            expect(typeof body.batchId).toBe('string');
            const committed = state.committed;
            if (!committed || committed.batchId !== body.batchId
                || state.receiptFault === 'hidden') return json({ receipt: null });
            return json({ receipt: {
                requestHash: state.receiptFault === 'forged-hash'
                    ? '0'.repeat(64) : requestHash(committed),
                revision: committed.expectedRevision + 1,
                lastSeq: committed.lastSeq, consentRevision: committed.consentRevision,
                replica: committed.replica,
            } });
        }
        if (route === 'commit') {
            expect(init?.headers).toEqual(expect.objectContaining({
                'X-CSRF-Token': csrfToken,
            }));
            const batch = body as unknown as CloudReplicaBatch;
            const durable = await readLocal(owner);
            const raw = await get<unknown>(storageKey);
            // A read-only control/read preflight precedes staging; the first
            // mutating HTTP request must observe the immutable IDB intent.
            expect(raw).toMatch(/^tlb-sealed:v1:/);
            expect(raw).not.toContain('"height":"171"');
            if (!durable?.cloudflareDelivery) throw new Error('Commit HTTP senza intento IndexedDB');
            expect(durable.cloudflareDelivery.batch).toEqual(batch);
            expect(durable.cloudflareDelivery.operations).toEqual(
                durable.pending.slice(0, durable.cloudflareDelivery.operations.length),
            );
            expect(JSON.stringify(batch)).not.toContain('"height":"171"');
            sentBatches.push(structuredClone(batch));
            if (state.commitFault === 'conflict') return json({ error: 'stale-revision' }, 409);
            if (state.commitFault === 'timeout-before-commit') {
                throw new TypeError('Synthetic network timeout before SQL commit');
            }
            if (batch.expectedRevision !== state.revision
                || batch.expectedFenceEpoch !== state.fenceEpoch
                || batch.consentRevision !== state.consentRevision
                || batch.replica.slot !== identity.slot
                || batch.replica.replicaId !== identity.replicaId
                || batch.replica.generation !== identity.generation) {
                return json({ error: 'stale-revision-or-session' }, 409);
            }
            if (state.committed !== null) return json({ error: 'unexpected-second-commit' }, 409);
            state.committed = structuredClone(batch);
            state.revision += 1;
            await state.afterCommit?.();
            if (state.commitFault === 'lost-response') {
                throw new TypeError('Synthetic HTTP response lost after SQL commit');
            }
            return json({
                batchId: batch.batchId, revision: state.revision,
                lastSeq: batch.lastSeq, replayed: false,
            });
        }
        if (route === 'commit/status') {
            expect(init?.headers).toEqual(expect.objectContaining({
                'X-CSRF-Token': csrfToken,
            }));
            const committed = state.committed;
            const matching = committed !== null && committed.batchId === body.batchId
                && requestHash(committed) === body.requestHash;
            return json({
                outcome: matching ? 'committed'
                    : state.revision > Number(body.expectedRevision) ? 'not-committed' : 'inconclusive',
                currentRevision: state.revision,
            });
        }
        throw new Error('Unexpected /v1/sync route: ' + route);
    });
    return {
        state, requests, sentBatches, send,
        transport: createCloudflareReplicaTransport(send as typeof fetch),
    };
}

async function prepareAccount(): Promise<ReplicaIdentity> {
    await initializeLocal(owner, profile(170));
    const now = Date.now();
    const identity: ReplicaIdentity = {
        slot: 's00', replicaId: 'cf04-domain-device', generation: 1,
        checkpointAtMs: now, leaseUntilMs: now + 86400000,
    };
    await adoptReplicaCheckpoint(owner, { identity, baseSeq: 0 },
        { clock: {}, syncMetaByDocument: {} });
    expect((await readLocal(owner))?.pending).toEqual([]);
    return identity;
}

async function changeHeight(height: number) {
    const mutation = await commitDomainOperations(owner, {
        type: 'profile.patch', patch: { height: String(height) },
    }, profile(170));
    expect(mutation.operations).toHaveLength(1);
    const saved = await readLocal(owner);
    expect(saved?.data.profile?.height).toBe(String(height));
    expect(saved?.pending.at(-1)).toEqual(mutation.operations[0]);
    expect(await get(storageKey)).toMatch(/^tlb-sealed:v1:/);
    return mutation;
}

beforeEach(async () => {
    await clear();
    lockAllVaults();
    localStorage.clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task(),
    } });
    localStorage.setItem(storageKey + ':health-consent-generation', '1');
    catalogSource.read.mockReset().mockResolvedValue(catalog);
    await createAndMigrateVault(owner);
});
afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('C-01: Domain Operations through encrypted IDB, D1 HTTP receipt and local ACK', () => {
    it('commits business+journal before any HTTP and stages ciphertext before commit; ACK preserves later edits', async () => {
        const identity = await prepareAccount();
        const server = syntheticHttpReplica(identity);
        expect(server.requests).toEqual([]);
        const first = await changeHeight(171);
        expect(server.requests).toEqual([]);
        server.state.afterCommit = async () => { await changeHeight(172); };

        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('acknowledged');

        expect(server.requests).toEqual(['control', 'read', 'receipt', 'commit', 'receipt']);
        expect(server.sentBatches).toHaveLength(1);
        const batch = server.sentBatches[0];
        expect(batch.lastSeq).toBe(first.operations[0].seq);
        expect(batch.replica).toEqual({
            slot: identity.slot, replicaId: identity.replicaId, generation: identity.generation,
        });
        const opened = readAccountCloudDocument(batch.documents[0].document,
            'C-01 synthetic HTTP commit', uid, '', adk);
        expect(opened.business.profile).toMatchObject({ height: '171' });
        const after = (await readLocal(owner))!;
        expect(after.data.profile?.height).toBe('172');
        expect(after.baseline.profile?.height).toBe('171');
        expect(after.pending).toHaveLength(1);
        expect(after.pending[0].seq).toBeGreaterThan(batch.lastSeq);
        expect(after.cloudflareDelivery).toBeUndefined();
        expect(after.syncMetaByDocument[''].clock.s00).toBe(batch.lastSeq);
    });

    it('retains immutable staged bytes after a pre-commit timeout, then retries that exact batch', async () => {
        const identity = await prepareAccount();
        await changeHeight(171);
        const server = syntheticHttpReplica(identity);
        server.state.commitFault = 'timeout-before-commit';

        await expect(deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .rejects.toThrow();
        const pending = (await readLocal(owner))!;
        const original = pending.cloudflareDelivery!.batch;
        const sealed = await get(storageKey);
        expect(pending.pending).toHaveLength(1);
        expect(server.state.committed).toBeNull();

        server.state.commitFault = 'none';
        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('acknowledged');
        expect(server.sentBatches).toEqual([original, original]);
        expect(server.requests.filter(route => route === 'control' || route === 'read'))
            .toEqual(['control', 'read']);
        expect(sealed).not.toBe(await get(storageKey));
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('keeps the journal after committed SQL loses its HTTP response and recovers by hash-bound receipt', async () => {
        const identity = await prepareAccount();
        await changeHeight(171);
        const server = syntheticHttpReplica(identity);
        server.state.commitFault = 'lost-response';
        server.state.receiptFault = 'hidden';

        await expect(deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .rejects.toThrow();
        const before = (await readLocal(owner))!;
        const raw = await get(storageKey);
        expect(server.state.committed).not.toBeNull();
        expect(before.pending).toHaveLength(1);
        expect(before.cloudflareDelivery?.batch).toEqual(server.state.committed);

        server.state.receiptFault = 'none';
        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('acknowledged');
        expect(server.sentBatches).toHaveLength(1);
        expect(server.requests.filter(route => route === 'control' || route === 'read'))
            .toEqual(['control', 'read']);
        expect(raw).not.toBe(await get(storageKey));
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('does not accept a forged receipt after a real remote commit', async () => {
        const identity = await prepareAccount();
        await changeHeight(171);
        const server = syntheticHttpReplica(identity);
        server.state.receiptFault = 'forged-hash';

        await expect(deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .rejects.toThrow();
        const before = await get(storageKey);
        expect((await readLocal(owner))?.pending).toHaveLength(1);
        expect((await readLocal(owner))?.cloudflareDelivery).toBeDefined();
        expect(server.state.committed).not.toBeNull();

        server.state.receiptFault = 'none';
        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('acknowledged');
        expect(server.sentBatches).toHaveLength(1);
        expect(before).not.toBe(await get(storageKey));
    });

    it('treats 409 without a primary non-commit proof as reconciliation-required, never ACK', async () => {
        const identity = await prepareAccount();
        await changeHeight(171);
        const server = syntheticHttpReplica(identity);
        server.state.commitFault = 'conflict';

        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('reconciliation-required');
        const before = await get(storageKey);
        expect((await readLocal(owner))?.pending).toHaveLength(1);
        expect((await readLocal(owner))?.cloudflareDelivery).toBeDefined();
        expect(server.requests).toContain('commit/status');
        expect(server.requests).not.toContain('scan');
        expect(server.state.committed).toBeNull();

        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('reconciliation-required');
        expect(await get(storageKey)).toBe(before);
    });

    it('fences identity change during preflight and after SQL commit, including A→B→A', async () => {
        const identity = await prepareAccount();
        await changeHeight(171);
        const server = syntheticHttpReplica(identity);
        let epoch = 1;
        const captured = epoch;
        const guard = () => epoch === captured;
        server.state.afterRead = () => { epoch += 1; };

        const original = await get(storageKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, guard))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(await get(storageKey)).toBe(original);
        expect(server.sentBatches).toHaveLength(0);

        server.state.afterRead = undefined;
        const freshEpoch = epoch;
        const freshGuard = () => epoch === freshEpoch;
        server.state.afterCommit = () => { epoch += 1; };

        await expect(deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, freshGuard))
            .rejects.toThrow();
        const staged = (await readLocal(owner))!;
        expect(staged.pending).toHaveLength(1);
        expect(staged.cloudflareDelivery?.batch).toEqual(server.state.committed);

        // The owner may be the same after an intervening B login, but a
        // response from the first A session cannot inherit its new epoch.
        expect(freshGuard()).toBe(false);
        expect(await deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .toBe('acknowledged');
        expect(server.sentBatches).toHaveLength(1);
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('rejects a foreign owner and changed consent without touching the original journal', async () => {
        const identity = await prepareAccount();
        await changeHeight(171);
        const server = syntheticHttpReplica(identity);
        const before = await get(storageKey);

        await expect(deliverCloudflareJournalCandidate('guest', adk, server.transport, csrfToken, () => true))
            .rejects.toThrow('non validi');
        await expect(deliverCloudflareJournalCandidate('user:someone-else', adk, server.transport, csrfToken, () => true))
            .rejects.toThrow();
        expect(server.requests).toEqual([]);
        expect(await get(storageKey)).toBe(before);

        server.state.consentRevision = 2;
        await expect(deliverCloudflareJournalCandidate(owner, adk, server.transport, csrfToken, () => true))
            .rejects.toThrow('Consenso cloud D1 differente');
        expect(server.requests).toEqual(['control']);
        expect(await get(storageKey)).toBe(before);
        expect((await readLocal(owner))?.pending).toHaveLength(1);
    });
});
