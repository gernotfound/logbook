# Storage e sincronizzazione — TheLogBook

**Quando leggere:** IndexedDB, journal, versioni, hydration, replica, bootstrap e PWA update/reload.
**Non inferire:** stato memoria, durabilità locale, ACK cloud e recupero completo sono prove distinte.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Contratti collegati

- [Archivio e cifratura](secure-storage.md): vault device, ADK cloud, ciphertext e provisioning.
- [Bozze e stato device](device-drafts.md): workout, timer, testimoni, concorrenza editor e background.
- [Ciclo account](account-lifecycle.md) e [Consenso salute](health-consent.md): identità, guest, revisioni, logout e cancellazioni.
- [Portabilità](backup-and-portability.md): backup/import/export; [Privacy tecnica](telemetry-and-privacy.md): nessun invio automatico di errori.
- [Crash consistency](crash-consistency.md), [Causal GC](causal-gc.md), [Domain Operations](domain-operations.md): specifiche di commit/ACK e protocollo.

## Stati di durabilità e relative prove

| Stato | Prova disponibile | Cosa non dimostra |
|---|---|---|
| Valore soltanto in React/Zustand | Render o edit UI | Durabilità dopo crash/reload |
| Envelope e journal in IndexedDB | Commit locale atomico autenticato | Firestore aggiornato o ACK cloud |
| `local-pending` | Per errori di consegna/trasporto serve la prova del batch durevole e riproducibile secondo [Crash consistency](crash-consistency.md); un blocco preliminare del consenso può invece restituire lo stesso status prima di leggere l'envelope | Lo status da solo non prova l'esistenza di pending né l'assenza di una write cloud: il timeout può seguire un commit |
| Batch cloud confermato e ACK valido | Writer remoto e `acknowledgeThrough()` attestati per quel batch | Integrità di mesi non compresi nella scansione |
| `replica-fenced` / `update-required` | Integrità o versione non provata | Permesso di reinizializzare o cancellare archivi |

**MUST:** non avanzare fra questi stati sulla base di tempo trascorso, segnali UI o sola rete. La prova di commit/ACK e i failure path restano nel contratto specialistico [Crash consistency](crash-consistency.md).

## Architettura di storage

L'app utilizza quattro livelli di storage con ruoli distinti:

| Livello | Tecnologia | Ruolo | Dati principali |
|---|---|---|---|
| **Stato operativo** | Zustand (`useAppStore`) | Stato in memoria, single source of truth per i componenti React | Tutto `UserData`, `localWorkout`, `syncing`, `saveError`, `compatibilityStatus` |
| **Persistenza locale principale** | IndexedDB (`idb-keyval`) | Copia locale transazionale asincrona dell'envelope dati V5 | Chiave `logbook:v2:${owner}`; `v2` è namespace storage storico e NON è la versione dell'envelope |
| **Persistenza sincrona** | `localStorage` | Dati che richiedono salvataggio sincrono, preferenze e code boundary-specific | Namespace owner-scoped `logbook:v2:${owner}:*`, flag auth/guest, workout/timer e bozze |
| **Replica remota** | Firestore | Sincronizzazione cloud e condivisione cross-device | Documento utente + subcollection mensilizzate |

**MUST:** offline, l'app deve avviarsi e operare dai dati locali (IndexedDB + storage sincrono pertinente).

**MUST:** la cache locale del client Firestore resta **memory-only**. La durabilità offline dei dati utente appartiene all'envelope IndexedDB owner-scoped di TheLogBook; non introdurre `persistentLocalCache()` come seconda copia persistente non gestita dal lifecycle di logout/cancellazione account.

## Browser storage boundary

`src/lib/sync/browserStorage.ts` centralizza gli errori di accesso allo storage dei boundary applicativi:

- `readBrowserValueStrict()` fallisce con `BrowserStorageError` se `localStorage` non è disponibile/leggibile;
- write/remove strict propagano l'errore.

**MUST:** gate CRITICAL (ownership, lifecycle, logout, account deletion, reload/persistenza) non devono trasformare uno storage illeggibile in “chiave assente” se questa distinzione può cambiare una decisione distruttiva o di sicurezza.

