# Storage e Sincronizzazione — LogBook

> Stato: normativo | Ultima verifica: 2026-09-09 | File verificati: `src/store/useAppStore.ts`, `src/store/slices/createDataSlice.ts`, `src/store/slices/createSyncSlice.ts`, `src/store/slices/createWorkoutSlice.ts`, `src/constants.ts`, `src/lib/db.ts`, `src/main.tsx`

## Architettura di storage

L'app utilizza quattro livelli di storage con ruoli distinti:

| Livello | Tecnologia | Ruolo | Dati principali |
|---|---|---|---|
| **Stato operativo** | Zustand 5 (`useAppStore`) | Stato in memoria, single source of truth per i componenti React | Tutto `UserData`, `localWorkout`, `syncing`, `saveError` |
| **Persistenza locale principale** | IndexedDB (`idb-keyval`) | Cache asincrona dell'intero albero `UserData` | Chiave `'logbook_cached_user_data'` |
| **Persistenza sincrona** | `localStorage` | Dati che richiedono salvataggio sincrono istantaneo (sopravvive a suspend/kill del processo PWA) | `logbook_local_workout`, `logbook_is_guest`, `logbook_activeTab`, timer, bozze locali |
| **Replica remota** | Firestore (Firebase) | Sincronizzazione cloud, backup, condivisione cross-device | Documento utente + subcollection mensilizzate |

**MUST:** Offline, l'app deve avviarsi e operare dai dati locali (IndexedDB + localStorage).

## Pipeline di salvataggio (Zustand → IndexedDB → Firestore)

1. I componenti invocano `saveUserData((prev) => ({ ... }))` o `updateUserData`.
2. Zustand aggiorna lo stato in memoria e chiama immediatamente `saveUserDataToCache(finalData)` per sincronizzare IndexedDB.
3. Viene avviato il **debouncer locale di 300ms** (`DEBOUNCE_DELAY_LOCAL = 300` in `src/constants.ts`) per il workout attivo, che salva su `localStorage`.
4. Viene avviato il **debouncer globale di 1000ms** (`DEBOUNCE_DELAY_GLOBAL = 1000`) per la sincronizzazione cloud.
5. Alla scadenza del timer globale, `DB.saveUserData` in `src/lib/db.ts` effettua il diffing con `fast-deep-equal`.
6. Se ci sono differenze, viene eseguito un `batch.commit()` su Firestore con timeout di 7 secondi.

## Esiti della sincronizzazione

`DB.saveUserData` restituisce un oggetto con stato:

| Status | Significato |
|---|---|
| `{ ok: true, status: 'synced' }` | Scrittura confermata su Firestore |
| `{ ok: false, status: 'rejected' }` | `permission-denied` — la write è stata rifiutata (App Check, rules, dominio, auth) |
| `{ ok: false, status: 'local-pending' }` | Offline o timeout — dati salvati in cache locale, Background Sync registrato |
| `{ ok: false, status: 'failed' }` | Errore critico non classificato |

**MUST:** Una write rifiutata (`rejected`) non deve mai essere esposta all'utente come confermata.

**MUST:** Le funzioni `saveUserData` e `updateUserData` devono rigettare la Promise quando `DB.saveUserData` fallisce. È vietato risolvere silenziosamente nel `catch`.

## Pre-render bootstrap

All'avvio dell'app (`initApp` in `src/main.tsx`), **prima** di `createRoot().render()`:

1. La cache utente viene recuperata da IndexedDB e assegnata a `window.__INITIAL_USER_DATA__`.
2. Lo store Zustand viene inizializzato tramite `getInitialUserData()`, validando la cache con `UserDataSchema.parse()`.

Questo elimina race condition con il ciclo di vita React e `AuthContext`:
- Impedisce il flash di schermate vuote o overlay di sync all'avvio offline.
- Evita la cancellazione distruttiva dei dati in modalità Guest.
- Evita la perdita dei dati locali durante il collegamento dell'account Google.

## Blindatura in background (Safari Suspend)

Quando `document.visibilityState === 'hidden'` (in `useAppStore.ts`):
1. Viene chiamato `draftRegistry.flushAll()` per salvare tutte le bozze.
2. `localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout))` viene eseguito sincronamente, bypassando il debouncer di 300ms.
3. L'operazione è protetta da `try/catch`.

**Perché `localStorage` e non IndexedDB?** `localStorage.setItem()` è un'operazione sincrona bloccante che il browser garantisce prima di congelare il processo. IndexedDB si basa su transazioni asincrone che verrebbero abortite dall'OS.

## Merge deterministico (Guest → Cloud)

Al login con Google, se esistono dati guest locali, viene eseguito un merge deterministico (`src/lib/merge.ts`):

- **Array con ID** (`library`, `routines`, `customFoods`, `trainingCycles`, `history`, `supplements`): unione deduplicata per `id`, priorità alle modifiche locali (guest) in caso di collisione.
- **Record per data** (`nutrition`): unione delle date `YYYY-MM-DD`, merge deduplicato dei sotto-array `meals` e `supplementsIntake` per `id`.
- **Campi scalari** (`profile`, `nutritionPlanning`, `activeWorkout`, `activeCycleId`): priorità ai dati guest se valorizzati, altrimenti cloud.

**MUST:** Il dato unificato deve transitare e superare `UserDataSchema.parse()` prima del salvataggio.

**NOTE:** La policy "guest wins" è deterministica ma non equivale a "dato più recente". VERIFY l'implementazione e i test prima di cambiare la logica di merge.

## Offline resilience

In assenza di connessione, l'app opera da IndexedDB locale. L'SDK Firestore gestisce le code offline in background tramite `persistentLocalCache` con `persistentMultipleTabManager`.

Quando la connessione viene ripristinata, un listener `online` in `useAppStore.ts` cancella eventuali `saveError` pendenti.
