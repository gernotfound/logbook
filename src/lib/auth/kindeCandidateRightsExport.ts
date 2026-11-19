import { KindeCandidateBoundaryError } from './kindeCandidateClient';
import { formatKindeCandidateExportDocuments } from './kindeCandidateExportDocuments';
import { requestKindeCandidateJsonDownload } from './kindeCandidateJsonDownload';
import { withKindeCandidateRightsCheckpoint } from './kindeCandidateRightsCheckpoint';

type Options = Omit<Parameters<typeof withKindeCandidateRightsCheckpoint>[0], 'consumeCheckpoint'>;

const MAX_JSON_BYTES = 64 * 1024 * 1024;

interface KindeCandidateRightsJson {
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
            const documents = formatKindeCandidateExportDocuments(snapshot);
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
    return requestKindeCandidateJsonDownload({
        browserCookies, stillCurrent: options.stillCurrent,
        prepare: current => prepareKindeCandidateRightsJson({
            ...options, browserCookies, stillCurrent: current,
        }),
    });
}