**MUST (CRITICAL, device senza vault):** in assenza di un controllo vault `active`, `readDeviceValueStrict` e `writeDeviceValue` non forniscono fallback plaintext e non possono creare, cancellare o sostituire alcuna copia: le letture rigorose del namespace vecchio e `sealed:` identificano errori di storage e byte orfani senza modificarli. Anche la mancanza di entrambi i record è un errore di vault, non un permesso a salvare in chiaro. Un errore di lettura del browser non autorizza una conclusione «assenza di dati». Le letture best-effort restano riservate a preferenze e suggerimenti non distruttivi.

**MAY:** soltanto preferenze e hint non critici possono restare best-effort quando il loro contratto non influenza l'integrità dei dati business. Non sono più presenti code diagnostiche di errore; timer/workout e code specializzate conservano i rispettivi gateway strict.

## Versioni indipendenti e Schema Evolution

`src/lib/schemaEvolution.ts` è l'unica fonte eseguibile per le versioni persistite:

`CURRENT_DATA_SCHEMA`, `CURRENT_SYNC_PROTOCOL`, `CURRENT_LOCAL_ENVELOPE` e `CURRENT_BACKUP_SCHEMA` definiscono i valori e le baseline accettate. Leggerli dal file corrente prima di cambiare un formato; i namespace storage non ne rappresentano la versione.

Le quattro dimensioni NON devono essere riutilizzate come una sola versione, né incrementate per il semplice bump della versione PWA in `package.json`:

- `data schema`: shape business persistita su Firestore;
- `sync protocol`: shape e semantica di `_sync` / Vector Clock;
- `local envelope`: shape IndexedDB del journal locale;
- `backup schema`: formato file JSON esportato/importato.

Pipeline obbligatoria per dati persistiti/versionati:

```text
RAW STORAGE
→ leggi versione
→ applica solo le evoluzioni supportate in memoria
→ valida versione corrente
→ valida business schema
→ proietta / semantic merge
→ eventuale write corrente
```

**MUST:** migrazione/normalizzazione avviene PRIMA di `UserDataSchema`, `documentProjection` e semantic merge.

**MUST (archivio IndexedDB corrente):** dopo la verifica delle versioni, il parsing Zod di `data`, `baseline` e delle copie `archivedConsentJournals` non può scartare o sostituire valori business originariamente autenticati dal vault. Il confronto lossless, condiviso col boundary cloud, ammette solo le conversioni scalari reversibili comprovate. In caso contrario la lettura e ogni commit successivo falliscono senza riscrivere il ciphertext originale; un fallback Zod non dimostra l’assenza di dati.

**MUST:** i documenti mensili vengono normalizzati individualmente prima di essere composti nel `UserData`; mixed-version shards non possono essere fusi alla cieca.

**MUST:** data business e `_sync` fanno parte dello stesso stato di migrazione logico. Una futura rinomina di campo deve poter rinominare anche la causal path corrispondente.

**MUST:** le dimensioni `data schema` e `sync protocol` possono avanzare senza obbligare il bump di `local envelope` o `backup schema`. I registry data/sync ricevono quindi un migration carrier con scope `cloud`, `local-envelope` o `backup`, così lo stesso step N→N+1 può trasformare la rappresentazione persistita corretta per ciascun boundary mantenendo invariata la versione del container quando il container non cambia.

**MUST:** versioni future sconosciute causano fail-closed / `update-required`; è vietato fare downgrade distruttivo o riscrivere il documento come se fosse corrente.

**MUST:** `update-required` è uno stato applicativo persistente per la sessione corrente, non un semplice toast. Quando viene rilevato da un boundary cloud/local, nuove mutazioni e nuovi replay/sync vengono bloccati, i job ancora in debounce vengono chiusi senza partire e l'UI espone una barriera read-only/recoverable fino a reload/aggiornamento.

### Formati supportati e future evoluzioni

