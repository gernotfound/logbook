import { LEGAL_VERSIONS } from '../legalVersions';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_RESPONSE_BYTES = 2048;

export class KindeCandidateBoundaryError extends Error {
    constructor(readonly status: number = 0) {
        super('Identità Cloudflare non attestata: nessun accesso ai dati autorizzato.');
        this.name = 'KindeCandidateBoundaryError';
    }
}

type CandidatePrincipal = {
    uid: string;
    fenceEpoch: number;
    healthConsentRevision: number;
};

export type KindeCandidateAccess =
    | { kind: 'signed-out' }
    | { kind: 'consent-required'; principal: CandidatePrincipal }
    | { kind: 'legal-update-required'; principal: CandidatePrincipal }
    | { kind: 'consent-confirmed'; principal: CandidatePrincipal }
    | { kind: 'consent-suspended'; principal: CandidatePrincipal; status: 'withdrawn' | 'deleting' | 'deleted' };

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
    const keys = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function revision(value: unknown, minimum = 0): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function assertCurrent(stillCurrent: () => boolean): void {
    if (typeof stillCurrent !== 'function' || stillCurrent() !== true) {
        throw new KindeCandidateBoundaryError();
    }
}

async function readBoundedJson(response: Response): Promise<unknown> {
    const declared = response.headers.get('content-length');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
        || !/\bno-store\b/i.test(response.headers.get('cache-control') ?? '')
        || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES))
        || response.body === null) {
        throw new KindeCandidateBoundaryError();
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        for (let index = 0; index < 16; index += 1) {
            const { value, done } = await reader.read();
            if (done) {
                const bytes = new Uint8Array(size);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
            }
            if (!(value instanceof Uint8Array)) throw new KindeCandidateBoundaryError();
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new KindeCandidateBoundaryError();
            chunks.push(value);
        }
        throw new KindeCandidateBoundaryError();
    } catch {
        throw new KindeCandidateBoundaryError();
    } finally {
        void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch { /* A transport read can still be pending. */ }
    }
}

