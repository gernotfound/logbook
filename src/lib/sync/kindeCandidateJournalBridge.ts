import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess } from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { readLocal } from './localRepository';
import { userOwner } from './owner';
import { acquireCloudflareAccountKeyCandidate } from './cloudflareAccountKeyCandidate';
import { deliverCloudflareJournalCandidate } from './cloudflareJournalCandidate';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';

type JournalOutcome = Awaited<ReturnType<typeof deliverCloudflareJournalCandidate>>;
/**
 * Pre-activation Kinde → consent → ADK → durable D1 journal bridge.
 *
 * The caller must supply a realm/session-generation guard; this boundary also
 * pins the random D1 CSRF cookie and refuses a simultaneous guest archive.
 * Neither the Worker response nor a UID alone authorizes an owner switch.
 * Existing durable delivery code alone decides when a receipt permits ACK.
 *
 * This module is NOT wired to the Firebase AuthProvider or public routes.
 * It never provisions an account vault, adopts a replica or clears local data.
 */
export async function deliverKindeCandidateJournal({
    stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<JournalOutcome> {
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            if (!fence.stillCurrent()) return false;
            const guestFlag = readBrowserValueStrict('logbook_is_guest');
            return guestFlag === null || guestFlag === 'false';
        } catch { return false; }
    };
    if (!current()) throw new KindeCandidateBoundaryError();

    // A live, signed first-consent check is necessary even when there is
    // already an encrypted local delivery intent.
    const access = await readKindeCandidateAccess({ send, stillCurrent: current });
    if (access.kind !== 'consent-confirmed' || !current()) {
        throw new KindeCandidateBoundaryError();
    }
    const { uid, fenceEpoch, healthConsentRevision } = access.principal;
    const owner = userOwner(uid);
    const local = await readLocal(owner);
    if (!current() || !local || local.cloudIntegrityFence
        || local.cloudflareReplicaClaim || local.cloudflareReplicaRetirement) {
        throw new KindeCandidateBoundaryError();
    }
    // No key request, storage mutation or fake cloud-success state for an
    // empty local journal. Hydration and replica claim have separate gates.
    if (!local.cloudflareDelivery && local.pending.length === 0) return 'idle';

    const key = await acquireCloudflareAccountKeyCandidate({
        expected: { uid, fenceEpoch, consentRevision: healthConsentRevision },
        purpose: 'sync', stillCurrent: current, csrfToken: () => fence.csrfToken, send,
    });
    try {
        if (!current()) throw new KindeCandidateBoundaryError();
        const result = await deliverCloudflareJournalCandidate(
            owner, key, createCloudflareReplicaTransport(send), fence.csrfToken, current,
        );
        if (!current()) throw new KindeCandidateBoundaryError();
        return result;
    } finally {
        // The ADK is an operation-scoped capability; never retain it in
        // IndexedDB, React or a module singleton, including on lost ACK.
        key.fill(0);
    }
}
