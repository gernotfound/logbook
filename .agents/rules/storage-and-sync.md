# Storage e Sincronizzazione - LogBook

> Stato: normativo | Ultima verifica: 2026-09-13 | File verificati: src/store/useAppStore.ts, src/lib/schemaEvolution.ts, src/lib/sync/transactionWriter.ts, src/lib/sync/replicateJournal.ts, src/lib/sync/semanticProjection.ts, src/lib/sync/documentProjection.ts, src/lib/sync/localRepository.ts, src/lib/sync/deviceStorage.ts, src/contexts/AuthContext.tsx, src/main.tsx

## Architettura di storage

L'app utilizza quattro livelli di storage con ruoli distinti:

| Livello | Tecnologia | Ruolo | Dati principali |
|---|---|---|---|
| **Stato operativo** | Zustand 5 (useAppStore) | Stato in memoria, single source of truth per i componenti React | Tutto UserData, localWorkout, syncing, saveError |
| **Persistenza locale principale** | IndexedDB (idb-keyval) | Copia locale transazionale asincrona dell'envelope dati V4 | Chiave `logbook:v2:${owner}`; `v2` è namespace storage storico e NON è la versione dell'envelope |
| **Persistenza sincrona** | localStorage | Dati che richiedono salvataggio sincrono istantaneo | Namespace owner-scoped `logbook:v2:${owner}:*` tramite `deviceStorage.ts`, flag auth/guest e bozze locali |
| **Replica remota** | Firestore (Firebase) | Sincronizzazione cloud, backup, condivisione cross-device | Documento utente + subcollection mensilizzate |

**MUST:** Offline, l'app deve avviarsi e operare dai dati locali (IndexedDB + localStorage).

## Versioni indipendenti e Schema Evolution

`src/lib/schemaEvolution.ts` è l'unica fonte normativa per le versioni persistite:

```ts
CURRENT_DATA_SCHEMA = 1
CURRENT_SYNC_PROTOCOL = 1
CURRENT_LOCAL_ENVELOPE = 4
CURRENT_BACKUP_SCHEMA = 3
```

Le quattro dimensioni NON devono essere riutilizzate come se fossero una sola versione:
- `data schema`: shape business persistita su Firestore;
- `sync protocol`: shape e semantica di `_sync` / Vector Clock;
- `local envelope`: shape IndexedDB del journal locale;
- `backup schema`: formato file JSON esportato/importato.

Pipeline obbligatoria per dati persistiti/versionati:

```text
RAW STORAGE
→ leggi versione
→ migra/normalizza in memoria
→ valida versione corrente
→ valida business schema
→ proietta / semantic merge
→ eventuale write corrente
```

**MUST:** migrazione/normalizzazione avviene PRIMA di `UserDataSchema`, `documentProjection` e semantic merge.

**MUST:** i documenti mensili vengono normalizzati individualmente prima di essere composti nel `UserData`; mixed-version shards non possono essere fusi alla cieca.

**MUST:** data business e `_sync` fanno parte dello stesso stato di migrazione logico. Una futura rinomina di campo deve poter rinominare anche la causal path corrispondente.

**MUST:** versioni future sconosciute causano fail-closed / `update-required`; è vietato fare downgrade distruttivo o riscrivere il documento come se fosse corrente.

### Baseline clean-cut M1

Non esistono utenti/account reali da migrare da build precedenti. Per questo M1 stabilisce una baseline intenzionalmente clean-cut:
- nessuna migrazione prodotto da local envelope V3 a V4;
- nessuna importazione compatibile di backup V1/V2;
- i registry storici sono vuoti finché non esiste un vero bump futuro N→N+1;
- vecchi formati locali/backup vengono rifiutati e non riscritti;
- un documento Firestore senza `_schemaVersion` è considerato schema 1 baseline, senza eseguire migrazioni storiche;
- ogni documento Firestore realmente toccato da una semantic write viene riscritto lazy con `_schemaVersion: CURRENT_DATA_SCHEMA`;
- non esiste una scansione cloud solo per aggiornare i marker.

`DATA_MIGRATIONS` deve contenere in futuro solo step sequenziali N→N+1, puri, deterministici e senza side effect. Saltare uno step è errore.

