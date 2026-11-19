import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
} from './kindeCandidateClient';
import { readKindeCandidateIdentity } from './kindeCandidateIdentity';
import { acquireCloudflareAccountKeyCandidate } from '../sync/cloudflareAccountKeyCandidate';
import { readBrowserValueStrict } from '../sync/browserStorage';

type Expected = { uid: string; fenceEpoch: number; healthConsentRevision: 1 };

/**
 * An existing ADK may be read for rights after withdrawal, without granting
 * fitness, opening a device vault or provisioning a replacement cloud key.
 * The server enforces the rights-only SQL status and original acceptance;
 * this client independently pins the browser session, even if email
 * verification has since been lost. Key bytes never outlive the callback.
 *
 * This is only key custody; export of encrypted cloud documents, complete
 * rights delivery and erasure-status recovery require separate boundaries.
 */
export async function withKindeCandidateRightsKey<T>({
    expected, stillCurrent, useKey, send = fetch,
    browserCookies = () => document.cookie,
}: {
    expected: Readonly<Expected>;
    stillCurrent: () => boolean;
    useKey: (key: Uint8Array, stillCurrent: () => boolean) => Promise<T>;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<T> {
    if (expected?.healthConsentRevision !== 1
        || typeof expected.uid !== 'string' || !/^k_[A-Za-z0-9_-]{43}$/.test(expected.uid)
        || !Number.isSafeInteger(expected.fenceEpoch) || expected.fenceEpoch < 1
        || typeof useKey !== 'function') throw new KindeCandidateBoundaryError();
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            return fence.stillCurrent()
                && (readBrowserValueStrict('logbook_is_guest') ?? 'false') === 'false';
        } catch { return false; }
    };
    const assertCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    const checkPrincipal = async () => {
        const identity = await readKindeCandidateIdentity({
            stillCurrent: current, send, browserCookies,
        });
        assertCurrent();
        if (identity.kind === 'signed-out'
            || identity.principal.uid !== expected.uid
            || identity.principal.fenceEpoch !== expected.fenceEpoch
            || identity.principal.healthConsentRevision !== 1) {
            throw new KindeCandidateBoundaryError();
        }
    };
    assertCurrent();
    await checkPrincipal();
    let key: Uint8Array | undefined;
    try {
        key = await acquireCloudflareAccountKeyCandidate({
            expected: { uid: expected.uid, fenceEpoch: expected.fenceEpoch, consentRevision: 1 },
            purpose: 'rights-export', stillCurrent: current,
            csrfToken: () => fence.csrfToken, send,
        });
        assertCurrent();
        // Re-reading the session after the key request prevents a result
        // from a replaced login from being used to decrypt an archive.
        await checkPrincipal();
        const result = await useKey(key, current);
        assertCurrent();
        await checkPrincipal();
        return result;
    } finally {
        key?.fill(0);
    }
}
