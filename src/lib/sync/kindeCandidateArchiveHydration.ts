import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import { getCachedCatalog } from '../catalog/catalogService';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { readBrowserValueStrict } from './browserStorage';
import { applyRemoteDocuments, type DocumentData } from './documentProjection';
import { inspectKindeCandidateCloudCheckpoint, type KindeCandidateCheckpointObservation } from './kindeCandidateCheckpointBridge';
import { readLocal } from './localArchiveBootstrap';
import { hydrateLocal } from './localCloudHydration';
import { userOwner } from './owner';
import { requireUnlockedLocalKey } from './secureArchiveSession';

/**
 * The caller must already own the local vault and pin the account incarnation.
 * Hydration commits a baseline, without treating the scan as a replica lease
 * or an ACK. Compare the local revision again inside the IndexedDB update.
 */
export async function hydrateKindeCandidateArchive({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<KindeCandidateCheckpointObservation['principal']>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}) {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
    const deviceKey = requireUnlockedLocalKey(owner);
    const current = () => {
        try {
            if (!fence.stillCurrent() || requireUnlockedLocalKey(owner) !== deviceKey) return false;
            const guest = readBrowserValueStrict('logbook_is_guest');
            return guest === null || guest === 'false';
        } catch { return false; }
    };
    if (!current()) throw new KindeCandidateBoundaryError();
    const local = await readLocal(owner);
    const { checkpoint, legalConsent } = await inspectKindeCandidateCloudCheckpoint({
        expected: principal, stillCurrent: current, send, browserCookies,
    });
    const catalog = await getCachedCatalog();
    if (!current()) throw new KindeCandidateBoundaryError();
    const business = new Map<string, DocumentData>();
    const evidence = new Map<string, DocumentData>();
    const months = new Set<string>();
    for (const [path, document] of checkpoint.documents) {
        business.set(path, document.business);
        evidence.set(path, { _sync: document.sync });
        if (path !== '') months.add(path.split('/')[1]);
    }
    // The signed consent row is authoritative for the account's legal choice;
    // an empty or stale encrypted root is not evidence of a new acceptance.
    // Install it in the hydrated baseline, never as a fabricated journal ACK.
    const data = {
        ...applyRemoteDocuments(UserDataSchema.parse({}) as unknown as UserData, business, catalog),
        legalConsent,
    };
    const envelope = await hydrateLocal(owner, data, [...months], evidence, 'all', current, {
        consentRevision: checkpoint.consentRevision, localRevision: local?.revision ?? null,
    });
    if (!current()) throw new KindeCandidateBoundaryError();
    return { envelope, checkpointRevision: checkpoint.revision };
}
