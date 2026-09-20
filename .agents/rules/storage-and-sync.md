# Storage e Sincronizzazione - LogBook

> Stato: normativo | Ultima verifica: 2026-09-20 | File verificati: `src/store/useAppStore.ts`, `src/lib/schemaEvolution.ts`, `src/lib/sync/transactionWriter.ts`, `src/lib/sync/replicateJournal.ts`, `src/lib/sync/semanticProjection.ts`, `src/lib/sync/documentProjection.ts`, `src/lib/sync/localRepository.ts`, `src/lib/sync/deviceStorage.ts`, `src/lib/sync/browserStorage.ts`, `src/contexts/AuthContext.tsx`, `src/main.tsx`

## Architettura di storage

L'app utilizza quattro livelli di storage con ruoli distinti:

| Livello | Tecnologia | Ruolo | Dati principali |
|---|---|---|---|
| **Stato operativo** | Zustand 5 (`useAppStore`) | Stato in memoria, single source of truth per i componenti React | Tutto `UserData`, `localWorkout`, `syncing`, `saveError`, `compatibilityStatus` |
| **Persistenza locale principale** | IndexedDB (`idb-keyval`) | Copia locale transazionale asincrona dell'envelope dati V4 | Chiave `logbook:v2:${owner}`; `v2` è namespace storage storico e NON è la versione dell'envelope |
| **Persistenza sincrona** | `localStorage` | Dati che richiedono salvataggio sincrono, preferenze e code boundary-specific | Namespace owner-scoped `logbook:v2:${owner}:*`, flag auth/guest, workout/timer, bozze e telemetria queued |
| **Replica remota** | Firestore | Sincronizzazione cloud e condivisione cross-device | Documento utente + subcollection mensilizzate |

**MUST:** offline, l'app deve avviarsi e operare dai dati locali (IndexedDB + storage sincrono pertinente).

## Browser storage boundary

`src/lib/sync/browserStorage.ts` centralizza i casi in cui è necessario distinguere accesso strict da best-effort:

- `readBrowserValueStrict()` fallisce con `BrowserStorageError` se `localStorage` non è disponibile/leggibile;
- `readBrowserValue()` degrada a `null` ed è adatto solo a hint/preferenze dove “mancante” e “illeggibile” possono avere la stessa semantica;
- write/remove strict propagano l'errore; gli helper `try*` sono ammessi soltanto nei boundary esplicitamente best-effort.

**MUST:** gate CRITICAL (ownership, lifecycle, logout, account deletion, reload/persistenza) non devono trasformare uno storage illeggibile in “chiave assente” se questa distinzione può cambiare una decisione distruttiva o di sicurezza.

**MAY:** preferenze, hint e code telemetriche possono restare best-effort quando il loro contratto non influenza l'integrità dei dati business.

Non dedurre da questa regola che ogni singolo accesso `localStorage` debba necessariamente passare dallo stesso helper: timer/workout e code specializzate possono avere boundary propri. La semantica strict vs best-effort deve però essere esplicita.

## Versioni indipendenti e Schema Evolution

`src/lib/schemaEvolution.ts` è l'unica fonte eseguibile per le versioni persistite:

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

**MUST:** le dimensioni `data schema` e `sync protocol` possono avanzare senza obbligare il bump di `local envelope` o `backup schema`. I registry data/sync ricevono quindi un migration carrier con scope `cloud`, `local-envelope` o `backup`, così lo stesso step N→N+1 può trasformare la rappresentazione persistita corretta per ciascun boundary mantenendo invariata la versione del container quando il container non cambia.

**MUST:** versioni future sconosciute causano fail-closed / `update-required`; è vietato fare downgrade distruttivo o riscrivere il documento come se fosse corrente.

**MUST:** `update-required` è uno stato applicativo persistente per la sessione corrente, non un semplice toast. Quando viene rilevato da un boundary cloud/local, nuove mutazioni e nuovi replay/sync vengono bloccati, i job ancora in debounce vengono chiusi senza partire e l'UI espone una barriera read-only/recoverable fino a reload/aggiornamento.

### Baseline clean-cut M1

Non esistono utenti/account reali da migrare da build precedenti. Per questo M1 stabilisce una baseline intenzionalmente clean-cut:

- nessuna migrazione prodotto da local envelope V3 a V4;
- nessuna importazione compatibile di backup V1/V2;
- i registry storici sono vuoti finché non esiste un vero bump futuro N→N+1;
- vecchi formati locali/backup vengono rifiutati e non riscritti;
- un documento Firestore senza `_schemaVersion` è considerato schema 1 baseline, senza eseguire migrazioni storiche;
- ogni documento Firestore realmente toccato da una semantic write viene riscritto lazy con `_schemaVersion: CURRENT_DATA_SCHEMA`;
- non esiste una scansione cloud solo per aggiornare i marker.

