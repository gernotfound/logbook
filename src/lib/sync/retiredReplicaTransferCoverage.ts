import equal from 'fast-deep-equal';
import type { CachedGlobalCatalog } from '../../types';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from './documentProjection';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { materializeRetiredReplicaConflictChoices, type RetiredReplicaResolvedEntity } from './retiredReplicaConflictMaterialization';
import { preflightRetiredReplicaRecovery } from './retiredReplicaRecoveryPreflight';
import type { ReplicaIdentity } from './replicaProtocol';
import type { SemanticOperation, VectorClock } from './semanticProjection';

type Kind = 'history' | 'nutrition';
type Location = { docPath: string; value: unknown };
const plainRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function nestedRootValue(document: DocumentData, path: readonly string[]): unknown {
    let value: unknown = document;
    for (const segment of path) {
        if (!plainRecord(value)) throw new Error('Percorso root strutturale: trasferimento sospeso.');
        value = Object.hasOwn(value, segment) ? value[segment] : undefined;
    }
    return value;
}

function setNestedRootValue(document: DocumentData, path: readonly string[], value: unknown): void {
    let parent: Record<string, unknown> = document;
    for (const segment of path.slice(0, -1)) {
        const next = Object.hasOwn(parent, segment) ? parent[segment] : undefined;
        if (!plainRecord(next)) throw new Error('Percorso root concorrente non riconciliabile.');
        parent = next;
    }
    const key = path[path.length - 1];
    if (value === undefined) delete parent[key];
    else Object.defineProperty(parent, key, {
        value: structuredClone(value), enumerable: true, configurable: true, writable: true,
    });
}

/** No cloud write is authorized by this projection, including if all checks pass. */
export type RetiredReplicaTransferCoverage = {
    cloudRevision: number;
    localRevision: number;
    originalReplica: ReplicaIdentity;
    originalClock: VectorClock;
    originalPending: SemanticOperation[];
    proposedDocuments: Map<string, DocumentData>;
    selectedConflicts: RetiredReplicaResolvedEntity[];
};

function locate(documents: ReadonlyMap<string, DocumentData>, kind: Kind, id: string): Location | null {
    const prefix = kind === 'history' ? 'history_months/' : 'nutrition_months/';
    let found: Location | null = null;
    for (const [path, value] of documents) {
        if (!path.startsWith(prefix) || !Object.hasOwn(value, id)) continue;
        if (found) throw new Error('Identità mensile duplicata: trasferimento sospeso.');
        found = { docPath: path, value: value[id] };
    }
    return found;
}

function replaceEntity(documents: Map<string, DocumentData>, kind: Kind, id: string, selected: Location | null): void {
    const prefix = kind === 'history' ? 'history_months/' : 'nutrition_months/';
    for (const [path, document] of documents) {
        if (path.startsWith(prefix)) delete document[id];
    }
    if (!selected) return;
    const document = documents.get(selected.docPath) ?? {};
    Object.defineProperty(document, id, {
        value: structuredClone(selected.value), enumerable: true, configurable: true, writable: true,
    });
    documents.set(selected.docPath, document);
}

/**
 * Account for every old-generation pending business path without silently
 * dropping a concurrent cloud version. This is a disposable, in-memory
 * coverage proof; it cannot establish the new actor's causal clock or grant
 * membership. A future recovery must recheck primary receipts and a fresh
 * full AEAD snapshot before sealing a new-generation journal in IndexedDB.
 */
