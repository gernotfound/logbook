import { CURRENT_DATA_SCHEMA } from '../schemaEvolution';
import type { AuthenticatedCloudflareCheckpoint } from '../sync/cloudReplicaCheckpoint';
import { KindeCandidateBoundaryError } from './kindeCandidateClient';

/**
 * Both active-consent and withdrawn-rights exports preserve the same
 * authenticated business and causal metadata without converting it into a
 * potentially lossy UserData projection or pretending it is a cloud ACK.
 */
export function formatKindeCandidateExportDocuments(snapshot: AuthenticatedCloudflareCheckpoint) {
    const pathPattern = /^(?:(?:history_months|nutrition_months)\/\d{4}-(?:0[1-9]|1[0-2]))?$/;
    return [...snapshot.documents.entries()]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([path, record]) => {
            if (!pathPattern.test(path) || record.dataSchemaVersion !== CURRENT_DATA_SCHEMA) {
                throw new KindeCandidateBoundaryError();
            }
            return { path, dataSchemaVersion: record.dataSchemaVersion,
                business: record.business, sync: record.sync };
        });
}