`DATA_MIGRATIONS` deve contenere in futuro solo step sequenziali N→N+1, puri, deterministici e senza side effect. Saltare uno step è errore. Uno step data/sync deve gestire esplicitamente gli scope persistiti che contengono quella dimensione; non deve ottenere la compatibilità forzando un bump artificiale del container.

## Pipeline di salvataggio transazionale (Journaling e Semantic Merge)

La pipeline V4 mantiene debounce e protocollo causale delle milestone precedenti, ma M8 rende esplicito l'intento business:

1. Le normali azioni UI/hook invocano `dispatchDomainOperation()` con una `DomainOperation` tipizzata.
2. Il reducer puro calcola il nuovo `UserData`; `commitDomainOperations()` compila soltanto lo scope dichiarato in `SemanticOperation` e persiste business state + journal nello stesso update IndexedDB.
3. `documentProjection.ts` proietta `UserData` in root + shard mensili; `semanticProjection.ts` è la fonte di merge policy, Vector Clock, tombstone, `$order` e active-workout guard.
4. `transactionWriter.ts` legge i documenti Firestore toccati, normalizza data schema + sync protocol, valida `_sync`, confronta `FieldStamp` remoto e operation locale, quindi esegue al massimo una write per documento toccato.
5. `replicateJournal.ts` drena lo stesso journal V4 verso Firestore. In assenza di rete o dopo timeout sicuro, le operation restano durevoli nel journal.
6. `hydrateLocal()` assorbe il causal context remoto senza modificare gli stamp delle pending già esistenti e riproduce il journal localmente.

I boundary bulk — bootstrap/initialize, hydration, guest→account merge, import/restore e recovery — possono continuare a usare il percorso snapshot `saveUserData/updateUserData/commitLocal`. Non costituiscono il percorso normativo per una normale mutazione utente. L'allowlist canonica e il boundary checker sono documentati in `.agents/rules/domain-operations.md`.

**MUST:** nuovi consumer business ordinari non possono introdurre bypass snapshot fuori dall'allowlist verificata dal gate M8.

**MUST:** Domain Operations V4 non cambia Data Schema 1, Sync Protocol 1, Local Envelope 4 o Backup Schema 3.

**MUST:** nessuna ottimizzazione del debounce cloud può posticipare la persistenza IndexedDB immediata.

**MUST:** gli helper legacy `syncHistoryMonths` / `syncNutritionMonths` non costituiscono la pipeline normativa di write. Le write utente correnti passano da journal + `transactionWriter`.

## Acknowledge causale e race remote commit → local edit → acknowledge

`acknowledgeThrough(owner, expectedSeq, remote, ..., syncMeta)` è un boundary CRITICAL.

Dopo che Firestore ha accettato un batch, una nuova modifica locale può essere committata prima che arrivi l'ack locale. In quel caso lo snapshot remoto appena confermato è causalmente più nuovo per il batch inviato ma più vecchio rispetto alla nuova modifica locale.

**MUST:** l'ack:

1. rimuove soltanto le pending con `seq <= expectedSeq`;
2. mantiene le pending con `seq > expectedSeq`;
3. assorbe il clock/sync metadata restituito dal remoto;
4. prende lo snapshot remoto confermato come nuova baseline;
5. rigioca semanticamente sopra tale snapshot soltanto le operation ancora pending;
6. preserva `pendingConflicts` local-only;
7. aggiorna `syncMetaByDocument` con il risultato del replay.

**MUST:** non usare `current.data` tal quale come sostituto del replay e non sostituire `data` con lo snapshot remoto quando `actorSeq`/pending sono avanzati: entrambi gli approcci possono perdere rispettivamente modifiche remote o modifiche locali.

La regressione è coperta anche attraverso il reale path transazionale Firestore/emulator: remote commit → edit locale concorrente → acknowledge → secondo flush → convergenza finale.

## Lost acknowledgement

Un timeout/rejection del chiamante non dimostra che il server non abbia applicato la write.

**MUST:** prima di classificare un batch come `local-pending` dopo un esito ambiguo, `replicateJournal` deve rileggere l'envelope IndexedDB e verificare che **l'intero batch appena consegnato** sia ancora presente nel journal. Se envelope/journal è assente, corrotto o contiene solo una parte del batch, l'esito non è un pending sicuro e deve essere classificato come failure secondo il contratto corrente.

Vedi anche `.agents/rules/crash-consistency.md`.

## Hydration cloud

Esistono due coperture distinte e non intercambiabili:

- `window`: normale startup/foreground, root + finestra mensile caricata. I mesi locali non letti dal cloud devono essere preservati.
- `all`: scansione esaustiva usata per guest→account/operazioni complete. I mesi locali assenti dallo snapshot remoto sono considerati assenti autorevolmente; le pending locali vengono rigiocate sopra lo snapshot completo.