Applicare il fresh start di AGENTS. Tutti i nuovi writer usano namespace owner-scoped e formati correnti; chiavi globali pre-lancio non sono sorgenti di recupero né target di purge. Non importare backup V1/V2 o migrare Protocol 1/2 ed Envelope 4: il rifiuto conserva gli originali. Recovery dopo crash, consenso e concorrenza della baseline corrente restano obbligatori.

Un documento Firestore presente senza marker data/sync correnti è incompatibile; non inventare causalità. Ogni documento effettivamente toccato da semantic write porta i marker correnti, senza una scansione dedicata al solo aggiornamento dei marker.

`DATA_MIGRATIONS` deve contenere in futuro solo step sequenziali N→N+1, puri, deterministici e senza side effect. Saltare uno step è errore. Uno step data/sync deve gestire esplicitamente gli scope persistiti che contengono quella dimensione; non deve ottenere la compatibilità forzando un bump artificiale del container.

## Pipeline di salvataggio transazionale (Journaling e Semantic Merge)

La pipeline V4 mantiene debounce e protocollo causale delle milestone precedenti, ma M8 rende esplicito l'intento business:

1. Le normali azioni UI/hook invocano `dispatchDomainOperation()` con una `DomainOperation` tipizzata.

2. Il reducer puro calcola il nuovo `UserData`; `commitDomainOperations()` compila soltanto lo scope dichiarato in `SemanticOperation` e persiste business state + journal nello stesso update IndexedDB.

3. `documentProjection.ts` proietta `UserData` in root + shard mensili; `semanticProjection.ts` è la fonte di merge policy, Vector Clock, tombstone, `$order` e active-workout guard.

4. `transactionWriter.ts` legge i documenti Firestore toccati, normalizza data schema + sync protocol, valida `_sync`, confronta `FieldStamp` remoto e operation locale, quindi esegue al massimo una write per documento toccato.

5. `replicateJournal.ts` drena lo stesso journal Envelope V5 verso Firestore in gruppi causali completi e bounded. In assenza di rete o dopo timeout sicuro, le operation restano durevoli nel journal.

6. `hydrateLocal()` assorbe il causal context remoto senza modificare gli stamp delle pending già esistenti e riproduce il journal localmente.

**MUST:** una singola transazione sync può toccare al massimo 8 documenti business oltre a `sync_control/state`. Il limite è intenzionalmente conservativo rispetto al tetto Firestore di 10 MiB e al guardrail per-documento da 950.000 byte.

**MUST:** il limite non si applica facendo slice arbitrari delle operation. Tutte le operation dello stesso documento restano nello stesso gruppo; se una mutazione bulk tocca più di 8 documenti, `commitLocal` / `commitDomainOperations` assegnano sequence causali successive. `replicateJournal` può coalescere più sequence complete nella stessa transazione finché l’unione resta entro 8 documenti, poi acknowledge fino all’ultima sequence effettivamente consegnata.

**MUST:** un journal nel formato supportato con una singola sequence oltre il limite viene resequenziato atomicamente in IndexedDB prima della prima consegna; questo guard protegge il batching corrente, non importa un protocollo pre-lancio. Una sequence non può essere consegnata parzialmente con lo stesso numero causale.


### Sync Protocol 3 — causal core e replica fencing

`FieldStamp.clock` è il timestamp causale immutabile dell'evento vincitore del field. `SyncMeta.clock` è invece il frontier cumulativo degli eventi osservati nel documento.

**MUST:** un contender perdente, una retry o una operation respinta da lifecycle guard può avanzare `SyncMeta.clock`, ma non può modificare retroattivamente `FieldStamp.clock` del winner.

**MUST:** l'arbitraggio dei `FieldStamp` usa un ordine totale compatibile con happens-before (attualmente `compareStamps()` in `semanticProjection/metadata.ts`): causal dominance; peso monotono del vector clock (somma delle coordinate); delete bias solo a parità di peso; actor/seq; vector order canonico. Questa relazione deve restare transitiva.

