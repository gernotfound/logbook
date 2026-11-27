import equal from 'fast-deep-equal';
import { getCachedCatalog } from '../catalog/catalogService';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { createCloudflareReplicaTransport, type CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import {
    preflightRetiredReplicaRecovery, type RetiredReplicaRecoveryPreflight,
} from './retiredReplicaRecoveryPreflight';
import { unlockVaultForOwner } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];

function assertAccess(access: KindeCandidateAccess, expected: Principal,
    legal?: Confirmed['legalConsent']): asserts access is Confirmed {
    if (access.kind !== 'consent-confirmed' || access.principal.uid !== expected.uid
        || access.principal.fenceEpoch !== expected.fenceEpoch
        || access.principal.healthConsentRevision !== expected.healthConsentRevision
        || (legal && !equal(access.legalConsent, legal))) throw new KindeCandidateBoundaryError();
}

function assertControl(control: CloudReplicaControlSnapshot, expected: Principal): void {
    if (control.uid !== expected.uid || control.fenceEpoch !== expected.fenceEpoch
        || control.consentRevision !== expected.healthConsentRevision) throw new KindeCandidateBoundaryError();
}

/**
 * Candidate-only read of an old replica's causal baseline. The caller owns an
 * already authorized ADK and must wipe it; this boundary deliberately cannot
 * call /v1/cloud-key/sync, which may provision a missing key. Even a matching
 * baseline is provisional: no new actor, claim, delivery or ACK is permitted.
 */
export async function inspectKindeCandidateRetiredReplicaPreflight({
    expected, accountKey, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    accountKey: Uint8Array;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<RetiredReplicaRecoveryPreflight> {
    if (!(accountKey instanceof Uint8Array) || accountKey.length !== 32) throw new KindeCandidateBoundaryError();
    const owner = userOwner(expected.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            if (!fence.stillCurrent() || !isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision)) return false;
            const guest = readBrowserValueStrict('logbook_is_guest');
            return guest === null || guest === 'false';
        } catch { return false; }
    };
    const requireCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    requireCurrent();
    const request = { stillCurrent: current, browserCookies, send };
    const first = await readKindeCandidateAccess(request);
    requireCurrent();
    assertAccess(first, expected);

    // Never create a device key or adopt an empty archive over a missing vault.
    const grant = await unlockVaultForOwner(owner, current);
    const scoped = () => current() && grant.isCurrent();
    const requireScoped = () => { if (!scoped()) throw new KindeCandidateBoundaryError(); };
    try {
        requireScoped();
        const local = await readLocal(owner);
        requireScoped();
        if (!local || local.consentRevision !== expected.healthConsentRevision
            || !equal(local.data.legalConsent, first.legalConsent) || local.cloudIntegrityFence) {
            throw new KindeCandidateBoundaryError();
        }

        const transport = createCloudflareReplicaTransport(send);
        const beforeControl = await transport.control();
        requireScoped();
        assertControl(beforeControl, expected);
        const checkpoint = await readAuthenticatedCloudflareCheckpoint(
            () => transport.scanAll(), expected.uid, accountKey,
            expected.healthConsentRevision, scoped,
        );
        requireScoped();
        if (checkpoint.revision !== beforeControl.revision
            || checkpoint.fenceEpoch !== beforeControl.fenceEpoch
            || checkpoint.consentRevision !== beforeControl.consentRevision) {
            throw new KindeCandidateBoundaryError();
        }
        const afterScan = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        requireScoped();
        assertAccess(afterScan, expected, first.legalConsent);
        const afterControl = await transport.control();
        requireScoped();
        assertControl(afterControl, expected);
        if (!equal(beforeControl, afterControl)) throw new KindeCandidateBoundaryError();

        const catalog = await getCachedCatalog();
        requireScoped();
        const latest = await readLocal(owner);
        if (!latest || !equal(local, latest)) throw new KindeCandidateBoundaryError();
        requireScoped();
        const last = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        requireScoped();
        assertAccess(last, expected, first.legalConsent);
        return preflightRetiredReplicaRecovery(expected.uid, latest, checkpoint, afterControl, catalog);
    } finally {
        grant.release();
    }
}
