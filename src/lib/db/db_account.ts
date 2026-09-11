import { auth, getDb, deleteUser, ensureAppCheck, waitForPendingWrites } from '../firebase';
import { doc, collection, getDocsFromServer, getDocFromServer, query, limit, writeBatch } from 'firebase/firestore';
import { del } from 'idb-keyval';
import { useAppStore } from '../../store/useAppStore';
import { withTimeout } from './db_core';
import { storageOwner, captureSession, isCurrentSession } from '../sync/session';
import { markAccountDeletion } from '../sync/accountGate';
import { waitForJournalIdle } from '../sync/replicateJournal';

export async function purgeAllLocalUserData(owner = storageOwner()) {
    const failures: unknown[] = [];
    const results = await Promise.allSettled([
        del('logbook:v2:' + owner), del('logbook_cached_user_data'),
        del('pending_sync_token'), del('pending_sync_payload')
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    const keys = new Set([
        'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated',
        'draft_measurement', 'draft_exercise', 'draft_routine', 'logbook_awaiting_redirect',
        'logbook_telemetry_queue'
    ]);
    try {
        const prefix = 'logbook:v2:' + owner + ':';
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) keys.add(key);
        }
        if (owner === 'guest') keys.add('logbook_is_guest');
    } catch (error) { failures.push(error); }
    for (const key of keys) {
        try { localStorage.removeItem(key); }
        catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Pulizia locale incompleta. Alcuni dati sono ancora presenti su questo dispositivo.');
}

const privateCollections = ['history_months', 'nutrition_months', 'telemetry_errors', 'telemetry_events', 'telemetry_anomalies'];
let deleting: Promise<void> | undefined;

export function deleteAccount(context: { purgeAllLocalUserData: (owner: string) => Promise<void>; resetCache: () => void }): Promise<void> {
    if (deleting) return deleting;
    const work = performDeletion(context);
    deleting = work;
    void work.finally(() => { if (deleting === work) deleting = undefined; }).catch(() => {});
    return work;
}

async function performDeletion(context: { purgeAllLocalUserData: (owner: string) => Promise<void>; resetCache: () => void }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Nessun utente autenticato.');
    const before = captureSession();
    const owner = 'user:' + user.uid;
    if (before.owner !== owner) throw new Error('Esci dalla modalità ospite prima di eliminare l’account.');
    // The UI reauthenticates first. Enforce recent identity here as well, before any deletion.
    const token = await withTimeout(user.getIdTokenResult(true), 10000, 'Verifica identità non disponibile.');
    if (!isCurrentSession(before) || auth.currentUser?.uid !== user.uid) throw new Error('Sessione cambiata.');
    const authenticatedAt = new Date(token.authTime).getTime();
    if (!Number.isFinite(authenticatedAt) || authenticatedAt > Date.now() + 60000 || Date.now() - authenticatedAt > 5 * 60 * 1000) {
        throw new Error('Per eliminare l’account devi effettuare di nuovo il login. Nessun dato è stato cancellato.');
    }
    markAccountDeletion(owner);
    useAppStore.getState().cancelPendingSyncs();
    const session = captureSession();
    const assertCurrent = () => {
        if (!isCurrentSession(session) || auth.currentUser?.uid !== user.uid) throw new Error('Sessione cambiata durante la cancellazione.');
    };
    let authDeleted = false;
    try {
        const db = getDb();
        await withTimeout(waitForJournalIdle(owner), 10000, 'Scritture precedenti ancora in corso.');
        assertCurrent();
        await withTimeout(waitForPendingWrites(db), 10000, 'Scritture Firebase precedenti ancora in corso.');
        assertCurrent();
        await ensureAppCheck();
        assertCurrent();
        for (const name of privateCollections) {
            // Re-read the first page after each acknowledged batch: interrupted
            // runs can resume without an unsafe cursor or a guessed document count.
            for (;;) {
                const page = await withTimeout(getDocsFromServer(query(collection(db, 'users', user.uid, name), limit(400))), 10000, 'Lettura dati da eliminare interrotta.');
                assertCurrent();
                if (page.empty) break;
                const batch = writeBatch(db);
                for (const item of page.docs) batch.delete(item.ref);
                assertCurrent();
                await withTimeout(batch.commit(), 10000, 'Conferma cancellazione in attesa.');
                assertCurrent();
            }
        }
        const root = doc(db, 'users', user.uid);
        const batch = writeBatch(db);
        batch.delete(root);
        assertCurrent();
        await withTimeout(batch.commit(), 10000, 'Conferma cancellazione profilo in attesa.');
        assertCurrent();
        const remainingRoot = await withTimeout(getDocFromServer(root), 10000, 'Verifica finale del profilo non disponibile.');
        assertCurrent();
        if (remainingRoot.exists()) throw new Error('Il profilo cloud è ancora presente.');
        for (const name of privateCollections) {
            const residual = await withTimeout(getDocsFromServer(query(collection(db, 'users', user.uid, name), limit(1))), 10000, 'Verifica finale dei dati non disponibile.');
            assertCurrent();
            if (!residual.empty) throw new Error('Sono presenti dati residui: ' + name + '.');
        }
        // This verifies this client's observed state, not global atomicity with
        // other devices. Server-coordinated deletion remains a rollout requirement.
        assertCurrent();
        await deleteUser(user);
        authDeleted = true;
        await context.purgeAllLocalUserData(owner);
        context.resetCache();
        if (storageOwner() === owner || !auth.currentUser) useAppStore.getState().resetStore();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String((error as { code?: string })?.code ?? error);
        throw new Error(authDeleted
            ? 'Account cloud eliminato, ma pulizia locale incompleta. ' + detail
            : 'Cancellazione non completata: alcuni dati cloud potrebbero essere già eliminati. Account e copia locale conservati; riprendi l’operazione dalle impostazioni. ' + detail,
        { cause: error });
    }
}