**MUST:** prima dell'arbitraggio del singolo field, un descendant deve coprire causalmente lo stamp ancestor e la sua eventuale barriera delete. Una write ancestor rivaluta i descendant visibili e i candidate nascosti: soltanto quelli che coprono tale contesto e soddisfano la guard possono essere riapplicati. L'ordine totale sceglie il winner fra i contender ammissibili dello stesso field; superare un ancestor nel tie-break non dimostra copertura causale. Un contender bloccato avanza solo il frontier documentale, senza riscrivere lo stamp ancestor.

Il primo account reale nasce direttamente su Sync Protocol 3. Metadata cloud/local/backup con Protocol 1 o 2 sono fuori baseline e vengono rifiutati senza riscrittura; da questo punto in poi eventuali nuove migrazioni sync devono essere introdotte solo per versioni realmente persistite dopo il lancio. Client futuri restano fail-closed secondo le regole di schema evolution.

I boundary bulk — bootstrap/initialize, hydration, guest→account merge, import/restore e recovery — possono continuare a usare il percorso snapshot `saveUserData/updateUserData/commitLocal`. Non costituiscono il percorso normativo per una normale mutazione utente. L'allowlist canonica e il boundary checker sono documentati in `.agents/rules/domain-operations.md`.

**MUST:** nuovi consumer business ordinari non possono introdurre bypass snapshot fuori dall'allowlist verificata dal gate M8.

**MUST:** le quattro versioni e le baseline accettate restano quelle di `schemaEvolution.ts`; cambiarne una richiede l'evoluzione supportata e le verifiche pertinenti. Il journal persiste l'identità replica; un envelope fuori supporto viene rifiutato senza conversione.

**MUST:** nessuna ottimizzazione del debounce cloud può posticipare la persistenza IndexedDB immediata.

**MUST:** `transactionWriter` è l'unico writer client dei documenti business Firestore root/mensili. I vecchi helper diretti `syncHistoryMonths` / `syncNutritionMonths` sono ritirati: nessun percorso client può scrivere documenti business privi di `_schemaVersion` e `_sync` Protocol 3.

### Replica checkpoint, lease e stable frontier

**MUST (CRITICAL, sessione durante manutenzione del vault):** il risequenziamento del journal per i batch Firestore e le scritture locali di barriera cloud o checkpoint replica devono ricontrollare la sessione/Auth/consenso corrente nella callback sincrona della transazione IndexedDB. Un'operazione di manutenzione iniziata da una sessione obsoleta non può alterare un journal, un ciphertext o una replica adottati dalla sessione subentrata. Il controllo prima/dopo un `await` nel chiamante non sostituisce questo fence atomico.

Protocol 3 limita i nuovi actor a 16 slot `s00`…`s15` registrati in `users/{uid}/sync_control/state`. Ogni incarnazione di un device ha `replicaId` e `generation`; il riuso dello slot incrementa la generation e continua la sequence monotona.

- **MUST:** una replica assente, con checkpoint oltre 30 giorni o prossima alla fine lease esegue `loadCloudPayload({ allMonths: true })` e hydration `all` prima di ottenere/rinnovare lo slot.
- **MUST:** `adoptReplicaCheckpoint()` ribasa eventuali pending locali sul nuovo slot senza perderle.
- **MUST:** `replicateJournal()` rifiuta journal appartenenti a slot/generation precedenti.
- **MUST:** `transactionWriter` aggiorna documenti business e `sync_control.lastSeq` nella stessa transazione e persiste `_sync.writer` con slot/replicaId/generation/seq.
- **MUST:** la stable frontier usata per terminal GC è il minimo componente-per-componente dei checkpoint delle sole repliche active.
- **MUST:** la lease/retirement usa il wall clock solo per membership/fencing; non costituisce mai prova causale per rimuovere una tombstone.
- **MUST:** dopo il cutover Protocol 3 i client non eliminano fisicamente i documenti sync root/mensili; un documento causalmente vuoto resta come empty shell fenced con `_schemaVersion` e `_sync.writer`.

