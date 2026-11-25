import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { createCloudflareReplicaTransport, type CloudReplicaControlSnapshot } from './cloudReplicaTransport';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];

export type KindeCandidateReplicaRegistryObservation = {
    kind: 'replica-registry-observed';
    control: CloudReplicaControlSnapshot;
};

/**
 * Read-only account membership inspection. A sixth device must be able to
 * observe a full registry without first claiming a slot, creating a device
 * vault or requesting the account data key. A stable, owner-bound D1 control
 * and two matching consent observations are required; this grants neither
 * replica membership nor permission to retire one.
 */
export async function inspectKindeCandidateReplicaRegistry({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<KindeCandidateReplicaRegistryObservation> {
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            if (!fence.stillCurrent()) return false;
            const guestFlag = readBrowserValueStrict('logbook_is_guest');
            return guestFlag === null || guestFlag === 'false';
        } catch { return false; }
    };
    const assertCurrent = () => {
        if (!current()) throw new KindeCandidateBoundaryError();
    };
    const assertAccess: (access: KindeCandidateAccess) => asserts access is Confirmed = access => {
        if (access.kind !== 'consent-confirmed'
            || access.principal.uid !== expected.uid
            || access.principal.fenceEpoch !== expected.fenceEpoch
            || access.principal.healthConsentRevision !== expected.healthConsentRevision) {
            throw new KindeCandidateBoundaryError();
        }
    };
    const assertControl = (control: CloudReplicaControlSnapshot) => {
        if (control.uid !== expected.uid || control.fenceEpoch !== expected.fenceEpoch
            || control.consentRevision !== expected.healthConsentRevision) {
            throw new KindeCandidateBoundaryError();
        }
    };

    assertCurrent();
    const request = { send, stillCurrent: current, browserCookies };
    const before = await readKindeCandidateAccess(request);
    assertCurrent();
    assertAccess(before);

    const transport = createCloudflareReplicaTransport(send);
    const control = await transport.control();
    assertCurrent();
    assertControl(control);

    const after = await readKindeCandidateAccess(request);
    assertCurrent();
    assertAccess(after);
    if (!equal(before.legalConsent, after.legalConsent)) throw new KindeCandidateBoundaryError();

    // A write racing the two observations must not be rendered as a current
    // registry; the caller may explicitly retry rather than use stale slots.
    const again = await transport.control();
    assertCurrent();
    assertControl(again);
    if (!equal(control, again)) throw new KindeCandidateBoundaryError();

    return { kind: 'replica-registry-observed', control: again };
}
