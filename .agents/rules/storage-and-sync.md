# Storage e Sincronizzazione - LogBook

> Stato: normativo | Ultima verifica: 2026-09-13 | File verificati: src/store/useAppStore.ts, src/lib/sync/transactionWriter.ts, src/lib/sync/replicateJournal.ts, src/lib/sync/semanticProjection.ts, src/lib/sync/documentProjection.ts, src/lib/sync/localRepository.ts, src/lib/sync/deviceStorage.ts, src/contexts/AuthContext.tsx, src/main.tsx

## Architettura di storage

L'app utilizza quattro livelli di storage con ruoli distinti:

| Livello | Tecnologia | Ruolo | Dati principali |
|---|---|---|---|
| **Stato operativo** | Zustand 5 (useAppStore) | Stato in memoria, single source of truth per i componenti React | Tutto UserData, localWorkout, syncing, saveError |
| **Persistenza locale principale** | IndexedDB (idb-keyval) | Copia locale transazionale asincrona dell'envelope dati V3 | Chiave `logbook:v2:${owner}` (la vecchia `logbook_cached_user_data` è deprecata) |
| **Persistenza sincrona** | localStorage | Dati che richiedono salvataggio sincrono istantaneo (sopravvive a suspend/kill del processo PWA) | Namespace owner-scoped `logbook:v2:${owner}:*` tramite `deviceStorage.ts`, flag auth/guest e bozze locali |
| **Replica remota** | Firestore (Firebase) | Sincronizzazione cloud, backup, condivisione cross-device | Documento utente + subcollection mensilizzate |

**MUST:** Offline, l'app deve avviarsi e operare dai dati locali (IndexedDB + localStorage).

## Pipeline di salvataggio transazionale (Journaling e Semantic Merge)

La pipeline V3 mantiene il debounce solo per il tentativo di replica cloud, ma rende immediata e durevole la persistenza locale:

1. I componenti invocano `saveUserData` / `updateUserData` tramite lo store.
2. Prima del debounce cloud, `commitLocal()` persiste immediatamente in IndexedDB lo stato e le `SemanticOperation` nel journal owner-scoped.
3. `documentProjection.ts` proietta UserData in root + shard mensili; `semanticProjection.ts` genera diff deterministici per proprietà/entità con Vector Clock e tombstone.
4. `transactionWriter.ts` legge i documenti Firestore toccati, valida `_sync`, confronta FieldStamp remoto e operation locale, quindi esegue al massimo una write per documento toccato.
5. `replicateJournal.ts` drena il journal verso Firestore. In assenza di rete o dopo timeout, le operation restano durevoli nel journal.
6. `hydrateLocal()` assorbe il causal context remoto senza modificare gli stamp delle pending già esistenti e riproduce il journal localmente.

**MUST:** nessuna ottimizzazione del debounce cloud può posticipare la persistenza IndexedDB immediata.

## Hydration cloud

Esistono due coperture distinte e non intercambiabili:

- `window`: normale startup/foreground, root + finestra mensile caricata. I mesi locali non letti dal cloud devono essere preservati.
- `all`: scansione esaustiva usata per guest→account/operazioni complete. I mesi locali assenti dallo snapshot remoto sono considerati assenti autorevolmente; le pending locali vengono rigiocate sopra lo snapshot completo.

**MUST:** una scansione `all` non deve essere trattata come una semplice finestra parziale.

## Esiti della sincronizzazione

Il sistema `replicateJournal` / `transactionWriter` gestisce l'esito:

| Status | Significato |
|---|---|
| synced | Mutazioni applicate confermate su Firestore |
| rejected | permission-denied - la write è stata rifiutata (App Check, rules, dominio, auth). Il client registra il rigetto. |
| local-pending | Offline o timeout - transazione nel journal, sincronizzazione in attesa |
| failed | Errore critico non classificato |

**MUST:** Una write rifiutata (`rejected`) non deve mai essere esposta all'utente come confermata.

**MUST:** Le funzioni di salvataggio devono rigettare se l'accodamento della transazione locale fallisce in maniera critica. Vietato risolvere silenziosamente nel catch.

## Pre-render bootstrap

All'avvio dell'app (`initApp` in `src/main.tsx`), **prima** di `createRoot().render()`:

1. La cache utente viene recuperata da IndexedDB e assegnata a `window.__INITIAL_USER_DATA__`.
2. Lo store Zustand viene inizializzato tramite `getInitialUserData()`, validando la cache con `UserDataSchema.parse()`.

Questo elimina race condition con il ciclo di vita React e AuthContext:
- impedisce il flash di schermate vuote o overlay di sync all'avvio offline;
- evita la cancellazione distruttiva dei dati in modalità Guest;
- evita la perdita dei dati locali durante il collegamento dell'account Google.

## Blindatura in background (Safari Suspend)

Quando `document.visibilityState === 'hidden'`:
1. viene chiamato `draftRegistry.flushAll()` per salvare tutte le bozze;
2. i dati device-critical vengono scritti sincronicamente tramite le chiavi owner-scoped di `deviceStorage.ts` (per esempio `deviceKey('workout')`);
3. l'operazione è protetta da try/catch.

**Perché localStorage e non IndexedDB?** `localStorage.setItem()` è sincrono; IndexedDB si basa su transazioni asincrone che possono non completarsi prima del suspend del processo PWA.

## PWA Update Barrier

Il componente di ricarica della PWA (`src/lib/sync/reloadBarrier.ts`) regola gli aggiornamenti del Service Worker per prevenire la corruzione dei dati.
- **MUST:** Il reload barrier deve essere fail-safe. Se `state.userData` esiste in memoria ma l'envelope persistito è assente o corrotto, l'app deve bloccare l'aggiornamento (`isUnsaved = true`) perché il reload distruggerebbe stato non ancora salvato in modo sicuro.

## Merge deterministico (Guest -> Cloud)

Al collegamento di un account, se esistono dati guest locali:

1. viene eseguita una scansione cloud `all`;
2. il risultato viene idratato nell'envelope autenticato;
3. `mergeUserData()` produce il dataset guest+cloud e lo valida;
4. `commitLocal()` genera realmente le `SemanticOperation` dell'account autenticato;
5. `replicateJournal()` tenta il flush;
6. se l'esito è `local-pending`, il merged authenticated envelope resta la fonte locale e non viene sostituito da un reload cloud incompleto/stale.

`pendingConflicts.nutritionPlanning` resta un conflitto di prodotto separato dal generic causal merge.

## Offline resilience

In assenza di connessione, l'app opera dall'envelope IndexedDB e dai dati device-local. Quando la connessione ritorna, il journal viene rigiocato verso Firestore e i Vector Clock riconciliano le divergenze deterministicamente.

## Gate Milestone 0

`npm run verify:m0` deve eseguire lint, suite base, isolated, stress, Firestore emulator/rules, controllo assenza skip e build TypeScript/Vite. Un conteggio parziale di test verdi non equivale al superamento del gate completo.
