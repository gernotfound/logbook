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
    stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    stillCurrent: () => boolean;
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

    const before = await readKindeCandidateAccess({ send, stillCurrent: current });
    if (before.kind !== 'consent-confirmed' || !current()) {
        throw new KindeCandidateBoundaryError();
    }
    const { uid, fenceEpoch, healthConsentRevision } = before.principal;
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
        const after = await readKindeCandidateAccess({ send, stillCurrent: current });
        if (after.kind !== 'consent-confirmed' || after.principal.uid !== uid
            || after.principal.fenceEpoch !== fenceEpoch
            || after.principal.healthConsentRevision !== healthConsentRevision
            || !current()) {
            throw new KindeCandidateBoundaryError();
        }
        return { kind: 'checkpoint-observed', principal: after.principal, checkpoint };
    } finally {
        // A cloud key is a capability for this operation only.
        accountKey.fill(0);
    }
}