async function post(
    route: '/api/auth/session' | '/v1/consent/status',
    send: typeof fetch,
    stillCurrent: () => boolean,
): Promise<{ unauthorized: true } | { unauthorized: false; body: unknown }> {
    assertCurrent(stillCurrent);
    let response: Response;
    try {
        response = await send(route, {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        throw new KindeCandidateBoundaryError();
    }
    assertCurrent(stillCurrent);
    if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque'
        || response.type === 'error') throw new KindeCandidateBoundaryError();
    if (response.status === 401) return { unauthorized: true };
    if (response.status !== 200) throw new KindeCandidateBoundaryError(response.status);
    const body = await readBoundedJson(response);
    assertCurrent(stillCurrent);
    return { unauthorized: false, body };
}

function principal(value: unknown): CandidatePrincipal {
    if (!record(value) || !exactKeys(value, [
        'authenticated', 'uid', 'emailVerified', 'fenceEpoch', 'healthConsentRevision',
    ]) || value.authenticated !== true || value.emailVerified !== true
        || typeof value.uid !== 'string' || !UID.test(value.uid)
        || !revision(value.fenceEpoch, 1) || !revision(value.healthConsentRevision)) {
        throw new KindeCandidateBoundaryError();
    }
    return {
        uid: value.uid,
        fenceEpoch: value.fenceEpoch,
        healthConsentRevision: value.healthConsentRevision,
    };
}

function consentState(value: unknown, owner: CandidatePrincipal): KindeCandidateAccess {
    if (!record(value) || typeof value.status !== 'string'
        || !revision(value.revision) || !revision(value.fenceEpoch, 1)
        || value.revision !== owner.healthConsentRevision
        || value.fenceEpoch > owner.fenceEpoch) {
        throw new KindeCandidateBoundaryError();
    }
    if (value.status === 'unregistered') {
        if (!exactKeys(value, ['status', 'revision', 'fenceEpoch'])
            || value.revision !== 0 || value.fenceEpoch !== owner.fenceEpoch) {
            throw new KindeCandidateBoundaryError();
        }
        return { kind: 'consent-required', principal: owner };
    }
    if (value.status === 'active') {
        if (!exactKeys(value, ['status', 'revision', 'fenceEpoch', 'acceptedAt', 'privacyVersion', 'termsVersion'])
            || value.revision !== 1 || value.fenceEpoch !== owner.fenceEpoch
            || typeof value.privacyVersion !== 'string' || !VERSION.test(value.privacyVersion)
            || typeof value.termsVersion !== 'string' || !VERSION.test(value.termsVersion)
            || typeof value.acceptedAt !== 'string' || !Number.isFinite(Date.parse(value.acceptedAt))) {
            throw new KindeCandidateBoundaryError();
        }
        if (value.privacyVersion !== LEGAL_VERSIONS.privacy
            || value.termsVersion !== LEGAL_VERSIONS.terms) {
            return { kind: 'legal-update-required', principal: owner };
        }
        return { kind: 'consent-confirmed', principal: owner };
    }
    if (value.status === 'withdrawn' || value.status === 'deleting' || value.status === 'deleted') {
        if (!exactKeys(value, ['status', 'revision', 'fenceEpoch']) || value.revision < 1) {
            throw new KindeCandidateBoundaryError();
        }
        return { kind: 'consent-suspended', principal: owner, status: value.status };
    }
    throw new KindeCandidateBoundaryError();
}

/**
 * Candidate read-only browser adapter, not wired to Firebase AuthContext or
 * cloud hydration. Two separate Worker reads can straddle a session switch;
 * the final session read and caller's generation guard prevent publishing a
 * mixed-owner hint. Even 'consent-confirmed' is NOT an ACK, vault unlock,
 * session continuity proof, or permission to synchronize.
 */
export async function readKindeCandidateAccess({
    send = fetch, stillCurrent,
}: { send?: typeof fetch; stillCurrent: () => boolean }): Promise<KindeCandidateAccess> {
    const first = await post('/api/auth/session', send, stillCurrent);
    if (first.unauthorized) return { kind: 'signed-out' };
    const owner = principal(first.body);
    const consent = await post('/v1/consent/status', send, stillCurrent);
    if (consent.unauthorized) throw new KindeCandidateBoundaryError(401);
    const status = consentState(consent.body, owner);
    const last = await post('/api/auth/session', send, stillCurrent);
    if (last.unauthorized) throw new KindeCandidateBoundaryError(401);
    const verified = principal(last.body);
    if (verified.uid !== owner.uid || verified.fenceEpoch !== owner.fenceEpoch
        || verified.healthConsentRevision !== owner.healthConsentRevision) {
        throw new KindeCandidateBoundaryError();
    }
    assertCurrent(stillCurrent);
    return status;
}

/**
 * A cross-origin OAuth 303 must be a browser navigation, not a fetch whose
 * manual redirect is opaque to JS. No password, PKCE secret or return URL is
 * supplied by the app. Call only after an explicit, session-fenced user action;
 * guest->account intent and vault barriers must be handled by the eventual UI.
 */
export function submitKindeHostedSignIn(documentRef: Document, stillCurrent: () => boolean): void {
    assertCurrent(stillCurrent);
    if (!documentRef?.body || typeof documentRef.createElement !== 'function') {
        throw new KindeCandidateBoundaryError();
    }
    const form = documentRef.createElement('form');
    form.method = 'POST';
    form.action = '/api/auth/kinde/start';
    form.enctype = 'application/x-www-form-urlencoded';
    form.hidden = true;
    documentRef.body.appendChild(form);
    try {
        assertCurrent(stillCurrent);
        form.submit();
    } catch {
        form.remove();
        throw new KindeCandidateBoundaryError();
    }
}
