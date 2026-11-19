import equal from 'fast-deep-equal';
import { CURRENT_DATA_SCHEMA } from '../schemaEvolution';
import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError } from './kindeCandidateClient';
import { withKindeCandidateRightsCheckpoint } from './kindeCandidateRightsCheckpoint';

type Options = Omit<Parameters<typeof withKindeCandidateRightsCheckpoint>[0], 'consumeCheckpoint'>;

const DOCUMENT_PATH = /^(?:(?:history_months|nutrition_months)\/\d{4}-(?:0[1-9]|1[0-2]))?$/;
const MAX_JSON_BYTES = 64 * 1024 * 1024;

export interface KindeCandidateRightsJson {
    filename: string;
    json: string;
    documentCount: number;
    cloudRevision: number;
}

/**
 * This is an explicit data-access export, NOT a restorable Backup Schema 3.
 * After withdrawal the erasure runner may already have removed documents;
 * the pinned sync revision does not prove that the original cloud archive
 * still exists. Device-only drafts and unsent journal entries are absent.
 * No plaintext is persisted or downloaded until every returned cloud
 * ciphertext and the original browser session have been verified.
 */
export async function prepareKindeCandidateRightsJson({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: Options): Promise<KindeCandidateRightsJson> {
    return withKindeCandidateRightsCheckpoint({
        expected, stillCurrent, send, browserCookies,
        consumeCheckpoint: async (snapshot, current) => {
            if (!current()) throw new KindeCandidateBoundaryError();
            const documents = [...snapshot.documents.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([path, record]) => {
                    if (!DOCUMENT_PATH.test(path) || record.dataSchemaVersion !== CURRENT_DATA_SCHEMA) {
                        throw new KindeCandidateBoundaryError();
                    }
                    return { path, dataSchemaVersion: record.dataSchemaVersion,
                        business: record.business, sync: record.sync };
                });
            const exportedAt = new Date().toISOString();
            const payload = {
                format: 'thelogbook-cloud-rights-export',
                version: 1,
                type: 'rights-only',
                owner: 'user:' + expected.uid,
                exportedAt,
                cloud: {
                    revision: snapshot.revision,
                    fenceEpoch: snapshot.fenceEpoch,
                    consentRevision: snapshot.consentRevision,
                },
                coverage: {
                    scope: 'cloud-documents-still-readable',
                    completeness: 'not-proven-after-withdrawal',
                    includesDeviceData: false,
                    includesPendingJournal: false,
                    includesDeviceDrafts: false,
                    restorableBackup: false,
                },
                documents,
            };
            const json = JSON.stringify(payload, null, 2);
            if (typeof json !== 'string'
                || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
                || !equal(JSON.parse(json).documents, documents)
                || !current()) {
                throw new KindeCandidateBoundaryError();
            }
            return {
                filename: 'thelogbook_diritti_cloud_' + exportedAt.slice(0, 10) + '.json',
                json, documentCount: documents.length, cloudRevision: snapshot.revision,
            };
        },
    });
}

/**
 * The browser controls whether the user actually saves the file. A click on
 * a temporary object URL is not evidence of a successful saved backup.
 */
export async function requestKindeCandidateRightsJsonDownload(options: Options): Promise<void> {
    const browserCookies = options.browserCookies ?? (() => document.cookie);
    const fence = captureKindeCandidateSessionFence({
        stillCurrent: options.stillCurrent, browserCookies,
    });
    const result = await prepareKindeCandidateRightsJson({
        ...options, stillCurrent: fence.stillCurrent, browserCookies,
    });
    if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
    const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
        if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        try {
            if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
            link.click();
        } finally {
            link.remove();
        }
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
