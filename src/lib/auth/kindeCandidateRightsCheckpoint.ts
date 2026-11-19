import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
} from './kindeCandidateClient';
import { withKindeCandidateRightsKey } from './kindeCandidateRightsKey';
import {
    createCloudflareRightsScanTransport,
} from '../sync/cloudReplicaTransport';
import {
    readAuthenticatedCloudflareCheckpoint, type AuthenticatedCloudflareCheckpoint,
} from '../sync/cloudReplicaCheckpoint';

type Expected = Parameters<typeof withKindeCandidateRightsKey>[0]['expected'];

/**
 * Candidate rights-only read after health withdrawal. It never installs an
 * account owner, opens the device vault, mutates IndexedDB or grants fitness.
 * Every complete page is server-session/erasure-fenced and every ciphertext
 * is AEAD-opened with an operation-scoped ADK; partial results are discarded.
 * The consumer (future export UI) must be explicit and may not retain the key.
 */
export async function withKindeCandidateRightsCheckpoint<T>({
    expected, stillCurrent, consumeCheckpoint, send = fetch,
    browserCookies = () => document.cookie,
}: {
    expected: Readonly<Expected>;
    stillCurrent: () => boolean;
    consumeCheckpoint: (snapshot: AuthenticatedCloudflareCheckpoint,
        isCurrent: () => boolean) => Promise<T>;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<T> {
    if (typeof consumeCheckpoint !== 'function') throw new KindeCandidateBoundaryError();
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    return withKindeCandidateRightsKey({
        expected, stillCurrent: fence.stillCurrent, send, browserCookies,
        consumeKey: async (key, current) => {
            if (!current()) throw new KindeCandidateBoundaryError();
            const transport = createCloudflareRightsScanTransport(send);
            const snapshot = await readAuthenticatedCloudflareCheckpoint(
                () => transport.scanAll(fence.csrfToken),
                expected.uid, key, expected.healthConsentRevision, current,
            );
            // A renewed Auth epoch may be newer than the withdrawn subject.
            // The client must not accept a future epoch or another owner.
            if (!current() || snapshot.fenceEpoch < 1
                || snapshot.fenceEpoch > expected.fenceEpoch) {
                throw new KindeCandidateBoundaryError();
            }
            const result = await consumeCheckpoint(snapshot, current);
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        },
    });
}