**MUST:** una scansione `all` non deve essere trattata come una semplice finestra parziale.

## Esiti della sincronizzazione

Il sistema `replicateJournal` / `transactionWriter` gestisce l'esito:

| Status | Significato |
|---|---|
| `synced` | Mutazioni applicate confermate su Firestore |
| `rejected` | `permission-denied`: write rifiutata (App Check, Rules, dominio, auth); il client registra il rigetto |
| `local-pending` | Offline o esito ambiguo per cui il batch completo è ancora provato durevole nel journal |
| `failed` | Errore critico/non sicuro o stato locale incompatibile con un retry affidabile |

`update-required` è intenzionalmente separato da questi status di trasporto: rappresenta incompatibilità di versione e porta l'intera sessione in fail-closed.

**MUST:** una write rifiutata (`rejected`) non deve mai essere esposta all'utente come confermata.

**MUST:** le funzioni di salvataggio devono rigettare se l'accodamento della transazione locale fallisce in maniera critica. Vietato risolvere silenziosamente nel catch.

## Pre-render bootstrap

All'avvio dell'app (`initApp` in `src/main.tsx`), **prima** di `createRoot().render()`:

1. la cache utente viene recuperata da IndexedDB e assegnata a `window.__INITIAL_USER_DATA__`;
2. lo store Zustand viene inizializzato tramite `getInitialUserData()`, validando la cache con `UserDataSchema.parse()`.

Un envelope locale con versione legacy/futura non viene reinterpretato: `readLocal()` fallisce in modo conservativo e i bytes restano in IndexedDB per diagnosi/recupero. Se la versione è futura, il boundary locale segnala anche lo stato applicativo `update-required` prima che l'app diventi editabile.

## Blindatura in background (Safari Suspend)

Quando `document.visibilityState === 'hidden'`:

1. viene chiamato `draftRegistry.flushAll()` per salvare tutte le bozze;
2. i dati device-critical vengono scritti sincronicamente tramite le chiavi owner-scoped di `deviceStorage.ts` (per esempio `deviceKey('workout')`);
3. l'operazione è protetta secondo il boundary applicabile.

## PWA Update Barrier

Il componente di ricarica della PWA (`src/lib/sync/reloadBarrier.ts`) regola gli aggiornamenti del Service Worker per prevenire perdita/corruzione dati.

**MUST:** se `state.userData` esiste in memoria ma l'envelope persistito è assente, incompatibile o corrotto, l'app deve bloccare l'aggiornamento (`isUnsaved = true`).

## Merge deterministico (Guest → Cloud)

Al collegamento di un account, se esistono dati guest locali:

1. viene eseguita una scansione cloud `all`;
2. ogni documento viene version-normalizzato prima della composizione;
3. il risultato viene idratato nell'envelope autenticato;
4. `mergeUserData()` produce il dataset guest+cloud e lo valida;
5. `commitLocal()` genera le `SemanticOperation` dell'account autenticato;
6. `replicateJournal()` tenta il flush;
7. se l'esito è `local-pending`, il merged authenticated envelope resta la fonte locale.

`pendingConflicts.nutritionPlanning` resta un conflitto di prodotto separato dal generic causal merge e non è cloud-root.

## Backup / import

Il formato importabile corrente è `logbook-backup` V3 e contiene anche `dataSchemaVersion` e `syncProtocolVersion`.

**MUST:** backup/share/emergency export prodotti dalla factory corrente usano l'header V3 corrente.

**MUST:** backup V1/V2 e versioni future non vengono importati nella baseline clean-cut M1.

**NOTE:** `handleExportRecovery()` costituisce un carve-out intenzionale: può serializzare il vecchio archivio locale non attribuito come `logbook-backup` `version: 1` per recupero manuale. Quel raw legacy recovery file non è un backup V1 supportato dall'importer corrente e non deve essere presentato come tale.

Il recovery raw di un backup cloud può conservare i documenti originali con `_schemaVersion`/`_sync`, ma il business snapshot deve usare solo dati già normalizzati e deve escludere entrambi i metadati dal `UserData`.

## Offline resilience

In assenza di connessione, l'app opera dall'envelope IndexedDB e dai dati device-local. Quando la connessione ritorna, il journal viene rigiocato verso Firestore e i Vector Clock riconciliano le divergenze deterministicamente.

## Gate di regressione

`verify:m0`, `verify:m2`, `verify:m3`, `verify:m4` e `verify:m5` restano subgate/storici delle milestone che li hanno introdotti. Il gate repository umbrella corrente è:

```bash
npm run verify:m8
```

`verify:m8` include transitivamente M7 → M6 → M5 e i gate/suite precedenti. Un conteggio parziale di test verdi o il superamento del solo `verify:m0` non equivale alla validazione canonica corrente. Vedi `.agents/rules/ci-verification.md`.