Le Rules rendono autorevoli membership, generation e scadenza lease tramite `request.time`. La completezza del checkpoint deriva invece dal full scan obbligatorio del client ed è un'invariante di protocollo coperta dai test, non una prova di lettura verificabile crittograficamente dalle Rules.

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
7. **MUST:** aggiorna `syncMetaByDocument` esclusivamente con le prove `_sync` ricevute dal server o già verificate e conservate fuori scope: i metadati derivati dal replay delle operazioni ancora `pending` non sono una conferma remota e non possono diventare un falso storico di documenti cloud esistenti. Mantiene separati stato business in memoria/IDB e metadati di delivery effettiva.

**MUST:** non usare `current.data` tal quale come sostituto del replay e non sostituire `data` con lo snapshot remoto quando `actorSeq`/pending sono avanzati: entrambi gli approcci possono perdere rispettivamente modifiche remote o modifiche locali.

La regressione è coperta anche attraverso il reale path transazionale Firestore/emulator: remote commit → edit locale concorrente → acknowledge → secondo flush → convergenza finale.

## Lost acknowledgement

**MUST:** timeout o rejection del chiamante non dimostrano l'assenza di commit remoto. Prima di classificare `local-pending`, rileggere l'envelope persistito e provare che l'intero batch consegnato è ancora presente e riproducibile con payload causale completo identico. Se la prova manca, restituire un failure senza dichiarare recupero sicuro. La specifica su identità del batch, `value`/`clock`/`guard`, epoch e race è in [Crash consistency](crash-consistency.md).

## Hydration cloud

**MUST:** distinguere tre condizioni: (1) uno snapshot cloud con documenti confermati mancanti o causalmente obsoleti è una violazione di integrità; (2) un cambio del registro `sync_control` durante la scansione è una lettura concorrente da ripetere con budget limitato; (3) errori di trasporto, capienza replica e checkpoint non costituiscono prova di dati cloud scomparsi. Solo la violazione di integrità impone la barriera owner-scoped che blocca anche il purge/logout. Il rilevamento della violazione e la registrazione del fence avvengono **nello stesso commit IndexedDB**, senza modificare dati business o journal. Lo sblocco richiede una nuova lettura completa dal server e un checkpoint replica verificato; un cambiamento concorrente invalida la prova.

Esistono due coperture distinte e non intercambiabili:

- `window`: normale startup/foreground, root + finestra mensile caricata. I mesi locali non letti dal cloud devono essere preservati.
- `all`: scansione esaustiva usata per guest→account/operazioni complete. I mesi locali assenti dallo snapshot remoto sono considerati assenti autorevolmente; le pending locali vengono rigiocate sopra lo snapshot completo.

**MUST:** una scansione `all` non deve essere trattata come una semplice finestra parziale.

**MUST:** il confronto per un no-op usa la stessa rappresentazione JSON dell'archivio: una proprietà opzionale assente e una proprietà oggetto con valore `undefined` non sono una modifica business. Una hydration identica deve conservare revisione e ciphertext, così le anteprime di recovery restano valide; cambi effettivi a dati, baseline, copertura o frontiera causale devono invece invalidarle.

**MUST:** se hydration o checkpoint non forniscono una base cloud validata per la sessione, il caricatore autenticato deve segnalare l'esito bloccato al chiamante e non avviare il replay automatico del journal. Il fallimento non elimina alcuna pending locale; il recovery riprova soltanto dopo una nuova base validata.

**MUST (CRITICAL):** se una lettura cloud fallisce e non esiste un envelope locale owner-scoped, l'assenza della copia sul dispositivo NON prova che l'account remoto sia vuoto. Il bootstrap autenticato non deve costruire e salvare uno snapshot business predefinito come fallback, né generare un journal causale su una base remota non verificata; espone un errore recuperabile e riprova dopo una lettura cloud riuscita. In presenza di envelope valido, resta accessibile la copia locale senza attribuire un ACK remoto.

