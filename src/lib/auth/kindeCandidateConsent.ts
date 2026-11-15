import { LEGAL_VERSIONS } from '../legalVersions';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, readKindeCandidateJson,
    type KindeCandidateAccess,
} from './kindeCandidateClient';

type InitialDecision = {
    acceptedHealthData: boolean;
    acceptedTerms: boolean;
    confirmsOver18: boolean;
};
type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;

function approved(value: InitialDecision): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === 'acceptedHealthData,acceptedTerms,confirmsOver18'
        && value.acceptedHealthData === true && value.acceptedTerms === true
        && value.confirmsOver18 === true;
}

function confirmation(value: unknown, uid: string, epoch: number): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const data = value as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'acceptedAt,fenceEpoch,privacyVersion,revision,status,termsVersion,uid'
        || data.uid !== uid || data.fenceEpoch !== epoch || data.revision !== 1
        || data.status !== 'active'
        || data.privacyVersion !== LEGAL_VERSIONS.privacy
        || data.termsVersion !== LEGAL_VERSIONS.terms
        || typeof data.acceptedAt !== 'string') return false;
    const timestamp = Date.parse(data.acceptedAt);
    return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now();
}

/**
 * First-consent candidate only. The UI must capture three separate explicit
 * decisions; neither a session cookie nor an existing guest approval is consent.
 *
 * The server's active/UID/epoch/legal readback is authoritative. A 200, 409,
 * 503 or lost response alone is never an acceptance ACK, and a failed initial
 * POST is never automatically replayed with fabricated consent.
 */
export async function acceptKindeCandidateInitialConsent({
    decision, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    decision: InitialDecision;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<Confirmed> {
    if (!approved(decision)) throw new KindeCandidateBoundaryError();
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const initial = await readKindeCandidateAccess({ send, stillCurrent: fence.stillCurrent });
    if (initial.kind !== 'consent-required' || initial.principal.healthConsentRevision !== 0
        || !fence.stillCurrent()) throw new KindeCandidateBoundaryError();

    const { uid, fenceEpoch } = initial.principal;
    let response: Response | undefined;
    try {
        response = await send('/v1/consent/initial', {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json',
                'X-CSRF-Token': fence.csrfToken,
            },
            body: JSON.stringify({
                action: 'accept-initial', expectedRevision: 0,
                acceptance: {
                    acceptedHealthData: true, acceptedTerms: true, confirmsOver18: true,
                    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
                },
            }),
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        // The SQL insert may have committed before the HTTP response failed.
        // Never replay the POST; use only a fresh trusted consent readback.
    }
    if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
    if (response) {
        if (response.redirected || ['opaque', 'opaqueredirect', 'error'].includes(response.type)
            || ![200, 409, 500, 502, 503, 504].includes(response.status)) {
            throw new KindeCandidateBoundaryError(response.status);
        }
        if (response.status === 200 && !confirmation(
            await readKindeCandidateJson(response), uid, fenceEpoch
        )) throw new KindeCandidateBoundaryError();
    }

    const after = await readKindeCandidateAccess({ send, stillCurrent: fence.stillCurrent });
    if (after.kind !== 'consent-confirmed' || after.principal.uid !== uid
        || after.principal.fenceEpoch !== fenceEpoch
        || after.principal.healthConsentRevision !== 1
        || !fence.stillCurrent()) throw new KindeCandidateBoundaryError();
    return after;
}
