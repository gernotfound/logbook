import type { SealedCloudDocument } from './cloudDocumentCipher';
import { parseReplicaControl, type ReplicaControl, type ReplicaIdentity } from './replicaProtocol';

/**
 * Network-only boundary: no IndexedDB writes or ACK decisions live here.
 * A caller must AEAD-open every remote document and retain its durable journal
 * until the exact batch receipt is observed and locally acknowledged.
 */
export interface CloudReplicaBatch {
    batchId: string;
    expectedRevision: number;
    expectedFenceEpoch: number;
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

export interface CloudReplicaCompleteScan {
    revision: number;
    fenceEpoch: number;
    documents: Array<{ path: string; revision: number; document: unknown }>;
}

const SCAN_PAGE_SIZE = 8;
const MAX_SCAN_PAGES = 1024;
const DOCUMENT_PATH = /^(?:(?:history_months|nutrition_months)\/\d{4}-(?:0[1-9]|1[0-2]))?$/;

export interface CloudReplicaControlSnapshot {
    revision: number;
    fenceEpoch: number;
    consentRevision: number;
    replicas: ReplicaControl['replicas'];
}

export interface CloudReplicaReceipt {
    revision: number;
    lastSeq: number;
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

async function batchHash(batch: CloudReplicaBatch): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(batch)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
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
    async function post(route: 'read' | 'scan' | 'control' | 'commit' | 'receipt', body: unknown, csrfToken?: string): Promise<unknown> {
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
        async control(): Promise<CloudReplicaControlSnapshot> {
            const raw = await post('control', {});
            if (!isRecord(raw) || !safeRevision(raw.revision)
                || !safeRevision(raw.fenceEpoch) || raw.fenceEpoch < 1
                || !safeRevision(raw.consentRevision) || raw.consentRevision < 1
                || !isRecord(raw.replicas)) throw new CloudReplicaTransportError(0);
            try {
                const parsed = parseReplicaControl({
                    protocolVersion: 3, consentRevision: raw.consentRevision,
                    replicas: raw.replicas, mutation: { slot: 's00', action: 'checkpoint' },
                });
                return {
                    revision: raw.revision, fenceEpoch: raw.fenceEpoch,
                    consentRevision: raw.consentRevision,
                    replicas: parsed.replicas,
                };
            } catch {
                throw new CloudReplicaTransportError(0);
            }
        },

        // A partial page must never be published as a complete cloud checkpoint.
        // A concurrent write forces a 409 (and a fresh scan), never a silent
        // merge against an inconsistent collection of monthly documents.
        async scanAll(): Promise<CloudReplicaCompleteScan> {
            let after: string | null = null;
            let expectedRevision: number | null = null;
            let fenceEpoch: number | null = null;
            const documents: CloudReplicaCompleteScan['documents'] = [];
            for (let index = 0; index < MAX_SCAN_PAGES; index += 1) {
                const value = await post('scan', { after, expectedRevision });
                if (!isRecord(value) || !safeRevision(value.revision)
                    || !safeRevision(value.fenceEpoch)
                    || !Array.isArray(value.documents)
                    || value.documents.length > SCAN_PAGE_SIZE
                    || typeof value.complete !== 'boolean'
                    || (value.nextAfter !== null && typeof value.nextAfter !== 'string')
                    || (expectedRevision !== null && value.revision !== expectedRevision)
                    || (fenceEpoch !== null && value.fenceEpoch !== fenceEpoch)) {
                    throw new CloudReplicaTransportError(0);
                }
                const page: CloudReplicaCompleteScan['documents'] = [];
                let previous = after;
                for (const item of value.documents) {
                    if (!isRecord(item) || typeof item.path !== 'string'
                        || !DOCUMENT_PATH.test(item.path)
                        || (previous !== null && item.path <= previous)
                        || !safeRevision(item.revision) || item.revision < 1
                        || item.revision > value.revision || !isRecord(item.document)) {
                        throw new CloudReplicaTransportError(0);
                    }
                    page.push({ path: item.path, revision: item.revision, document: item.document });
                    previous = item.path;
                }
                if (value.complete !== (value.nextAfter === null)
                    || (!value.complete && (page.length !== SCAN_PAGE_SIZE || value.nextAfter !== previous))) {
                    throw new CloudReplicaTransportError(0);
                }
                documents.push(...page);
                expectedRevision = value.revision as number;
                fenceEpoch = value.fenceEpoch as number;
                if (value.complete) {
                    return { revision: expectedRevision, fenceEpoch, documents };
                }
                after = value.nextAfter as string;
            }
            throw new CloudReplicaTransportError(0);
        },

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
                || value.revision !== batch.expectedRevision + 1
                || value.batchId !== batch.batchId || value.lastSeq !== batch.lastSeq
                || typeof value.replayed !== 'boolean') {
                throw new CloudReplicaTransportError(0);
            }
            return { revision: value.revision, lastSeq: value.lastSeq, replayed: value.replayed };
        },

        async receipt(batch: CloudReplicaBatch): Promise<CloudReplicaReceipt | null> {
            const hash = await batchHash(batch);
            const value = await post('receipt', { batchId: batch.batchId });
            if (!isRecord(value) || !Object.hasOwn(value, 'receipt')) throw new CloudReplicaTransportError(0);
            if (value.receipt === null) return null;
            if (!isRecord(value.receipt) || !safeRevision(value.receipt.revision)
                || !safeRevision(value.receipt.lastSeq)
                || value.receipt.revision !== batch.expectedRevision + 1
                || value.receipt.lastSeq !== batch.lastSeq
                || value.receipt.consentRevision !== batch.consentRevision
                || !isRecord(value.receipt.replica)
                || value.receipt.replica.slot !== batch.replica.slot
                || value.receipt.replica.replicaId !== batch.replica.replicaId
                || value.receipt.replica.generation !== batch.replica.generation
                || value.receipt.requestHash !== hash) {
                throw new CloudReplicaTransportError(0);
            }
            return { revision: value.receipt.revision, lastSeq: value.receipt.lastSeq };

        },
    };
}
