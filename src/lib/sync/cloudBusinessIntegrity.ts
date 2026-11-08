import type { DocumentData } from './documentProjection';
import { findLossyNormalization } from './businessNormalizationIntegrity';

export class CloudDataIntegrityError extends Error {
    constructor(documentPath: string, fieldPath: string[]) {
        const location = fieldPath.length ? fieldPath.join('.') : 'root';
        super(`Dati cloud non validi in Firestore ${documentPath || 'root'} (${location}): sincronizzazione bloccata per evitare una riscrittura distruttiva.`);
        this.name = 'CloudDataIntegrityError';
    }
}

export function assertCloudBusinessPreserved(path: string, raw: DocumentData, normalized: DocumentData): void {
    // Cloud input has already been authenticated and opened by the AEAD reader.
    // Any remaining root key is business data and must survive the canonical projection;
    // unknown same-schema fields are therefore an integrity error, not silent loss.
    const mismatch = findLossyNormalization(raw, normalized);
    if (mismatch) throw new CloudDataIntegrityError(path, mismatch);
}