**MUST:** le letture Firestore che costruiscono `cloudDocuments` per la hydration (`root`, mesi nella finestra e scansione completa) devono provenire esplicitamente dal server: una risposta `getDoc()` con fallback alla cache in memoria non certifica assenza né freschezza del documento. Ogni lettura logica viene racchiusa tra due osservazioni server di `users/{uid}/sync_control/state`; la stessa versione ai due estremi attesta l'assenza di mutazioni business attraverso il writer Protocol 3 durante la scansione. Se cambia, ricominciare da zero una sola volta e poi fallire senza pubblicare evidenza incompleta; non confondere questa garanzia con una transazione Firestore su write amministrative esterne al protocollo. In caso di timeout/offline, interrompere l'acquisizione cloud senza pubblicare uno snapshot parziale; la riapertura e le mutazioni locali già autorizzate restano fondate sul vault IndexedDB.

**MUST (CRITICAL, baseline pre-lancio ritirata):** durante hydration nessun metadato già presente in `syncMetaByDocument` può essere scartato perché privo di `_sync.writer`, `clock` o `FieldStamp`. Il percorso di autoriparazione di placeholder prodotti da release pre-lancio non è supportato. Per la versione corrente ogni voce della mappa rappresenta un documento confermato dal server, anche se causalmente vuoto. Se il documento manca nello scope autorevole, installare il fence di integrità e conservare dati, baseline e journal senza cancellazione automatica.

**MUST (CRITICAL):** se `cloudDocuments` è disponibile e la copia locale possiede già metadati causali durevoli per un documento compreso nello scope autorevole della hydration, lo snapshot remoto deve includere il documento con `_sync`. Il clock remoto deve inoltre coprire causalmente quello durevole locale: una versione più vecchia o incomparabile non è una prova valida. Per `all` lo scope include tutti i documenti già osservati; per `window` solo root e mesi richiesti. Se la prova manca o è obsoleta, sospendere la hydration con `replica-fenced`, conservare dati business e journal senza modifiche, registrare atomicamente il fence di integrità nell'envelope IndexedDB e non avanzare al checkpoint della replica. I documenti di sync Protocol 3 non vengono eliminati fisicamente; un mese mai osservato localmente può invece risultare legittimamente assente nel cloud.

## Esiti della sincronizzazione

Il sistema `replicateJournal` / `transactionWriter` gestisce l'esito:

| Status | Significato |
|---|---|
| `synced` | Tentativo concluso senza pending da consegnare; per un batch account consegnato include conferma remota e ACK locale |
| `rejected` | `permission-denied`: write rifiutata (App Check, Rules, dominio, auth); il client registra il rigetto |
| `local-pending` | Offline o esito ambiguo con batch completo provato durevole nel journal; oppure blocco preliminare del consenso, senza attestazione implicita di pending |
| `failed` | Errore critico/non sicuro o stato locale incompatibile con un retry affidabile |

La classificazione ispeziona solo proprietà proprie degli errori e una catena `cause` limitata. Se restano cause non ispezionate, un codice di rete esterno non basta a classificare l'esito come `local-pending`: serve la prova indipendente del batch ancora durevole, altrimenti l'esito è `failed`. Un `permission-denied` già osservato resta `rejected`, salvo il recupero di un ACK perso con prova indipendente; un rigetto diretto resta sempre `rejected`.

`synced` viene restituito anche per il guest e per un journal già vuoto: da solo non prova una nuova write Firestore della specifica operazione.

`update-required` è intenzionalmente separato da questi status di trasporto: rappresenta incompatibilità di versione e porta l'intera sessione in fail-closed.

**MUST:** una write rifiutata (`rejected`) non deve mai essere esposta all'utente come confermata.

**MUST:** un journal account con dati business non può replicarsi prima di un consenso account valido (`needsLegalUpdate` falso). La sospensione della replica è `local-pending` con motivo `legal-consent-required`, distinto dalla mancanza di rete; eventuali pending già committate restano durevoli; la riapertura segue la riconciliazione trusted e, per pending di una revisione precedente, il recupero separato esplicito previsto da [Consenso salute](health-consent.md). Il consenso della sessione ospite non costituisce consenso dell'account. Le Rules e la revoca server-autorevole richiedono un gate separato e non si considerano risolte da questo controllo client.

**MUST:** le funzioni di salvataggio devono rigettare se l'accodamento della transazione locale fallisce in maniera critica. Vietato risolvere silenziosamente nel catch.

