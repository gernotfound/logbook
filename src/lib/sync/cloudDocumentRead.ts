import { CURRENT_DATA_SCHEMA, normalizeCloudDocument, type NormalizedCloudDocument } from '../schemaEvolution';
import { CloudCiphertextError, openCloudDocument } from './cloudDocumentCipher';

/**
 * Encrypted account reads require a verified key acquired outside Firestore
 * transaction callbacks. The unkeyed schema-normalization path must reject
 * sealed documents: a failed AEAD open never falls back to plaintext/empty.
 */
export function readAccountCloudDocument(
    raw: unknown, context: string, uid: string, path: string,
    accountKey?: Uint8Array,
): NormalizedCloudDocument {
    if (accountKey) {
        const decoded = openCloudDocument(accountKey, uid, path, raw);
        return { business: decoded.business, sync: decoded.sync, dataSchemaVersion: CURRENT_DATA_SCHEMA };
    }
    // No key must not permit a sealed document to become apparently empty
    // after a permissive root schema projection. This catches incomplete
    // deployments and caller paths lacking the authenticated ADK.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)
        && Object.hasOwn(raw, '_sealed')) throw new CloudCiphertextError();
    return normalizeCloudDocument(raw, context);
}
