import type { NormalizedCloudDocument } from '../schemaEvolution';
import { CloudCiphertextError } from './cloudDocumentCipher';
import { readAccountCloudDocument } from './cloudDocumentRead';
import type { CloudReplicaCompleteScan } from './cloudReplicaTransport';

export interface AuthenticatedCloudflareCheckpoint {
    revision: number;
    fenceEpoch: number;
    documents: Map<string, NormalizedCloudDocument>;
}

/**
 * Only a complete revision-fenced scan authenticated by the account ADK can
 * become a hydration candidate. This does not adopt a replica, write IndexedDB
 * or acknowledge any local journal sequence.
 */
export async function readAuthenticatedCloudflareCheckpoint(
    scan: () => Promise<CloudReplicaCompleteScan>,
    uid: string,
    accountKey: Uint8Array,
    isCurrent: () => boolean,
): Promise<AuthenticatedCloudflareCheckpoint> {
    if (!(accountKey instanceof Uint8Array) || accountKey.length !== 32) {
        throw new CloudCiphertextError();
    }
    if (!isCurrent()) throw new CloudCiphertextError();
    const snapshot = await scan();
    if (!isCurrent()) throw new CloudCiphertextError();

    const documents = new Map<string, NormalizedCloudDocument>();
    for (const item of snapshot.documents) {
        if (!isCurrent() || documents.has(item.path)) throw new CloudCiphertextError();
        const verified = readAccountCloudDocument(
            item.document, 'Cloudflare checkpoint', uid, item.path, accountKey,
        );
        documents.set(item.path, verified);
    }
    if (!isCurrent()) throw new CloudCiphertextError();
    return { revision: snapshot.revision, fenceEpoch: snapshot.fenceEpoch, documents };
}
