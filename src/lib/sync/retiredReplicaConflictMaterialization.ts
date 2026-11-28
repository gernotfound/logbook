import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import { UserDataSchema } from '../schema';
import { NutritionDaySchema } from '../schemas/schema_nutrition';
import { WorkoutSessionSchema } from '../schemas/schema_training';
import { findLossyNormalization } from './businessNormalizationIntegrity';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { projectDocuments, type DocumentData } from './documentProjection';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { parseRetiredReplicaConflictDecisions, type RetiredReplicaConflictDecision } from './retiredReplicaConflictDecisionRecord';
import { parseRetiredReplicaConflictCapsule, type RetiredConflictKind } from './retiredReplicaConflictRecord';
import { previewRetiredReplicaConflictResolution } from './retiredReplicaConflictResolution';
import { preflightRetiredReplicaRecovery } from './retiredReplicaRecoveryPreflight';
import { parseSyncMeta } from './semanticProjection';

export type RetiredReplicaResolvedEntity = {
    kind: RetiredConflictKind;
    entityId: string;
    choice: RetiredReplicaConflictDecision['choice'];
    docPath: string | null;
    value: unknown;
};

function located(
    cloud: AuthenticatedCloudflareCheckpoint, kind: RetiredConflictKind, id: string,
): { docPath: string; value: unknown; sync: unknown } | null {
    const collection = kind === 'history' ? 'history_months/' : 'nutrition_months/';
    if (kind === 'active-workout') {
        const root = cloud.documents.get('');
        return root && Object.hasOwn(root.business, 'activeWorkout')
            ? { docPath: '', value: root.business.activeWorkout, sync: parseSyncMeta(root.sync) } : null;
    }
    let result: ReturnType<typeof located> = null;
    for (const [path, document] of cloud.documents) {
        if (!path.startsWith(collection) || !Object.hasOwn(document.business, id)) continue;
        if (result) throw new Error('Identità business duplicata nello snapshot autenticato.');
        result = { docPath: path, value: document.business[id], sync: parseSyncMeta(document.sync) };
    }
    return result;
}

function validSelected(kind: RetiredConflictKind, id: string, path: string | null, value: unknown): boolean {
    if (path === null) return value === null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (kind === 'nutrition') {
        const parsed = NutritionDaySchema.safeParse(value);
        return path === `nutrition_months/${id.slice(0, 7)}` && parsed.success
            && parsed.data.date === id && !findLossyNormalization(value, parsed.data);
    }
    if (kind === 'history') {
        const parsed = WorkoutSessionSchema.safeParse(value);
        return parsed.success && parsed.data.id === id && typeof parsed.data.date === 'string'
            && path === `history_months/${parsed.data.date.slice(0, 7)}`
            && !findLossyNormalization(value, parsed.data);
    }
    const parsed = UserDataSchema.safeParse({ activeWorkout: value });
    return path === '' && parsed.success && !findLossyNormalization(value, parsed.data.activeWorkout);
}

/**
 * Materialize only an owner-selected, historical candidate. The full AEAD
 * snapshot supplied by the caller must still match the original capsule; a later writer needs NEW
 * control/receipt/session and IndexedDB CAS proofs before re-sequencing.
 * Neither this output nor its cloud metadata grants ACK or write authority.
 */
