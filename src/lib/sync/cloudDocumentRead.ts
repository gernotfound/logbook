import { CURRENT_DATA_SCHEMA, type NormalizedCloudDocument } from '../schemaEvolution';
import { CloudCiphertextError, openCloudDocument } from './cloudDocumentCipher';

/**
 * An authenticated cloud document is authoritative only after a keyed AEAD
 * open. Schema normalization without an ADK must never admit plaintext.
 */
export function readAccountCloudDocument(
    raw: unknown, _context: string, uid: string, path: string,
    accountKey?: Uint8Array,
): NormalizedCloudDocument {
    if (!(accountKey instanceof Uint8Array) || accountKey.length !== 32) {
        throw new CloudCiphertextError();
    }
    const decoded = openCloudDocument(accountKey, uid, path, raw);
    return { business: decoded.business, sync: decoded.sync, dataSchemaVersion: CURRENT_DATA_SCHEMA };
}
