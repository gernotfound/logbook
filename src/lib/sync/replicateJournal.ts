import equal from 'fast-deep-equal';
import { auth, getDb, ensureAppCheck, waitForPendingWrites } from '../firebase';
import type { UserData, SyncResult } from '../../types';
import { readLocal, acknowledgeThrough, markReplicaCheckpointRequired } from './localRepository';
import { captureSession, isCurrentSession } from './session';
import { applyRemoteDocuments } from './documentProjection';
import { applyDocumentChanges } from './transactionWriter';
import { getCachedCatalog } from '../catalog/catalogService';
import { SyncTimeoutError, withTimeout } from '../db/db_core';
import { isAccountDeletionPending } from './accountGate';
import type { SemanticOperation } from './semanticProjection';
import { classifySyncFailure } from './syncFailure';
import { ReplicaFencedError } from './replicaProtocol';

class DurableAcknowledgementPendingError extends Error {
    constructor(cause: unknown) {
        super('Commit remoto confermato; acknowledgement locale ancora pendente', { cause });
        this.name = 'DurableAcknowledgementPendingError';
    }
}

class UnsafeDeliveredBatchError extends Error {
    constructor(cause: unknown) {
        super('Esito remoto ambiguo senza prova di un journal locale completo e verificabile', { cause });
        this.name = 'UnsafeDeliveredBatchError';
    }
}

type DeliveryState = {
    delivered: SemanticOperation[] | null;
};

function sameDeliveredOperation(left: SemanticOperation, right: SemanticOperation): boolean {
    return equal(left, right);
}

function containsDeliveredBatch(pending: SemanticOperation[], delivered: SemanticOperation[]): boolean {
    const unmatched = [...pending];
    for (const operation of delivered) {
        const index = unmatched.findIndex(candidate => sameDeliveredOperation(operation, candidate));
        if (index < 0) return false;
        unmatched.splice(index, 1);
    }
    return true;
}

function isWritableSession(session: ReturnType<typeof captureSession>): boolean {
    return isCurrentSession(session)
        && auth.currentUser?.uid === session.owner.slice(5)
        && !isAccountDeletionPending(session.owner);
}

async function requireDurableDeliveredBatch(
    session: ReturnType<typeof captureSession>,
    delivered: SemanticOperation[],
    cause: unknown,
): Promise<never> {
    if (!isWritableSession(session)) throw new UnsafeDeliveredBatchError(cause);

    let retained: Awaited<ReturnType<typeof readLocal>>;
    try {
        retained = await readLocal(session.owner);
    } catch {
        throw new UnsafeDeliveredBatchError(cause);
    }

    if (!isWritableSession(session)) throw new UnsafeDeliveredBatchError(cause);
    if (retained && containsDeliveredBatch(retained.pending, delivered)) {
        throw new DurableAcknowledgementPendingError(cause);
    }
    throw new UnsafeDeliveredBatchError(cause);
}

const running = new Map<string, Promise<void>>();
const deliveryStates = new Map<string, DeliveryState>();
export async function waitForJournalIdle(owner: string): Promise<void> {
    const work = running.get(owner);
    if (work) { try { await work; } catch { /* Cancellation/rejection has settled; no writer remains active. */ } }
}
async function drain(session: ReturnType<typeof captureSession>, deliveryState: DeliveryState): Promise<void> {
    const current = () => isWritableSession(session);
    deliveryState.delivered = null;
    if (!current()) throw new Error('Sessione cambiata');
    await ensureAppCheck();
    await waitForPendingWrites(getDb());
    const catalog = await getCachedCatalog();
    while (current()) {
        const envelope = await readLocal(session.owner);
        if (!current()) throw new Error('Sessione cambiata');
        if (!envelope) throw new Error('Archivio locale non disponibile');
        if (!envelope.pending?.length) return;
        if (!envelope.replica) throw new ReplicaFencedError('Replica non registrata: attendi il checkpoint cloud completo.');
        if (envelope.actorId !== envelope.replica.slot || envelope.pending.some(operation => operation.actorId !== envelope.replica!.slot)) {
            throw new ReplicaFencedError('Journal appartenente a una replica precedente: checkpoint completo richiesto.');
        }
        if (envelope.replica.leaseUntilMs < Date.now()) {
            throw new ReplicaFencedError('Lease replica scaduta: checkpoint completo richiesto.');
        }

        const delivered = structuredClone(envelope.pending);
        deliveryState.delivered = delivered;

        let outcome: Awaited<ReturnType<typeof applyDocumentChanges>>;
        try {
            outcome = await applyDocumentChanges(getDb(), session.owner.slice(5), delivered, current, envelope.replica);
        } catch (error) {
            const failure = classifySyncFailure(error);
            if (failure.status === 'local-pending') {
                await requireDurableDeliveredBatch(session, delivered, error);
            }
            throw error;
        }

        if (!current()) throw new Error('Sessione cambiata');

        const remote: UserData = applyRemoteDocuments(envelope.data, outcome.documents, catalog);
        const seq = delivered[delivered.length - 1].seq;
        const changedPaths = [...new Set(delivered.map(op => op.docPath))];
        const changedMonths = changedPaths.flatMap(path => path ? [path.split('/')[1]] : []);

        try {
            await acknowledgeThrough(session.owner, seq, remote, changedMonths, outcome.syncMeta);
        } catch (error) {
            // A remote transaction is already confirmed here. An acknowledgement failure is retryable
            // only when a fresh, validated IndexedDB read proves that the exact delivered batch remains.
            await requireDurableDeliveredBatch(session, delivered, error);
        }

        deliveryState.delivered = null;
    }
    throw new Error('Sessione cambiata');
}

