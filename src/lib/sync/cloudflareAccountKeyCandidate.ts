import { CloudKeyAccessUnavailableError, decodeCloudAccountKey, isRetryableCloudKeyTransportFailure } from './cloudAccountKeyMaterial';

type KeyContext = { uid: string; fenceEpoch: number; consentRevision: number };
type Purpose = 'sync' | 'rights-export';
const MAX_RESPONSE_BYTES = 1024;

function snapshot(expected: KeyContext): KeyContext {
    const context = { ...expected };
    if (typeof context.uid !== 'string' || !/^k_[A-Za-z0-9_-]{43}$/.test(context.uid)
        || !Number.isSafeInteger(context.fenceEpoch) || context.fenceEpoch < 1
        || !Number.isSafeInteger(context.consentRevision) || context.consentRevision < 1) {
        throw new CloudKeyAccessUnavailableError();
    }
    return context;
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
    const length = response.headers.get('content-length');
    const noStore = response.headers.get('cache-control')?.toLowerCase()
        .split(',').some(value => value.trim() === 'no-store') === true;
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
        || !noStore || !response.body || response.bodyUsed || response.body.locked
        || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))) {
        throw new CloudKeyAccessUnavailableError();
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(MAX_RESPONSE_BYTES);
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    let size = 0;
    try {
        signal.throwIfAborted();
        // The byte cap also bounds a maximally fragmented valid response;
        // extra empty chunks cannot create an unbounded microtask loop.
        for (let reads = 0; reads <= MAX_RESPONSE_BYTES + 32; reads += 1) {
            const { done, value } = await Promise.race([reader.read(), aborted]);
            if (done) {
                try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) as unknown; }
                catch { throw new CloudKeyAccessUnavailableError(); }
            }
            if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1
                || size + value.byteLength > MAX_RESPONSE_BYTES) {
                throw new CloudKeyAccessUnavailableError();
            }
            bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), size);
            size += value.byteLength;
        }
        throw new CloudKeyAccessUnavailableError();
    } finally {
        bytes.fill(0);
        signal.removeEventListener('abort', onAbort);
        // Cancellation releases a stalled transport after the bounded read
        // has failed; its cleanup result cannot authorize or return a key.
        void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch { /* An aborted read may still be pending. */ }
    }
}

/**
 * Candidate-only, network-only ADK access. The caller must capture its Auth
 * generation and consent in stillCurrent (including A→B→A), then wipe returned
 * bytes after this one operation. No vault, identity or journal is activated.
 */
export async function acquireCloudflareAccountKeyCandidate({
    expected, purpose, stillCurrent, csrfToken, send = fetch,
}: {
    expected: KeyContext;
    purpose: Purpose;
    stillCurrent: () => boolean;
    csrfToken: () => string | null;
    send?: typeof fetch;
}): Promise<Uint8Array> {
    const context = snapshot(expected);
    const check = () => {
        let current = false;
        try { current = typeof stillCurrent === 'function' && stillCurrent() === true; } catch { /* Unreadable identity is not a network outage. */ }
        if (!current) throw new CloudKeyAccessUnavailableError();
    };
    check();
    if (purpose !== 'sync' && purpose !== 'rights-export') throw new CloudKeyAccessUnavailableError();
    let csrf: string | null;
    try { csrf = csrfToken(); } catch { throw new CloudKeyAccessUnavailableError(); }
    check();
    if (typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) {
        throw new CloudKeyAccessUnavailableError();
    }
    const signal = AbortSignal.timeout(12_000);
    let response: Response;
    try {
        response = await send('/v1/cloud-key/' + purpose, {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error', signal,
            headers: { Accept: 'application/json', 'x-csrf-token': csrf },
        });
    } catch (error) {
        check();
        throw new CloudKeyAccessUnavailableError(isRetryableCloudKeyTransportFailure(error));
    }
    let key: Uint8Array | undefined;
    try {
        check();
        if (response.redirected || ['error', 'opaque', 'opaqueredirect'].includes(response.type)) {
            throw new CloudKeyAccessUnavailableError();
        }
        if (response.status !== 200) {
            throw new CloudKeyAccessUnavailableError([408, 429, 500, 502, 503, 504].includes(response.status));
        }
        const body = await readBoundedJson(response, signal);
        check();
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CloudKeyAccessUnavailableError();
        const data = body as Record<string, unknown>;
        if (Object.keys(data).sort().join(',') !== 'consentRevision,fenceEpoch,format,key,purpose,uid,version'
            || data.format !== 'thelogbook-account-data-key' || data.version !== 1
            || data.uid !== context.uid || data.fenceEpoch !== context.fenceEpoch
            || data.consentRevision !== context.consentRevision || data.purpose !== purpose) {
            throw new CloudKeyAccessUnavailableError();
        }
        key = decodeCloudAccountKey(data.key);
        check();
        return key;
    } catch (error) {
        key?.fill(0);
        check();
        if (error instanceof CloudKeyAccessUnavailableError) throw error;
        throw new CloudKeyAccessUnavailableError(isRetryableCloudKeyTransportFailure(error));
    } finally {
        void response.body?.cancel().catch(() => {});
    }
}