## Pre-render bootstrap e ownership

`initApp` in `src/main.tsx` inizializza aspetto, catalogo e stato storage prima del render, ma non carica un archivio account a partire dal solo hint UID.

- Guest: verificare marker/generazione, preparare il vault owner-scoped e leggere l'envelope prima di pubblicare `window.__INITIAL_USER_DATA__`, workout e store.
- Account: `bootstrapOwner` resta nullo nel pre-render; AuthProvider conferma l'identità Firebase e gestisce sblocco/lettura dell'archivio account. L'hint persistito è solo un'indicazione, non una prova Auth.
- Cache, business e copie device attraversano gateway di versione, AEAD, Zod e integrità. Byte incompatibili o non leggibili restano preservati; una versione futura porta a `update-required` prima dell'editing.
- Nessun default sintetico può diventare baseline cloud dopo un caricamento fallito.

## Concorrenza bootstrap e revoca guest cross-tab

**MUST:** logout guest e login guest esplicito (incluso recovery di purge incompleto) condividono un Web Lock esclusivo per origine che copre l'intero purge e il passaggio alla nuova generazione. Dopo una conferma asincrona, la vecchia sessione va rivalidata all'interno del lock prima della revoca. Senza lock disponibile la transizione distruttiva fallisce chiusa senza avviare la cancellazione. Una nuova generazione non deve ereditare lo snapshot in memoria della sessione revocata.

**MUST:** `initializeLocal()` crea un envelope soltanto se assente nella transazione IndexedDB; un archivio già comparso, anche guest con journal vuoto o account già acknowledged, non viene sovrascritto da un seed obsoleto.

**MUST:** tutti gli snapshot-save asincroni da store ricevono un guard di sessione verificato all'interno del commit IndexedDB, non solo dopo la persistenza. Logout e reset invalidano la sessione prima del purge.

**MUST:** il logout guest scrive il tombstone `logbook_guest_revoked_v1` prima del purge. Gli altri realm devono invalidare UI, draft e workout e non possono ricreare dati eliminati. `logbook_guest_session_id_v1` lega una generazione alla singola sessione/realm: una nuova entrata guest esplicita non riabilita le schede vecchie. Un purge incompleto mantiene la revoca fino a nuova entrata esplicita che ripulisce il residuo.

**MUST:** i salvataggi device-critical (workout, bozze e flush in background) rispettano la revoca guest anche quando non passano da IndexedDB. Storage non leggibile non conferisce autorizzazione alla scrittura.

## Background

Il salvataggio sincrono e i confronti sul workout osservato prima del flush sono in [Bozze e stato device](device-drafts.md). Il journal IndexedDB resta la fonte di durabilità e il background non modifica i gate Auth/consenso.

## PWA Update Barrier

Il componente di ricarica della PWA (`src/lib/sync/reloadBarrier.ts`) regola gli aggiornamenti del Service Worker per prevenire perdita/corruzione dati.

**MUST:** se `state.userData` esiste in memoria ma l'envelope persistito è assente, incompatibile o corrotto, l'app deve bloccare il reload tramite un errore della barriera `prepareForReload()`, senza confondere memoria e copia durevole.

**MUST:** dalla schermata di accesso, senza account né generazione guest attiva e senza dati business o salvataggi in memoria, l'aggiornamento PWA può procedere senza creare una sessione guest o leggere/azzerare archivi owner-scoped persistiti. Se esiste stato in memoria non attribuibile, la barriera resta fail-closed.

**MUST:** una differenza tra Zustand e IndexedDB non prova che IndexedDB sia indietro. La tab mantiene in memoria la provenienza causale del proprio snapshot: solo modifiche marcate dirty rispetto a una base osservata possono essere rigiocate, e il replay applica il delta base→desired sopra l'envelope durevole corrente. Una tab clean ma stale si riallinea a IndexedDB senza generare delete/tombstone.

**MUST:** i boundary snapshot bulk (`commitLocal`, import/restore e recovery compatibili) calcolano l'intento rispetto alla base osservata dal chiamante e lo applicano all'envelope corrente. Entità o campi creati concorrentemente e assenti dalla base del chiamante non possono essere interpretati come cancellazioni.

