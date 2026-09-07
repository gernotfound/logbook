import { auth, getDb, deleteUser, ensureAppCheck } from '../firebase';
import { doc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { del } from 'idb-keyval';
import { useAppStore } from '../../store/useAppStore';
import { withTimeout } from './db_core';

export async function purgeAllLocalUserData() {
    console.log("[purgeAllLocalUserData] Avvio pulizia sicura dei dati locali.");

    // 1. IndexedDB Purge
    try {
        await Promise.allSettled([
            del('logbook_cached_user_data'),
            del('pending_sync_token'),
            del('pending_sync_payload')
        ]);
    } catch (e) {
        console.warn("[purgeAllLocalUserData] Errore durante la pulizia di IndexedDB:", e);
    }

    // 2. localStorage Purge
    const keysToRemove = [
        'logbook_local_workout',
        'logbook_timer_state',
        'logbook_timer_start',
        'logbook_timer_accumulated',
        'draft_measurement',
        'draft_exercise',
        'draft_routine',
        'logbook_is_guest',
        'logbook_awaiting_redirect'
    ];

    keysToRemove.forEach(key => {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn(`[purgeAllLocalUserData] Errore durante la rimozione della chiave ${key} in localStorage:`, e);
        }
    });
}


export async function deleteAccount(context: any) {
    const user = auth.currentUser;
    if (!user) throw new Error("Nessun utente autenticato.");
    try {
        useAppStore.getState().cancelPendingSyncs();
        await context.purgeAllLocalUserData();
        // 1. Fetch subcollection documents while auth is valid
        await ensureAppCheck();
        const [histSnap, nutSnap, errSnap, evtSnap, anomSnap] = await Promise.all([
            getDocs(collection(getDb(), "users", user.uid, "history_months")).catch(e => {
                console.warn("Permesso negato per leggere history_months, proseguo...", e);
                return { forEach: () => {} } as any;
            }),
            getDocs(collection(getDb(), "users", user.uid, "nutrition_months")).catch(e => {
                console.warn("Permesso negato per leggere nutrition_months, proseguo...", e);
                return { forEach: () => {} } as any;
            }),
            getDocs(collection(getDb(), "users", user.uid, "telemetry_errors")).catch(e => {
                console.warn("Permesso negato per leggere telemetry_errors, proseguo...", e);
                return { forEach: () => {} } as any;
            }),
            getDocs(collection(getDb(), "users", user.uid, "telemetry_events")).catch(e => {
                console.warn("Permesso negato per leggere telemetry_events, proseguo...", e);
                return { forEach: () => {} } as any;
            }),
            getDocs(collection(getDb(), "users", user.uid, "telemetry_anomalies")).catch(e => {
                console.warn("Permesso negato per leggere telemetry_anomalies, proseguo...", e);
                return { forEach: () => {} } as any;
            })
        ]);

        const allRefs: any[] = [];
        histSnap?.forEach?.((d: any) => allRefs.push(d.ref));
        nutSnap?.forEach?.((d: any) => allRefs.push(d.ref));
        errSnap?.forEach?.((d: any) => allRefs.push(d.ref));
        evtSnap?.forEach?.((d: any) => allRefs.push(d.ref));
        anomSnap?.forEach?.((d: any) => allRefs.push(d.ref));
        allRefs.push(doc(getDb(), "users", user.uid));

        // Chunk in max 400 operations per batch to strictly adhere to Firestore 500 limit
        const CHUNK_SIZE = 400;
        for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
            const chunk = allRefs.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(getDb());
            chunk.forEach(ref => batch.delete(ref));
            try {
                await withTimeout(batch.commit(), 7000, "Timeout eliminazione batch account");
            } catch (batchErr: any) {
                if (batchErr?.code === 'permission-denied') {
                    console.warn("Impossibile eliminare i dati cloud (permesso Firestore), procedo con l'eliminazione dell'account Auth.");
                } else {
                    throw batchErr;
                }
            }
        }

        // 2. Delete Firebase Auth user account
        await deleteUser(user);
        console.log("Account e relative subcollection eliminati con successo.");
    } catch (error: any) {
        console.error("Errore nell'eliminazione dell'account:", error);
        if (error.code === 'auth/requires-recent-login') {
            throw new Error("Per motivi di sicurezza, devi ricaricare la pagina ed effettuare di nuovo il login prima di poter eliminare il tuo account.");
        }
        throw error;
    } finally {
        await context.purgeAllLocalUserData();
        context.resetCache();
        useAppStore.getState().resetStore();
    }
}
