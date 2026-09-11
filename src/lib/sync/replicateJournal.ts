import { auth, getDb, ensureAppCheck, waitForPendingWrites } from '../firebase';
import type { UserData, SyncResult } from '../../types';
import { readLocal, acknowledgeThrough } from './localRepository';
import { captureSession, isCurrentSession } from './session';
import { documentChanges, applyRemoteDocuments } from './documentProjection';
import { applyDocumentChanges } from './transactionWriter';
import { getCachedCatalog } from '../catalog/catalogService';
import { update } from 'idb-keyval';
import type { LocalEnvelope } from './localRepository';
import { SyncTimeoutError, withTimeout } from '../db/db_core';
import { isAccountDeletionPending } from './accountGate';

const running = new Map<string, Promise<void>>();
export async function waitForJournalIdle(owner: string): Promise<void> {
    const work = running.get(owner);
    if (work) { try { await work; } catch { /* Cancellation/rejection has settled; no writer remains active. */ } }
}
async function drain(session: ReturnType<typeof captureSession>): Promise<void> {
    const current = () => isCurrentSession(session) && auth.currentUser?.uid === session.owner.slice(5) && !isAccountDeletionPending(session.owner);
    if (!current()) throw new Error('Sessione cambiata');
    // Old SDK queued batches must settle before the new transactional writer starts.
    await ensureAppCheck();
    await waitForPendingWrites(getDb());
    const catalog = await getCachedCatalog();
    while (current()) {
        const envelope = await readLocal(session.owner);
        if (!current()) throw new Error('Sessione cambiata');
        if (!envelope) throw new Error('Archivio locale non disponibile');
        if (envelope.conflicts?.length) throw new Error('Conflitti da risolvere: alternative conservate nel registro locale');
        if (!envelope.pending.length) return;
        const changes = documentChanges(envelope.baseline, envelope.data, catalog);
        const outcome = await applyDocumentChanges(getDb(), session.owner.slice(5), changes, current);
        if (!current()) throw new Error('Sessione cambiata');
        if (outcome.conflicts.length) {
            await update<LocalEnvelope>(`logbook:v2:${session.owner}`, latest => {
                if (!latest || latest.owner !== session.owner) throw new Error('Archivio locale cambiato');
                return { ...latest, conflicts: [...(latest.conflicts ?? []), ...outcome.conflicts] };
            });
            throw new Error('Modifiche concorrenti rilevate. Le alternative sono conservate nel registro locale.');
        }
        const remote: UserData = applyRemoteDocuments(envelope.data, outcome.documents, catalog);
        await acknowledgeThrough(session.owner, envelope.revision, remote, envelope.data, changes.flatMap(change => change.path ? [change.path.split('/')[1]] : []));
    }
    throw new Error('Sessione cambiata');
}

export async function replicateJournal(): Promise<SyncResult> {
    const session = captureSession();
    try {
        if (isAccountDeletionPending(session.owner)) throw new Error('Cancellazione account in sospeso. Riprendila dalle impostazioni; copia locale conservata.');
        const envelope = await readLocal(session.owner);
        if (!envelope) throw new Error('Copia locale non disponibile');
        if (session.owner === 'guest' || !envelope.pending.length) return { ok: true, status: 'synced' };
        if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, status: 'local-pending', error: new Error('Connessione assente') };
        const previous = running.get(session.owner);
        const work = (async () => {
            if (previous) { try { await previous; } catch { /* A new epoch retries its own remaining journal. */ } }
            await drain(session);
        })();
        running.set(session.owner, work);
        // The actual task keeps its lock and acknowledgement path after a UI timeout.
        void work.finally(() => { if (running.get(session.owner) === work) running.delete(session.owner); }).catch(() => {});
        await withTimeout(work, 7000, 'Sincronizzazione in attesa; copia locale conservata');
        return { ok: true, status: 'synced' };
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code === 'permission-denied') return { ok: false, status: 'rejected', error };
        if (error instanceof SyncTimeoutError || code === 'unavailable' || code === 'deadline-exceeded') return { ok: false, status: 'local-pending', error };
        return { ok: false, status: 'failed', error };
    }
}
