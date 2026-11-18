import { LEGAL_VERSIONS } from '../legalVersions';
import {
    CloudReplicaTransportError, createCloudflareReplicaTransport,
    type CloudReplicaControlSnapshot,
} from '../sync/cloudReplicaTransport';

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

export async function readKindeCandidateJson(
    response: Response,
    signal: AbortSignal = AbortSignal.timeout(5000),
): Promise<unknown> {
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
    let rejectAborted: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
    const onAbort = () => rejectAborted(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        signal.throwIfAborted();
        for (let index = 0; index < 16; index += 1) {
            const { value, done } = await Promise.race([reader.read(), aborted]);
            signal.throwIfAborted();
            if (done) {
                const bytes = new Uint8Array(size);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
            }
            // Fetch may provide a byte view from another realm (e.g. a
            // worker or browser frame); instanceof is not a byte contract.
            if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) {
                throw new KindeCandidateBoundaryError();
            }
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new KindeCandidateBoundaryError();
            chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
        }
        throw new KindeCandidateBoundaryError();
    } catch {
        throw new KindeCandidateBoundaryError();
    } finally {
        signal.removeEventListener('abort', onAbort);
        void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch { /* A timed-out transport read can still be pending. */ }
    }
}

async function post(
    route: '/api/auth/session' | '/v1/consent/status',
    send: typeof fetch,
    stillCurrent: () => boolean,
    csrfToken?: string,
): Promise<{ unauthorized: true } | { unauthorized: false; body: unknown }> {
    assertCurrent(stillCurrent);
    let response: Response;
    try {
        response = await send(route, {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        throw new KindeCandidateBoundaryError();
    }
    assertCurrent(stillCurrent);
    if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque'
        || response.type === 'error') throw new KindeCandidateBoundaryError();
    if (response.status === 401) {
        const denied = await readKindeCandidateJson(response);
        assertCurrent(stillCurrent);
        if (!record(denied) || !exactKeys(denied, ['error'])
            || denied.error !== 'unauthorized') {
            throw new KindeCandidateBoundaryError();
        }
        return { unauthorized: true };
    }
    if (response.status !== 200) throw new KindeCandidateBoundaryError(response.status);
    const body = await readKindeCandidateJson(response);
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
        || typeof value.uid !== 'string' || !UID.test(value.uid) || value.uid !== owner.uid
        || !revision(value.revision) || !revision(value.fenceEpoch, 1)
        || value.revision !== owner.healthConsentRevision
        // Terminal SQL erasure moves the subject fence one generation ahead
        // of an otherwise valid identity session. This is suspension ONLY:
        // it must never make an active fitness grant appear current.
        || (value.fenceEpoch > owner.fenceEpoch
            && !(value.status === 'withdrawn' && value.revision === 2
                && value.fenceEpoch === owner.fenceEpoch + 1))) {
        throw new KindeCandidateBoundaryError();
    }
    if (value.status === 'unregistered') {
        if (!exactKeys(value, ['uid', 'status', 'revision', 'fenceEpoch'])
            || value.revision !== 0 || value.fenceEpoch !== owner.fenceEpoch) {
            throw new KindeCandidateBoundaryError();
        }
        return { kind: 'consent-required', principal: owner };
    }
    if (value.status === 'active') {
        if (!exactKeys(value, ['uid', 'status', 'revision', 'fenceEpoch', 'acceptedAt', 'privacyVersion', 'termsVersion'])
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
        if (!exactKeys(value, ['uid', 'status', 'revision', 'fenceEpoch']) || value.revision < 1) {
            throw new KindeCandidateBoundaryError();
        }
        return { kind: 'consent-suspended', principal: owner, status: value.status };
    }
    throw new KindeCandidateBoundaryError();
}

/**
 * Candidate browser status adapter, not wired to React AuthContext or
 * cloud hydration. CSRF permits the server to reconcile already committed
 * consent. Two separate Worker reads can straddle a session switch;
 * the preflight cookie fence, final session read, trusted consent UID and
 * caller generation reject mixed-owner hints, including A→B→A with equal
 * epochs. 'Consent-confirmed' is not an ACK, vault unlock or sync grant.
 */
export async function readKindeCandidateAccess({
    send = fetch, stillCurrent, browserCookies = () => document.cookie,
}: {
    send?: typeof fetch; stillCurrent: () => boolean; browserCookies?: () => string;
}): Promise<KindeCandidateAccess> {
    // Pin the browser incarnation before any network read. Equal UID and
    // D1 epochs are not proof that two HTTP responses share one session.
    const fence = captureKindeCandidatePresenceFence({ stillCurrent, browserCookies });
    const first = await post('/api/auth/session', send, fence.stillCurrent);
    if (first.unauthorized) return { kind: 'signed-out' };
    if (fence.csrfToken === null) throw new KindeCandidateBoundaryError();
    const owner = principal(first.body);
    const consent = await post('/v1/consent/status', send, fence.stillCurrent, fence.csrfToken);
    if (consent.unauthorized) throw new KindeCandidateBoundaryError(401);
    const last = await post('/api/auth/session', send, fence.stillCurrent);
    if (last.unauthorized) throw new KindeCandidateBoundaryError(401);
    const verified = principal(last.body);
    if (verified.uid !== owner.uid || verified.fenceEpoch !== owner.fenceEpoch
        || verified.healthConsentRevision !== owner.healthConsentRevision) {
        throw new KindeCandidateBoundaryError();
    }
    const status = consentState(consent.body, verified);
    assertCurrent(fence.stillCurrent);
    return status;
}

export type KindeCandidateReplicaObservation =
    | Exclude<KindeCandidateAccess, { kind: 'consent-confirmed' }>
    | { kind: 'replica-control-observed'; principal: CandidatePrincipal; control: CloudReplicaControlSnapshot };

/**
 * Candidate-only read bridge between Kinde session/consent and D1 control.
 * Recheck trusted owner, epoch and consent after the network boundary; never
 * claim a replica, touch the vault or acknowledge the journal from this hint.
 */
export async function inspectKindeCandidateReplicaControl({
    send = fetch, stillCurrent, browserCookies = () => document.cookie,
}: {
    send?: typeof fetch; stillCurrent: () => boolean; browserCookies?: () => string;
}): Promise<KindeCandidateReplicaObservation> {
    const fence = captureKindeCandidatePresenceFence({ stillCurrent, browserCookies });
    const first = await readKindeCandidateAccess({
        send, stillCurrent: fence.stillCurrent, browserCookies,
    });
    if (first.kind !== 'consent-confirmed') return first;
    let control: CloudReplicaControlSnapshot;
    try { control = await createCloudflareReplicaTransport(send).control(); }
    catch (error) {
        throw new KindeCandidateBoundaryError(error instanceof CloudReplicaTransportError ? error.status : 0);
    }
    assertCurrent(fence.stillCurrent);
    const last = await readKindeCandidateAccess({
        send, stillCurrent: fence.stillCurrent, browserCookies,
    });
    if (last.kind !== 'consent-confirmed' || last.principal.uid !== first.principal.uid
        || last.principal.fenceEpoch !== first.principal.fenceEpoch
        || last.principal.healthConsentRevision !== first.principal.healthConsentRevision
        // Equal revision and consent are insufficient under A→B→A reuse.
        || control.uid !== first.principal.uid
        || control.fenceEpoch !== first.principal.fenceEpoch
        || control.consentRevision !== first.principal.healthConsentRevision) {
        throw new KindeCandidateBoundaryError();
    }
    assertCurrent(fence.stillCurrent);
    return { kind: 'replica-control-observed', principal: last.principal, control };
}

const CSRF_COOKIE = '__Host-logbook_csrf';
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function canonicalCsrf(token: string): boolean {
    if (!CSRF_TOKEN.test(token)) return false;
    try {
        const raw = atob(token.replaceAll('-', '+').replaceAll('_', '/') + '=');
        return raw.length === 32
            && btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === token;
    } catch { return false; }
}

function optionalSessionCsrf(cookies: string): string | null {
    if (typeof cookies !== 'string' || cookies.length > 4096) {
        throw new KindeCandidateBoundaryError();
    }
    const matches = cookies.split(';').map(part => part.trim())
        .filter(part => part.startsWith(CSRF_COOKIE));
    if (matches.length === 0) return null;
    if (matches.length !== 1 || !matches[0].startsWith(CSRF_COOKIE + '=')) {
        throw new KindeCandidateBoundaryError();
    }
    const token = matches[0].slice(CSRF_COOKIE.length + 1);
    if (!canonicalCsrf(token)) throw new KindeCandidateBoundaryError();
    return token;
}

function sessionCsrf(cookies: string): string {
    const value = optionalSessionCsrf(cookies);
    if (value === null) throw new KindeCandidateBoundaryError();
    return value;
}

/**
 * Signed-out status can be checked without a CSRF cookie. Authenticated
 * status cannot: preserve the original browser incarnation throughout
 * session/consent/replica reads, including A→B→A with equal server claims.
 * This is a continuity fence, not a grant to an account archive or vault.
 */
export function captureKindeCandidatePresenceFence({
    stillCurrent, browserCookies = () => document.cookie,
}: {
    stillCurrent: () => boolean; browserCookies?: () => string;
}): { csrfToken: string | null; stillCurrent: () => boolean } {
    if (typeof stillCurrent !== 'function') throw new KindeCandidateBoundaryError();
    let token: string | null;
    try { token = optionalSessionCsrf(browserCookies()); }
    catch { throw new KindeCandidateBoundaryError(); }
    const current = () => {
        try { return stillCurrent() === true && optionalSessionCsrf(browserCookies()) === token; }
        catch { return false; }
    };
    assertCurrent(current);
    return { csrfToken: token, stillCurrent: current };
}

/**
 * Session identity is opaque to the browser: the HttpOnly cookie cannot be
 * compared across awaits. Its independently random, readable CSRF partner
 * changes with each issued D1 session and fences same-UID reauthentication
 * and A→B→A during candidate cloud operations.
 */
export function captureKindeCandidateSessionFence({
    stillCurrent, browserCookies = () => document.cookie,
}: {
    stillCurrent: () => boolean;
    browserCookies?: () => string;
}): { csrfToken: string; stillCurrent: () => boolean } {
    const fence = captureKindeCandidatePresenceFence({ stillCurrent, browserCookies });
    if (fence.csrfToken === null) throw new KindeCandidateBoundaryError();
    return { csrfToken: fence.csrfToken, stillCurrent: fence.stillCurrent };
}

/**
 * Candidate-only D1 session logout, NOT Kinde identity-provider SSO logout or
 * device-vault cleanup. A lost 200 or a concurrent new login must never be
 * misreported as a completed remote logout: require a fresh, unambiguous 401
 * status after the server's conditional session revocation.
 */
export async function revokeKindeCandidateSession({
    send = fetch, stillCurrent, expectedCsrfToken, browserCookies = () => document.cookie,
}: {
    send?: typeof fetch;
    stillCurrent: () => boolean;
    expectedCsrfToken: string;
    browserCookies?: () => string;
}): Promise<void> {
    assertCurrent(stillCurrent);
    let csrf: string;
    try { csrf = sessionCsrf(browserCookies()); }
    catch { throw new KindeCandidateBoundaryError(); }
    if (csrf !== expectedCsrfToken) throw new KindeCandidateBoundaryError();
    assertCurrent(stillCurrent);

    let response: Response;
    try {
        response = await send('/api/auth/logout', {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
            signal: AbortSignal.timeout(5000),
        });
    } catch { throw new KindeCandidateBoundaryError(); }
    assertCurrent(stillCurrent);
    if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque'
        || response.type === 'error' || response.status !== 200) {
        throw new KindeCandidateBoundaryError(response.status);
    }
    const revoked = await readKindeCandidateJson(response);
    assertCurrent(stillCurrent);
    if (!record(revoked) || !exactKeys(revoked, ['status'])
        || revoked.status !== 'signed-out') throw new KindeCandidateBoundaryError();

    const status = await post('/api/auth/session', send, stillCurrent);
    if (!status.unauthorized) throw new KindeCandidateBoundaryError();
    assertCurrent(stillCurrent);
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
