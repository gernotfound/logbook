/**
 * Pre-Write Document Size Guard (LogBook PWA)
 * 
 * Cloud Firestore imposes a strict 1 MiB (1,048,576 bytes) limit per document.
 * This pre-flight checker enforces a defensive safety threshold of 950,000 bytes (950 KB)
 * on all root documents and monthly subcollection buckets before any network writeBatch is constructed.
 * 
 * Prevents:
 * 1. Firestore quota and size overflow errors (INVALID_ARGUMENT / Document too large).
 * 2. Unnecessary write operations that would fail at the Firestore engine level.
 * 3. Client state desynchronization.
 * 
 * Conforms to AGENTS.md:
 * - Italian Sentence case for all error messages.
 * - Universal environment compatibility (Browser Blob / Node Buffer).
 */

export const FIRESTORE_HARD_LIMIT_BYTES = 1048576; // 1 MiB
export const DOC_SIZE_LIMIT_BYTES = 950000;         // 950 KB safety margin

export interface DocSizeAssessment {
    valid: boolean;
    sizeBytes: number;
    maxBytes: number;
    remainingBytes: number;
    percentage: number;
}

/**
 * Calculates the exact UTF-8 byte length of a JavaScript object/document payload.
 * Supports both browser environments (via Blob / TextEncoder) and Node.js environments.
 */
export function calculateDocSizeBytes(data: unknown): number {
    if (data === undefined || data === null) {
        return 0;
    }
    
    let jsonStr: string;
    try {
        jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (err: any) {
        throw new Error(`Impossibile serializzare i dati per la stima della dimensione: ${err?.message || 'errore sconosciuto'}`);
    }

    if (typeof Blob !== 'undefined') {
        return new Blob([jsonStr]).size;
    }

    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(jsonStr).length;
    }

    if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(jsonStr, 'utf8');
    }

    // Fallback using standard URI encoding byte estimator
    return encodeURI(jsonStr).split(/%..|./).length - 1;
}

/**
 * Evaluates whether a document payload is within the permitted size thresholds.
 */
export function isDocSizeWithinLimit(
    data: unknown, 
    maxBytes: number = DOC_SIZE_LIMIT_BYTES
): DocSizeAssessment {
    const sizeBytes = calculateDocSizeBytes(data);
    const valid = sizeBytes <= maxBytes;
    const remainingBytes = Math.max(0, maxBytes - sizeBytes);
    const percentage = Number(((sizeBytes / maxBytes) * 100).toFixed(2));

    return {
        valid,
        sizeBytes,
        maxBytes,
        remainingBytes,
        percentage
    };
}

/**
 * Validates document size and throws a descriptive, user-friendly Italian Error if it exceeds maxBytes.
 * 
 * @param data The payload to inspect (object, array, or JSON string)
 * @param docName Descriptive label for the document (e.g. 'users/uid' or 'history_months/2026-08')
 * @param maxBytes Maximum byte threshold (defaults to 950,000 bytes)
 * @throws Error in Italian Sentence case when threshold is violated
 */
export function checkDocSize(
    data: unknown, 
    docName: string = 'principale', 
    maxBytes: number = DOC_SIZE_LIMIT_BYTES
): void {
    const assessment = isDocSizeWithinLimit(data, maxBytes);
    if (!assessment.valid) {
        const formattedSize = formatBytes(assessment.sizeBytes);
        const formattedMax = formatBytes(maxBytes);
        throw new Error(
            `Il documento ${docName} supera il limite di dimensione di sicurezza di Firestore (${formattedSize} / limite ${formattedMax}). Ridurre i dati inseriti o archiviare i record precedenti.`
        );
    }
}

/**
 * Helper to format byte counts into human-readable strings (KB / MB).
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = (bytes / 1024).toFixed(1);
    if (bytes < 1024 * 1024) return `${kb} KB`;
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    return `${mb} MB`;
}
