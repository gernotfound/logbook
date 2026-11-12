import type { SealedCloudDocument } from './cloudDocumentCipher';
import type { ReplicaIdentity } from './replicaProtocol';

/**
 * Network-only boundary: no IndexedDB writes or ACK decisions live here.
 * A caller must AEAD-open every remote document and retain its durable journal
 * until the exact batch receipt is observed and locally acknowledged.
 */
export interface CloudReplicaBatch {
    batchId: string;
    expectedRevision: number;
    consentRevision: number;
    replica: Pick<ReplicaIdentity, 'slot' | 'replicaId' | 'generation'>;
    lastSeq: number;
    documents: Array<{ path: string; document: SealedCloudDocument }>;
}

export interface CloudReplicaSnapshot {
    revision: number;
    fenceEpoch: number;
    documents: Array<{ path: string; revision: number | null; document: unknown }>;
}

export interface CloudReplicaReceipt {
    revision: number;
    lastSeq: number;
}

export class CloudReplicaTransportError extends Error {
    constructor(readonly status: number) {
        super('Trasporto replica cloud non confermato: journal locale da preservare.');
        this.name = 'CloudReplicaTransportError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRevision(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Candidate only. Same-origin /v1 routes are not wired into production sync.
 * The browser sends the HttpOnly session cookie; the server's trusted AUTH_GATE
 * validates identity, health consent and session-bound CSRF independently.
 */
export function createCloudflareReplicaTransport(send: typeof fetch = fetch) {
    async function post(route: 'read' | 'commit' | 'receipt', body: unknown, csrfToken?: string): Promise<unknown> {
        let response: Response;
        try {
            response = await send('/v1/sync/' + route, {
                method: 'POST',
                mode: 'same-origin',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'error',
                headers: {
                    'Content-Type': 'application/json',
                    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
                },
                body: JSON.stringify(body),
            });
        } catch {
            throw new CloudReplicaTransportError(0);
        }
        if (!response.ok) throw new CloudReplicaTransportError(response.status);
        try {
            return await response.json() as unknown;
        } catch {
            throw new CloudReplicaTransportError(0);
        }
    }

    return {
        async read(paths: string[]): Promise<CloudReplicaSnapshot> {
            const value = await post('read', { paths });
            if (!isRecord(value) || !safeRevision(value.revision) || !safeRevision(value.fenceEpoch)
                || !Array.isArray(value.documents)
                || value.documents.length !== paths.length
                || value.documents.some((item, index) => !isRecord(item) || item.path !== paths[index]
                    || (item.revision !== null && !safeRevision(item.revision)))) {
                throw new CloudReplicaTransportError(0);
            }
            return value as unknown as CloudReplicaSnapshot;
        },

        async commit(batch: CloudReplicaBatch, csrfToken: string): Promise<{ revision: number; lastSeq: number; replayed: boolean }> {
            if (!csrfToken) throw new CloudReplicaTransportError(0);
            const value = await post('commit', batch, csrfToken);
            if (!isRecord(value) || !safeRevision(value.revision) || !safeRevision(value.lastSeq)
                || value.batchId !== batch.batchId || value.lastSeq !== batch.lastSeq
                || typeof value.replayed !== 'boolean') {
                throw new CloudReplicaTransportError(0);
            }
            return { revision: value.revision, lastSeq: value.lastSeq, replayed: value.replayed };
        },

        async receipt(batchId: string): Promise<CloudReplicaReceipt | null> {
            const value = await post('receipt', { batchId });
            if (!isRecord(value) || !Object.hasOwn(value, 'receipt')) throw new CloudReplicaTransportError(0);
            if (value.receipt === null) return null;
            if (!isRecord(value.receipt) || !safeRevision(value.receipt.revision) || !safeRevision(value.receipt.lastSeq)) {
                throw new CloudReplicaTransportError(0);
            }
            return { revision: value.receipt.revision, lastSeq: value.receipt.lastSeq };
        },
    };
}
