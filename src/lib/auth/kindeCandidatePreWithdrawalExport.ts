import equal from 'fast-deep-equal';
import { readStableDeviceRecovery } from '../backupDeviceSnapshot';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
} from './kindeCandidateClient';
import { formatKindeCandidateExportDocuments } from './kindeCandidateExportDocuments';
import { requestKindeCandidateJsonDownload } from './kindeCandidateJsonDownload';
import {
    inspectKindeCandidateCloudCheckpoint, type KindeCandidateCheckpointObservation,
} from '../sync/kindeCandidateCheckpointBridge';
import { isKindeAccountLocalFitnessClear } from '../sync/kindeOwnerLocalFitnessFence';
import { readLocal } from '../sync/localArchiveBootstrap';
import { userOwner } from '../sync/owner';
import { requireUnlockedLocalKey } from '../sync/secureArchiveSession';

type Principal = KindeCandidateCheckpointObservation['principal'];
type Options = {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
};

const MAX_JSON_BYTES = 64 * 1024 * 1024;

/**
 * Read-only candidate for an EXPLICIT export BEFORE health withdrawal.
 * Never synthesizes a merged business state: the signed-off cloud checkpoint
 * and the independently durable local data, journal, recovery witnesses and
 * in-flight intents have different causal provenance.
 *
 * The resulting evidence is not a restorable Backup Schema 3; double reads
 * detect observable concurrent edits, but cannot provide a cross-tab atomic
 * snapshot of localStorage, IndexedDB and D1. A missing or locked vault is
 * not permission to create a new one or pretend the device is empty.
 */
export async function captureKindeCandidatePreWithdrawalSources({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: Options) {
    const owner = userOwner(expected.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const deviceKey = requireUnlockedLocalKey(owner);
    const current = () => {
        try {
            return fence.stillCurrent()
                && isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision)
                && requireUnlockedLocalKey(owner) === deviceKey;
        } catch { return false; }
    };
    const check = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    check();

    const readStartedAt = new Date().toISOString();
    const before = await readLocal(owner);
    check();
    const witnesses = readStableDeviceRecovery(owner);
    check();
    const observed = await inspectKindeCandidateCloudCheckpoint({
        expected, stillCurrent: current, send, browserCookies,
    });
    check();
    if (before && (before.consentRevision !== expected.healthConsentRevision
        || !equal(before.data.legalConsent, observed.legalConsent))) {
        throw new KindeCandidateBoundaryError();
    }

    // Retry belongs to the explicit user action, never a silent reset or
    // adoption of a competing write that changed during remote pagination.
    const after = await readLocal(owner);
    check();
    if (!equal(before, after) || !equal(witnesses, readStableDeviceRecovery(owner))) {
        throw new KindeCandidateBoundaryError();
    }
    check();

    const readCompletedAt = new Date().toISOString();
    return { owner, envelope: before, witnesses, observed, isCurrent: current,
        readStartedAt, readCompletedAt };
}

/** Existing evidence-only export retains cloud and device provenance unchanged. */
export async function prepareKindeCandidatePreWithdrawalJson(options: Options): Promise<{
    filename: string; json: string; cloudDocumentCount: number;
    deviceWitnessCount: number; pendingOperationCount: number;
}> {
    const { owner, envelope: before, witnesses, observed, isCurrent } =
        await captureKindeCandidatePreWithdrawalSources(options);
    const exportedAt = new Date().toISOString();
    const cloudDocuments = formatKindeCandidateExportDocuments(observed.checkpoint);
    const payload = {
        format: 'thelogbook-prewithdrawal-evidence', version: 1,
        type: 'pre-withdrawal', owner, exportedAt,
        coverage: {
            scope: 'separate-cloud-and-device-evidence',
            cloudCompleteAtObservedRevision: true,
            deviceReadsStableAtObservation: true,
            atomicAcrossSources: false,
            restorableBackup: false,
            containsDeviceOnlyDrafts: Object.keys(witnesses).some(name => name.startsWith('draft:')
                || name === 'draft_exercise' || name === 'draft_routine'),
            containsPendingJournal: Boolean(before?.pending.length),
        },
        cloud: {
            revision: observed.checkpoint.revision,
            fenceEpoch: observed.checkpoint.fenceEpoch,
            consentRevision: observed.checkpoint.consentRevision,
            documents: cloudDocuments,
        },
        device: {
            envelope: before ?? null,
            recovery: witnesses,
        },
    };
    const json = JSON.stringify(payload, null, 2);
    if (typeof json !== 'string'
        || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
        || !isCurrent()) throw new KindeCandidateBoundaryError();
    return {
        filename: 'thelogbook_prima_della_revoca_' + exportedAt.slice(0, 10) + '.json',
        json, cloudDocumentCount: cloudDocuments.length,
        deviceWitnessCount: Object.keys(witnesses).length,
        pendingOperationCount: before?.pending.length ?? 0,
    };
}

export async function requestKindeCandidatePreWithdrawalJsonDownload(options: Options): Promise<void> {
    const browserCookies = options.browserCookies ?? (() => document.cookie);
    return requestKindeCandidateJsonDownload({
        browserCookies, stillCurrent: options.stillCurrent,
        prepare: current => prepareKindeCandidatePreWithdrawalJson({
            ...options, browserCookies, stillCurrent: current,
        }),
    });
}
