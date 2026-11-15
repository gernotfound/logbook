export class CloudKeyAccessUnavailableError extends Error {
    readonly code = 'cloud-key-unavailable';
    constructor(readonly retryable = false) {
        super('Chiave cloud temporaneamente non disponibile. I dati locali sono conservati.');
        this.name = 'CloudKeyAccessUnavailableError';
    }
}

export function decodeCloudAccountKey(value: unknown): Uint8Array {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
        throw new CloudKeyAccessUnavailableError();
    }
    let bytes: Uint8Array | undefined;
    try {
        bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
        if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== value) {
            throw new CloudKeyAccessUnavailableError();
        }
        return bytes;
    } catch {
        bytes?.fill(0);
        throw new CloudKeyAccessUnavailableError();
    }
}

export function isRetryableCloudKeyTransportFailure(error: unknown): boolean {
    return error instanceof TypeError || (error instanceof DOMException
        && (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'NetworkError'));
}
