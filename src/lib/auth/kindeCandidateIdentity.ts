import {
    captureKindeCandidatePresenceFence, KindeCandidateBoundaryError,
    readKindeCandidateJson,
} from './kindeCandidateClient';

const UID = /^k_[A-Za-z0-9_-]{43}$/;

type Identity = {
    uid: string;
    fenceEpoch: number;
    healthConsentRevision: number;
    emailVerified: boolean;
};

export type KindeCandidateIdentity =
    | { kind: 'signed-out' }
    | { kind: 'email-unverified'; principal: Identity }
    | { kind: 'email-verified'; principal: Identity };

function strictIdentity(value: unknown): Identity {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new KindeCandidateBoundaryError();
    }
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input).sort();
    if (keys.join(',') !== 'authenticated,emailVerified,fenceEpoch,healthConsentRevision,uid'
        || input.authenticated !== true || typeof input.uid !== 'string'
        || !UID.test(input.uid) || typeof input.emailVerified !== 'boolean'
        || typeof input.fenceEpoch !== 'number' || !Number.isSafeInteger(input.fenceEpoch)
        || input.fenceEpoch < 1
        || typeof input.healthConsentRevision !== 'number'
        || !Number.isSafeInteger(input.healthConsentRevision)
        || input.healthConsentRevision < 0) {
        throw new KindeCandidateBoundaryError();
    }
    return {
        uid: input.uid, fenceEpoch: input.fenceEpoch,
        healthConsentRevision: input.healthConsentRevision,
        emailVerified: input.emailVerified,
    };
}

async function readStatus(send: typeof fetch, stillCurrent: () => boolean): Promise<Identity | null> {
    if (!stillCurrent()) throw new KindeCandidateBoundaryError();
    let response: Response;
    try {
        response = await send('/api/auth/session', {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
    } catch { throw new KindeCandidateBoundaryError(); }
    if (!stillCurrent() || response.redirected
        || ['opaque', 'opaqueredirect', 'error'].includes(response.type)) {
        throw new KindeCandidateBoundaryError();
    }
    const data = await readKindeCandidateJson(response);
    if (!stillCurrent()) throw new KindeCandidateBoundaryError();
    if (response.status === 401) {
        if (!data || typeof data !== 'object' || Array.isArray(data)
            || Object.keys(data).join(',') !== 'error'
            || (data as Record<string, unknown>).error !== 'unauthorized') {
            throw new KindeCandidateBoundaryError();
        }
        return null;
    }
    if (response.status !== 200) throw new KindeCandidateBoundaryError(response.status);
    return strictIdentity(data);
}

/**
 * Identity-only candidate observer. An unverified Kinde email can still own
 * rights-only routes, but may never grant fitness, cloud ADK or a local vault.
 * The browser-bound CSRF cookie is pinned before the first HTTP read.
 * Consent is always checked separately after identity verification.
 */
export async function readKindeCandidateIdentity({
    send = fetch, stillCurrent, browserCookies = () => document.cookie,
}: {
    send?: typeof fetch;
    stillCurrent: () => boolean;
    browserCookies?: () => string;
}): Promise<KindeCandidateIdentity> {
    const fence = captureKindeCandidatePresenceFence({ stillCurrent, browserCookies });
    const first = await readStatus(send, fence.stillCurrent);
    if (first === null) return { kind: 'signed-out' };
    if (fence.csrfToken === null) throw new KindeCandidateBoundaryError();
    const last = await readStatus(send, fence.stillCurrent);
    if (last === null || last.uid !== first.uid
        || last.fenceEpoch !== first.fenceEpoch
        || last.healthConsentRevision !== first.healthConsentRevision
        || last.emailVerified !== first.emailVerified || !fence.stillCurrent()) {
        throw new KindeCandidateBoundaryError();
    }
    return { kind: last.emailVerified ? 'email-verified' : 'email-unverified', principal: last };
}