Gli aggiornamenti PWA sono differibili. Prima del reload: flush delle bozze, attesa dei salvataggi, confronto fra store e copia IndexedDB e snapshot sincrono del workout. Errori locali bloccano il reload. Un errore di caricamento chunk apre lo stesso prompt; non scatena più un reload automatico che può ripetersi.

**MUST (CRITICAL, controllo del reload PWA):** il callback `onNeedReload` di Workbox non deve avviare autonomamente una navigazione quando il nuovo service worker prende il controllo. Soltanto il percorso esplicito dell'utente può ricaricare, dopo attivazione verificata e seconda barriera di persistenza immediatamente prima della navigazione. Un'attivazione lenta non equivale a fallimento; chiudere l'avviso durante l'attesa deve annullare il reload differito, anche se il worker si attiva successivamente. La presa di controllo in altre schede non autorizza a ricaricarle senza i rispettivi controlli di durabilità.

## Merge deterministico (Guest → Cloud)

Al collegamento di un account, se esistono dati guest locali:

1. viene eseguita una scansione cloud `all`;
2. ogni documento viene version-normalizzato prima della composizione;
3. il risultato viene idratato nell'envelope autenticato;
4. `mergeUserData()` produce il dataset guest+cloud e lo valida;
5. `commitLocal()` genera le `SemanticOperation` dell'account autenticato;
6. `replicateJournal()` tenta il flush;
7. se l'esito è `local-pending`, il merged authenticated envelope resta la fonte locale.

La policy business di `mergeUserData()` conserva l'unione deduplicata degli array con ID con priorità guest in collisione, il merge per data/ID dei record giornalieri e i valori scalari guest valorizzati. **Eccezione di sicurezza:** `legalConsent` resta quello dell'account; il guest non autorizza il trattamento account. “Guest wins” non dimostra maggiore recenza: verificare implementazione e test prima di cambiarlo. La pianificazione nutrizionale mantiene il proprio conflitto e le regole di origine in [Modello dati](data-model-and-zod.md).

`pendingConflicts.nutritionPlanning` resta un conflitto di prodotto separato dal generic causal merge e non è cloud-root. Il merge guest adotta questi metadati locali attraverso l'opzione esplicita di `commitLocal`, con la revisione dell'envelope osservato e il guard di sessione verificati nello stesso update IndexedDB. Anche un merge dei soli metadati deve diventare durevole e avanzare la revisione locale, senza inventare sequence, clock o operation cloud. Uno snapshot ordinario conserva invece i conflitti della copia durevole corrente: non può cancellare un'alternativa concorrente o ripristinarne una già risolta.

## Offline e riconnessione

L'app opera localmente dall'envelope e dai record device della sessione autorizzata. Online/foreground, prima del cloud, riconciliare il consenso trusted e la revisione, acquisire ADK e base cloud/checkpoint validi, poi riprodurre il journal. Una rete disponibile non prova autorizzazione, freschezza o ACK.

## Gate di regressione

`verify:m0`, `verify:m2`, `verify:m3`, `verify:m4` e `verify:m5` restano subgate/storici delle milestone che li hanno introdotti. Il gate repository umbrella corrente è:

```bash
npm run verify:m8
```

`verify:m8` include transitivamente M7 → M6 → M5 e i gate/suite precedenti. Un conteggio parziale di test verdi o il superamento del solo `verify:m0` non equivale alla validazione canonica corrente. Vedi `.agents/rules/ci-verification.md`.

## Documentazione complementare

- [Protezione automatica dell'archivio locale](../../docs/architecture/secure-local-archive-design.md): specifica approvata e modello di minaccia; verificare sempre il codice corrente.
- [Debug ripresa sincronizzazione](../../docs/BACKGROUND_SYNC_DEBUG.md): procedura diagnostica per replay journal su ritorno online/foreground, non prova di funzionamento Production.
- [Indice documentazione](../../docs/README.md): ulteriori riferimenti con stato distinto dai presenti contratti normativi.
