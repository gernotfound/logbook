import equal from 'fast-deep-equal';
import { createBackup, decodeImport, type BackupPayload } from '../backup';
import { getCachedCatalog } from '../catalog/catalogService';
import type { CachedGlobalCatalog, UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { CURRENT_DATA_SCHEMA } from '../schemaEvolution';
import { captureKindeCandidatePreWithdrawalSources } from './kindeCandidatePreWithdrawalExport';
import { requestKindeCandidateJsonDownload } from './kindeCandidateJsonDownload';
import { KindeCandidateBoundaryError } from './kindeCandidateClient';
import { assertCloudBusinessPreserved } from '../sync/cloudBusinessIntegrity';
import { applyRemoteDocuments, projectDocuments, rootDocument, type DocumentData } from '../sync/documentProjection';
import { requireCompleteHistoryMonthDocument, requireCompleteNutritionMonthDocument } from '../sync/monthlyIntegrity';
import { applySemanticOperations, coversVectorClock, parseSyncMeta, type SyncMeta } from '../sync/semanticProjection';
import { findLossyNormalization } from '../sync/businessNormalizationIntegrity';

type Sources = Awaited<ReturnType<typeof captureKindeCandidatePreWithdrawalSources>>;
type Options = Parameters<typeof captureKindeCandidatePreWithdrawalSources>[0];
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MONTH_PATH = /^(history_months|nutrition_months)\/(\d{4}-(?:0[1-9]|1[0-2]))$/;

function requireNoUnresolvedTransition(sources: Sources): void {
    const { envelope, observed } = sources;
    if (!envelope) return;
    if (envelope.consentRevision !== observed.principal.healthConsentRevision
        || !equal(envelope.data.legalConsent, observed.legalConsent)
        || envelope.cloudIntegrityFence || envelope.cloudflareDelivery
        || envelope.cloudflareReplicaClaim || envelope.cloudflareReplicaRetirement
        || (envelope.archivedConsentJournals?.length ?? 0) > 0) {
        throw new KindeCandidateBoundaryError();
    }
}

/**
 * The same semantic reducer as durable D1 delivery replays only the local
 * journal into an authenticated cloud checkpoint. A complete Backup Schema 3
 * is allowed only when every locally visible business value survives the
 * merged result AND each affected document matches the local pending result.
 * Otherwise the independent evidence-only export remains available.
 *
 * The local envelope, staged operation witnesses and raw device drafts remain
 * recovery evidence, not installed sync ACKs or automatically replayed drafts.
 */
export function composeKindeCandidatePortableBackup(sources: Sources, catalog: CachedGlobalCatalog): BackupPayload {
    if (!sources.isCurrent()) throw new KindeCandidateBoundaryError();
    requireNoUnresolvedTransition(sources);
    const { owner, envelope, witnesses, observed } = sources;
    const { checkpoint, legalConsent } = observed;
    const businessDocs = new Map<string, DocumentData>();
    const rawDocs: Record<string, unknown> = {};
    const remoteMeta: Record<string, SyncMeta> = {};
    const months = new Set<string>();

    for (const [path, record] of checkpoint.documents) {
        if ((path !== '' && !MONTH_PATH.test(path)) || record.dataSchemaVersion !== CURRENT_DATA_SCHEMA) {
            throw new KindeCandidateBoundaryError();
        }
        const match = MONTH_PATH.exec(path);
        const business = match?.[1] === 'history_months'
            ? requireCompleteHistoryMonthDocument(match[2], record.business)
            : match?.[1] === 'nutrition_months'
                ? requireCompleteNutritionMonthDocument(match[2], record.business)
                : record.business;
        const checked = path === ''
            ? rootDocument(UserDataSchema.parse(business) as unknown as UserData)
            : business;
        if (path === '' && record.business.nutritionPlanning === null) {
            checked.nutritionPlanning = null;
        }
        assertCloudBusinessPreserved(path, record.business, checked);
        businessDocs.set(path, business);
        const sync = parseSyncMeta(record.sync);
        Object.defineProperty(remoteMeta, path, {
            value: sync, enumerable: true, configurable: true, writable: true,
        });
        Object.defineProperty(rawDocs, path, {
            value: structuredClone({ ...record.business, _schemaVersion: record.dataSchemaVersion, _sync: sync }),
            enumerable: true, configurable: true, writable: true,
        });
        if (match) months.add(match[2]);
    }

    if (envelope) {
        for (const [path, localMeta] of Object.entries(envelope.syncMetaByDocument)) {
            if (!Object.hasOwn(remoteMeta, path) || !coversVectorClock(remoteMeta[path].clock, localMeta.clock)) {
                throw new KindeCandidateBoundaryError();
            }
        }
    }
    const empty = UserDataSchema.parse({}) as unknown as UserData;
    const cloud = applyRemoteDocuments(empty, businessDocs, catalog);
    const base = { ...cloud, legalConsent };
    const cloudDocuments = projectDocuments(base, catalog);
    let data: UserData = base;
    if (envelope?.pending.length) {
        const { documents } = applySemanticOperations(cloudDocuments, envelope.pending, remoteMeta);
        data = applyRemoteDocuments(base, documents, catalog);
        data.legalConsent = legalConsent;

        // A rejected guard, stale writer or a remote winner cannot silently
        // displace the owner's pending visible state in a claimed restorable
        // backup. Different fields on the same document may legitimately have
        // moved on another device: conservatively fall back to raw evidence.
        const localDocuments = projectDocuments(envelope.data, catalog);
        for (const path of new Set(envelope.pending.map(operation => operation.docPath))) {
            if (!equal(localDocuments.get(path) ?? {}, projectDocuments(data, catalog).get(path) ?? {})) {
                throw new KindeCandidateBoundaryError();
            }
        }
    }
    if (envelope) {
        // The journal may be empty while local-only work or recovery state is
        // not represented by any cloud document. Do not label it complete.
        const localBusiness = { ...envelope.data, legalConsent };
        const comparable = { ...data, pendingConflicts: envelope.data.pendingConflicts };
        if (findLossyNormalization(localBusiness, comparable)) {
            throw new KindeCandidateBoundaryError();
        }
        data.pendingConflicts = envelope.data.pendingConflicts;
    }
    data.legalConsent = legalConsent;
    const validated = UserDataSchema.parse(data) as unknown as UserData;
    if (findLossyNormalization(data, validated)) throw new KindeCandidateBoundaryError();
    const coverage = {
        scope: 'cloud-and-device' as const, months: [...months].sort(),
        readStartedAt: sources.readStartedAt, readCompletedAt: sources.readCompletedAt,
    };
    const backup = createBackup(validated, owner, coverage, {
        envelope, device: witnesses, cloudDocuments: rawDocs,
        // Non-atomic sources must retain their respective evidence even after
        // conversion into a portable business dataset.
        cloudCheckpoint: { revision: checkpoint.revision,
            fenceEpoch: checkpoint.fenceEpoch, consentRevision: checkpoint.consentRevision },
    });
    // Exercise the production importer contract on the exact object that
    // will be serialized, not just a second internal schema projection.
    decodeImport(backup, owner);
    if (!sources.isCurrent()) throw new KindeCandidateBoundaryError();
    return backup;
}

export async function prepareKindeCandidatePortableBackupJson(options: Options): Promise<{
    filename: string; json: string; backup: BackupPayload;
}> {
    const sources = await captureKindeCandidatePreWithdrawalSources(options);
    if (!sources.isCurrent()) throw new KindeCandidateBoundaryError();
    const catalog = await getCachedCatalog();
    if (!sources.isCurrent()) throw new KindeCandidateBoundaryError();
    const backup = composeKindeCandidatePortableBackup(sources, catalog);
    const json = JSON.stringify(backup, null, 2);
    if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
        || !sources.isCurrent()) throw new KindeCandidateBoundaryError();
    // The stored format is the same validated object; truncation never creates
    // a file that can be mislabeled as complete.
    return {
        filename: 'thelogbook_backup_prima_revoca_' + backup.exportedAt.slice(0, 10) + '.json',
        json, backup,
    };
}

export async function requestKindeCandidatePortableBackupDownload(options: Options): Promise<void> {
    const browserCookies = options.browserCookies ?? (() => document.cookie);
    return requestKindeCandidateJsonDownload({
        browserCookies, stillCurrent: options.stillCurrent,
        prepare: current => prepareKindeCandidatePortableBackupJson({
            ...options, browserCookies, stillCurrent: current,
        }),
    });
}