export function previewRetiredReplicaTransferCoverage(
    local: LocalEnvelope,
    cloud: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot,
    catalog: CachedGlobalCatalog,
): RetiredReplicaTransferCoverage {
    const proof = preflightRetiredReplicaRecovery(control.uid, local, cloud, control, catalog);
    if (proof.kind !== 'baseline-unchanged'
        && (proof.kind !== 'reconciliation-required' || proof.reason !== 'cloud-diverged')) {
        throw new Error('Journal offline non trasferibile: prova causale insufficiente.');
    }
    if (proof.kind === 'reconciliation-required' && proof.evidence.unclassifiedDocuments > 0) {
        throw new Error('Modifiche cloud o metadati senza provenienza verificabile: trasferimento sospeso.');
    }
    if (!local.replica || local.replica.slot !== local.actorId || !local.pending.length) {
        throw new Error('Replica originale o journal assenti.');
    }
    const base = projectDocuments(local.baseline, catalog);
    const device = projectDocuments(local.data, catalog);
    const remote = new Map([...cloud.documents].map(([path, item]) => [path, structuredClone(item.business)]));
    const proposal = new Map([...remote].map(([path, business]) => [path, structuredClone(business)]));
    const conflicts = proof.kind === 'reconciliation-required'
        && proof.evidence.entitiesWithCompetingVersions > 0
        ? materializeRetiredReplicaConflictChoices(local, cloud, control, catalog) : [];
    if (local.retiredReplicaConflictCapsule && !conflicts.length) {
        // A stale capsule must not turn into apparent permission to reassign
        // an old-generation journal after the remote frontier changed.
        throw new Error('Capsula conflitti non coerente con il cloud corrente.');
    }
    const selected = new Map(conflicts.map(item => [`${item.kind}:${item.entityId}`, item]));
    const monthly = new Map<string, Set<string>>();
    const rootPaths = new Map<string, string[]>();
    for (const operation of local.pending) {
        if (operation.guard || !operation.path.length) {
            throw new Error('Operazione strutturale o con guard: trasferimento sospeso.');
        }
        if (operation.docPath === '') {
            if (operation.path[0] === 'legalConsent') {
                throw new Error('Consenso non trasferibile tramite un journal ritirato.');
            }
            if (operation.path.some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment))) {
                throw new Error('Percorso root non sicuro.');
            }
            rootPaths.set(JSON.stringify(operation.path), operation.path);
        } else if (/^(history_months|nutrition_months)\/\d{4}-(0[1-9]|1[0-2])$/.test(operation.docPath)) {
            const kind = operation.docPath.startsWith('history_') ? 'history' : 'nutrition';
            const ids = monthly.get(kind) ?? new Set<string>();
            ids.add(operation.path[0]);
            monthly.set(kind, ids);
        } else throw new Error('Percorso del journal non riconosciuto.');
    }

    const rootBase = base.get('') ?? {};
    const rootDevice = device.get('') ?? {};
    const rootRemote = remote.get('') ?? {};
    const rootProposal = proposal.get('') ?? {};
    const rootTouched = [...rootPaths.values()];
    if (rootTouched.some((path, index) => rootTouched.some((other, otherIndex) =>
        index !== otherIndex && path.length !== other.length
        && path.slice(0, Math.min(path.length, other.length)).every((part, i) => part === other[i])))) {
        throw new Error('Operazioni root con percorsi sovrapposti: trasferimento sospeso.');
    }
    for (const path of rootTouched) {
        const key = path[0];
        const before = nestedRootValue(rootBase, path);
        const mine = nestedRootValue(rootDevice, path);
        const theirs = nestedRootValue(rootRemote, path);
        if (equal(before, mine)) {
            throw new Error('Operazione root senza effetto business: provenienza non trasferibile.');
        }
        if (key === 'activeWorkout' && selected.has('active-workout:activeWorkout')) {
            const choice = selected.get('active-workout:activeWorkout')!;
            if (choice.docPath !== null && choice.docPath !== '') throw new Error('Allenamento attivo incoerente.');
            rootProposal.activeWorkout = structuredClone(choice.value);
        } else if (key === 'activeWorkout' && path.length > 1) {
            throw new Error('Allenamento attivo strutturale: trasferimento sospeso.');
        } else if (equal(before, theirs)) {
            setNestedRootValue(rootProposal, path, mine);
        } else if (!equal(mine, theirs)) {
            throw new Error('Campo root concorrente senza scelta sicura.');
        }
    }
    if (rootPaths.size) proposal.set('', rootProposal);

    for (const [kind, ids] of monthly) {
        for (const id of ids) {
            const before = locate(base, kind as Kind, id);
            const mine = locate(device, kind as Kind, id);
            const theirs = locate(remote, kind as Kind, id);
            if (equal(before, mine)) {
                throw new Error('Operazione mensile senza effetto business: provenienza non trasferibile.');
            }
            const choice = selected.get(`${kind}:${id}`);
            let resulting: Location | null;
            if (choice) resulting = choice.docPath === null ? null : { docPath: choice.docPath, value: choice.value };
            else if (equal(before, theirs)) resulting = mine;
            else if (equal(mine, theirs)) resulting = theirs;
            else throw new Error('Versione mensile concorrente senza scelta esplicita.');
            replaceEntity(proposal, kind as Kind, id, resulting);
        }
    }

    if (conflicts.some(item => item.kind !== 'active-workout'
        && !monthly.get(item.kind)?.has(item.entityId))
        || (selected.has('active-workout:activeWorkout') && !rootTouched.some(path => path[0] === 'activeWorkout'))) {
        throw new Error('Decisione di conflitto non collegata al journal originale.');
    }
    // The entire prospective account must parse as business data, including
    // months the old journal never touched. The original remote/local inputs
    // and every old causal operation remain untouched.
    applyRemoteDocuments(local.baseline, proposal, catalog);
    return {
        cloudRevision: cloud.revision,
        localRevision: local.revision,
        originalReplica: structuredClone(local.replica),
        originalClock: structuredClone(local.clock),
        originalPending: structuredClone(local.pending),
        proposedDocuments: proposal,
        selectedConflicts: conflicts,
    };
}