async function classifyTimedOutWork(
    session: ReturnType<typeof captureSession>,
    error: SyncTimeoutError,
): Promise<SyncResult> {
    if (!isWritableSession(session)) return { ok: false, status: 'failed', error };

    let retained: Awaited<ReturnType<typeof readLocal>>;
    try {
        retained = await readLocal(session.owner);
    } catch {
        return { ok: false, status: 'failed', error: new UnsafeDeliveredBatchError(error) };
    }

    if (!isWritableSession(session) || !retained) {
        return { ok: false, status: 'failed', error: new UnsafeDeliveredBatchError(error) };
    }

    const delivered = deliveryStates.get(session.owner)?.delivered;
    if (delivered?.length) {
        if (!containsDeliveredBatch(retained.pending, delivered)) {
            return { ok: false, status: 'failed', error: new UnsafeDeliveredBatchError(error) };
        }
        return { ok: false, status: 'local-pending', error };
    }

    if (!retained.pending.length) return { ok: true, status: 'synced' };
    return { ok: false, status: 'local-pending', error };
}

export async function replicateJournal(expectedOwner?: string): Promise<SyncResult> {
    const session = captureSession();
    try {
        if (expectedOwner && session.owner !== expectedOwner) throw new Error('Sessione cambiata');
        if (isAccountDeletionPending(session.owner)) throw new Error('Cancellazione account in sospeso. Riprendila dalle impostazioni; copia locale conservata.');
        const envelope = await readLocal(session.owner);
        if (expectedOwner && session.owner !== expectedOwner) throw new Error('Sessione cambiata');
        if (!envelope) throw new Error('Copia locale non disponibile');
        if (session.owner === 'guest' || !envelope.pending?.length) return { ok: true, status: 'synced' };
        if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, status: 'local-pending', error: new Error('Connessione assente') };
        const previous = running.get(session.owner);
        const deliveryState = deliveryStates.get(session.owner) ?? { delivered: null };
        deliveryStates.set(session.owner, deliveryState);
        const work = (async () => {
            if (previous) { try { await previous; } catch { /* A new epoch retries its own remaining journal. */ } }
            await drain(session, deliveryState);
        })();
        running.set(session.owner, work);
        // The actual task keeps its lock and acknowledgement path after a UI timeout.
        void work.finally(() => {
            if (running.get(session.owner) === work) {
                running.delete(session.owner);
                deliveryStates.delete(session.owner);
            }
        }).catch(() => {});
        try {
            await withTimeout(work, 7000, 'Sincronizzazione in attesa; copia locale conservata');
            return { ok: true, status: 'synced' };
        } catch (error) {
            if (error instanceof SyncTimeoutError) return classifyTimedOutWork(session, error);
            throw error;
        }
    } catch (error) {
        if (error instanceof ReplicaFencedError && session.owner.startsWith('user:')) {
            try {
                const durable = await readLocal(session.owner);
                await markReplicaCheckpointRequired(session.owner, durable?.replica ?? undefined);
            } catch {
                // The original fencing error remains authoritative. A local storage
                // failure is handled by the caller's normal persistence safety path.
            }
        }
        return classifySyncFailure(error, { retryable: error instanceof DurableAcknowledgementPendingError });
    }
}