## Pipeline di salvataggio transazionale (Journaling e Semantic Merge)

La pipeline V3 mantiene il debounce solo per il tentativo di replica cloud, ma rende immediata e durevole la persistenza locale:

1. I componenti invocano `saveUserData` / `updateUserData` tramite lo store.
2. Prima del debounce cloud, `commitLocal()` persiste immediatamente in IndexedDB lo stato e le `SemanticOperation` nel journal owner-scoped.
3. `documentProjection.ts` proietta UserData in root + shard mensili; `semanticProjection.ts` genera diff deterministici per proprietà/entità con Vector Clock e tombstone.
4. `transactionWriter.ts` legge i documenti Firestore toccati, normalizza data schema + sync protocol, valida `_sync`, confronta FieldStamp remoto e operation locale, quindi esegue al massimo una write per documento toccato.
5. `replicateJournal.ts` drena il journal verso Firestore. In assenza di rete o dopo timeout, le operation restano durevoli nel journal.
6. `hydrateLocal()` assorbe il causal context remoto senza modificare gli stamp delle pending già esistenti e riproduce il journal localmente.

**MUST:** nessuna ottimizzazione del debounce cloud può posticipare la persistenza IndexedDB immediata.

**MUST:** gli helper legacy `syncHistoryMonths` / `syncNutritionMonths` non costituiscono la pipeline normativa di write. Le write utente correnti passano da journal + `transactionWriter`.

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

Un envelope locale con versione legacy/futura non viene reinterpretato: `readLocal()` fallisce in modo conservativo e i bytes restano in IndexedDB per diagnosi/recupero.

## Blindatura in background (Safari Suspend)

Quando `document.visibilityState === 'hidden'`:
1. viene chiamato `draftRegistry.flushAll()` per salvare tutte le bozze;
2. i dati device-critical vengono scritti sincronicamente tramite le chiavi owner-scoped di `deviceStorage.ts` (per esempio `deviceKey('workout')`);
3. l'operazione è protetta da try/catch.

## PWA Update Barrier

Il componente di ricarica della PWA (`src/lib/sync/reloadBarrier.ts`) regola gli aggiornamenti del Service Worker per prevenire la corruzione dei dati.
- **MUST:** Se `state.userData` esiste in memoria ma l'envelope persistito è assente, incompatibile o corrotto, l'app deve bloccare l'aggiornamento (`isUnsaved = true`).

## Merge deterministico (Guest -> Cloud)

Al collegamento di un account, se esistono dati guest locali:

1. viene eseguita una scansione cloud `all`;
2. ogni documento viene version-normalizzato prima della composizione;
3. il risultato viene idratato nell'envelope autenticato;
4. `mergeUserData()` produce il dataset guest+cloud e lo valida;
5. `commitLocal()` genera le `SemanticOperation` dell'account autenticato;
6. `replicateJournal()` tenta il flush;
7. se l'esito è `local-pending`, il merged authenticated envelope resta la fonte locale.

`pendingConflicts.nutritionPlanning` resta un conflitto di prodotto separato dal generic causal merge.

## Backup / import

Il formato corrente è `logbook-backup` V3 e contiene anche `dataSchemaVersion` e `syncProtocolVersion`.

**MUST:** backup, share ed emergency export usano lo stesso header versionato prodotto dalla factory corrente.

**MUST:** backup V1/V2 e versioni future non vengono importati nella baseline clean-cut M1.

Il recovery raw di un backup cloud può conservare i documenti originali con `_schemaVersion`/`_sync`, ma il business snapshot deve usare solo dati già normalizzati e deve escludere entrambi i metadati dal `UserData`.

## Offline resilience

In assenza di connessione, l'app opera dall'envelope IndexedDB e dai dati device-local. Quando la connessione ritorna, il journal viene rigiocato verso Firestore e i Vector Clock riconciliano le divergenze deterministicamente.

## Gate di regressione

`npm run verify:m0` continua a essere il gate minimo obbligatorio durante M1: lint, suite base, isolated, stress, Firestore emulator/rules, controllo assenza skip e build TypeScript/Vite. I test M1 di schema evolution fanno parte delle suite esistenti; un conteggio parziale di test verdi non equivale al superamento del gate completo.