export function materializeRetiredReplicaConflictChoices(
    local: LocalEnvelope,
    cloud: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot,
    catalog: CachedGlobalCatalog,
): RetiredReplicaResolvedEntity[] {
    const source = local.retiredReplicaConflictCapsule;
    if (!source || local.cloudIntegrityFence || local.cloudflareDelivery || local.cloudflareReplicaClaim
        || local.cloudflareReplicaRetirement || local.cloudflareReplicaCancellation
        || local.owner !== source.owner || !equal(local.replica, source.sourceReplica)
        || !equal(local.clock, source.sourceClock) || !equal(local.pending, source.sourcePending)
        || local.consentRevision !== source.consentRevision
        || control.uid !== source.owner.slice(5) || control.consentRevision !== source.consentRevision
        || control.fenceEpoch !== source.fenceEpoch || control.revision !== source.cloudRevision
        || cloud.revision !== source.cloudRevision || cloud.fenceEpoch !== source.fenceEpoch
        || cloud.consentRevision !== source.consentRevision) {
        throw new Error('Provenienza offline o snapshot cloud cambiati: nessuna scelta applicata.');
    }
    const capsule = parseRetiredReplicaConflictCapsule(source, local.owner);
    const proof = preflightRetiredReplicaRecovery(control.uid, local, cloud, control, catalog);
    if (proof.kind !== 'reconciliation-required' || proof.reason !== 'cloud-diverged'
        || proof.evidence.entitiesWithCompetingVersions !== capsule.entries.length) {
        // This also rejects an old sequence that might already have committed
        // without its ACK. A copied business value cannot settle that ambiguity.
        throw new Error('Prova causale del journal offline non sufficiente.');
    }
    const choices = parseRetiredReplicaConflictDecisions(local.retiredReplicaConflictDecisions, capsule);
    if (!choices || choices.length !== capsule.entries.length) {
        throw new Error('Conflitti non tutti risolti esplicitamente.');
    }
    const base = projectDocuments(local.baseline, catalog);
    const desired = projectDocuments(local.data, catalog);
    for (const document of capsule.sourceDocuments) {
        if (!equal(base.get(document.path) ?? null, document.baseline)
            || !equal(desired.get(document.path) ?? null, document.device)
            || !equal(local.syncMetaByDocument[document.path] ?? null, document.sync)) {
            throw new Error('Journal o dati del dispositivo cambiati dopo la cattura.');
        }
    }
    const proposals = previewRetiredReplicaConflictResolution(capsule);
    return capsule.entries.map((entry, index) => {
        const choice = choices.find(item => item.kind === entry.kind && item.entityId === entry.entityId)!;
        const preview = proposals[index];
        const actual = located(cloud, entry.kind, entry.entityId);
        if (!equal(actual, entry.cloud)) {
            throw new Error('Versione cloud cambiata rispetto agli originali autenticati.');
        }
        const selected = choice.choice === 'combined'
            ? (preview.kind === 'automatic-candidate' ? { docPath: preview.docPath, value: preview.value } : null)
            : entry[choice.choice];
        if (selected === null && choice.choice === 'combined') {
            throw new Error('Combinazione non autorizzata dal confronto a tre vie.');
        }
        const path = selected?.docPath ?? null;
        const value = selected?.value ?? null;
        if (!validSelected(entry.kind, entry.entityId, path, value)) {
            throw new Error('Versione scelta incompatibile con lo schema business corrente.');
        }
        return { kind: entry.kind, entityId: entry.entityId, choice: choice.choice,
            docPath: path, value: structuredClone(value) };
    });
}

/** Create a disposable business projection, not an authoritative cloud snapshot. */
function applyRetiredReplicaResolvedEntities(
    cloud: AuthenticatedCloudflareCheckpoint, resolved: readonly RetiredReplicaResolvedEntity[],
): Map<string, DocumentData> {
    const documents = new Map([...cloud.documents].map(([path, item]) => [path, structuredClone(item.business)]));
    for (const entity of resolved) {
        const prefix = entity.kind === 'history' ? 'history_months/' : 'nutrition_months/';
        for (const [path, business] of documents) {
            if (entity.kind === 'active-workout') {
                if (path === '') business.activeWorkout = null;
            } else if (path.startsWith(prefix)) delete business[entity.entityId];
        }
        if (entity.docPath !== null) {
            const business = documents.get(entity.docPath) ?? {};
            Object.defineProperty(business,
                entity.kind === 'active-workout' ? 'activeWorkout' : entity.entityId,
                { value: structuredClone(entity.value), enumerable: true, writable: true, configurable: true });
            documents.set(entity.docPath, business);
        }
    }
    return documents;
}

export function previewRetiredReplicaSelectedDocuments(
    local: LocalEnvelope, cloud: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot, catalog: CachedGlobalCatalog,
): Map<string, DocumentData> {
    return applyRetiredReplicaResolvedEntities(cloud,
        materializeRetiredReplicaConflictChoices(local, cloud, control, catalog));
}
