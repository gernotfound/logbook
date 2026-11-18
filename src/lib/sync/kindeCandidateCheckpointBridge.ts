import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { acquireCloudflareAccountKeyCandidate } from './cloudflareAccountKeyCandidate';
import {
    readAuthenticatedCloudflareCheckpoint, type AuthenticatedCloudflareCheckpoint,
} from './cloudReplicaCheckpoint';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';

type Principal = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['principal'];

export type KindeCandidateCheckpointObservation = {
    kind: 'checkpoint-observed';
    principal: Principal;
    checkpoint: AuthenticatedCloudflareCheckpoint;
    legalConsent: Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['legalConsent'];
};

/**
 * Read-only preactivation path: Kinde session + consent -> ephemeral cloud ADK
 * -> complete, revision-pinned D1 scan -> owner/path-bound AEAD opens.
 *
 * A successful (even empty) scan cannot grant local ownership or authorize
 * hydration, replica claims or ACKs. The eventual caller still needs local
 * vault, session incarnation, journal and recovery fences before any commit.
 */
export async function inspectKindeCandidateCloudCheckpoint({
    stillCurrent, expected, send = fetch, browserCookies = () => document.cookie,
}: {
    stillCurrent: () => boolean;
    expected?: Readonly<Principal>;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<KindeCandidateCheckpointObservation> {
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            if (!fence.stillCurrent()) return false;
            const guestFlag = readBrowserValueStrict('logbook_is_guest');
            return guestFlag === null || guestFlag === 'false';
        } catch { return false; }
    };
    if (!current()) throw new KindeCandidateBoundaryError();

    // Both consent checks must see the same browser cookie source as this
    // checkpoint, including when the caller supplies the session reader.
    const accessRequest = { send, stillCurrent: current, browserCookies };
    const before = await readKindeCandidateAccess(accessRequest);
    if (before.kind !== 'consent-confirmed' || !current()) {
        throw new KindeCandidateBoundaryError();
    }
    const { uid, fenceEpoch, healthConsentRevision } = before.principal;
    if (expected && (uid !== expected.uid || fenceEpoch !== expected.fenceEpoch
        || healthConsentRevision !== expected.healthConsentRevision)) {
        throw new KindeCandidateBoundaryError();
    }
    const accountKey = await acquireCloudflareAccountKeyCandidate({
        expected: { uid, fenceEpoch, consentRevision: healthConsentRevision },
        purpose: 'sync', stillCurrent: current,
        csrfToken: () => fence.csrfToken, send,
    });

    try {
        if (!current()) throw new KindeCandidateBoundaryError();
        const transport = createCloudflareReplicaTransport(send);
        const checkpoint = await readAuthenticatedCloudflareCheckpoint(
            () => transport.scanAll(), uid, accountKey, healthConsentRevision, current,
        );
        if (!current() || checkpoint.fenceEpoch !== fenceEpoch) {
            throw new KindeCandidateBoundaryError();
        }

        // A complete AEAD scan alone cannot attest that this is still the
        // same identity and consent. Recheck them after all pages were opened.
        const after = await readKindeCandidateAccess(accessRequest);
        if (after.kind !== 'consent-confirmed' || after.principal.uid !== uid
            || after.principal.fenceEpoch !== fenceEpoch
            || after.principal.healthConsentRevision !== healthConsentRevision
            // A revised legal receipt at unchanged UID/epoch/revision must
            // not be installed from a mixed two-read server observation.
            || after.legalConsent.acceptedAt !== before.legalConsent.acceptedAt
            || after.legalConsent.privacyVersion !== before.legalConsent.privacyVersion
            || after.legalConsent.termsVersion !== before.legalConsent.termsVersion
            || !current()) {
            throw new KindeCandidateBoundaryError();
        }
        return { kind: 'checkpoint-observed', principal: after.principal,
            checkpoint, legalConsent: { ...after.legalConsent } };
    } finally {
        // A cloud key is a capability for this operation only.
        accountKey.fill(0);
    }
}
