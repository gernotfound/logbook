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
    // This compares both authenticated remote business and newly merged business
    // before sealing. Any field lost to tolerant normalization would otherwise
    // become an unintended deletion in the next cloud write.
    const mismatch = findLossyNormalization(raw, normalized);
    if (mismatch) throw new CloudDataIntegrityError(path, mismatch);
}
