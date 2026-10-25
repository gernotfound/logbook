import { CURRENT_DATA_SCHEMA, normalizeCloudDocument, type NormalizedCloudDocument } from '../schemaEvolution';
import { CloudCiphertextError, openCloudDocument } from './cloudDocumentCipher';

/**
 * Read-only boundary for both the existing parsing contracts and the v2.0
 * encrypted-cloud candidate. The caller must opt in with a VERIFIED account
 * key acquired outside of Firestore transaction callbacks. Never fallback
 * from a failing AEAD open to plaintext or an empty document.
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
