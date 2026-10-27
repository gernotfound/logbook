import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { getCachedCatalog } from '../catalog/catalogService';
import { generateId } from '../utils/date';
import { checkpointFromCloudDocuments } from './replicaProtocol';
import { projectDocuments, type DocumentData } from './documentProjection';
import { diffDocuments, type VectorClock } from './semanticProjection';
import { enforceMonthlyEntityTombstones } from './monthlyEntityTombstones';
import { sequenceOperationsForBoundedTransactions } from './syncBatching';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';
import { normalizeStorageOwner } from './owner';
import { StaleLocalRevisionError } from './localRevisionError';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

/**
 * Reauthorizes PREVIOUSLY unsent changes only after a new explicit acceptance
 * and a separate user-confirmed recovery action. The old journal is never sent.
 * This is one atomic IndexedDB transition; a failed/quota-limited update leaves
 * the original envelope untouched. An exact full-cloud scan is required.
 */
export async function rebaseConsentRecoveryWithExplicitChoice(
    owner: string, revision: number, expectedLocalRevision: number,
    cloudData: UserData, chosenData: UserData,
    cloudDocuments: Map<string, DocumentData>, guard: () => boolean,
): Promise<void> {
    owner = normalizeStorageOwner(owner);
    if (!owner.startsWith('user:') || !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('Nuovo consenso non valido');
    }
    const catalog = await getCachedCatalog();
    const remote = structuredClone(parse(cloudData));
    const desired = structuredClone(parse({ ...chosenData, legalConsent: remote.legalConsent }));
    const checkpoint = checkpointFromCloudDocuments(cloudDocuments);
    const baseDocs = projectDocuments(remote, catalog);
    const desiredDocs = projectDocuments(desired, catalog);
    const months = [...new Set([...cloudDocuments.keys()]
        .filter(path => path.startsWith('history_months/') || path.startsWith('nutrition_months/'))
        .map(path => path.split('/')[1]))].sort();
    await updateArchiveRecord<any>(owner, raw => {
        if (!guard()) throw new Error('Sessione cambiata: recupero annullato');
        const current = validateLocalEnvelope(raw, owner);
        if (!current || current.revision !== expectedLocalRevision || !current.pending.length) {
            throw new StaleLocalRevisionError(expectedLocalRevision, current?.revision ?? null);
        }
        if ((current.consentRevision ?? 0) >= revision) {
            throw new Error('Journal non appartenente alla precedente generazione di consenso');
        }
        const originals = current.archivedConsentJournals ?? [];
        if (originals.length >= 32) throw new Error('Archivio recupero pieno: esporta i dati prima di ripetere');
        const actorId = generateId('actor');
        const baseClock: VectorClock = { ...checkpoint.clock, [actorId]: 0 };
        const provisionalClock: VectorClock = { ...baseClock, [actorId]: 1 };
        let operations = diffDocuments(baseDocs, desiredDocs, actorId, 1, provisionalClock);
        operations = enforceMonthlyEntityTombstones(baseDocs, desiredDocs, operations, actorId, 1, provisionalClock);
        const sequenced = sequenceOperationsForBoundedTransactions(operations, actorId, 0, baseClock);
        return {
            ...current,
            consentRevision: revision,
            actorId, actorSeq: sequenced.actorSeq,
            clock: sequenced.clock,
            data: desired, baseline: remote,
            completeMonths: months,
            pending: sequenced.operations,
            syncMetaByDocument: checkpoint.syncMetaByDocument,
            replica: null,
            archivedConsentJournals: [
                ...originals,
                {
                    sourceConsentRevision: current.consentRevision ?? 0,
                    capturedAt: new Date().toISOString(),
                    data: structuredClone(current.data),
                    baseline: structuredClone(current.baseline),
                    pending: structuredClone(current.pending),
                },
            ],
            revision: current.revision + 1,
        };
    });
}

