# Replica cifrata Cloudflare — candidato CF-03/04

**Quando leggere:** trasporto D1, binding replica, claim/retirement, cloud key, checkpoint, ACK, retry e recovery con Kinde.

**Non inferire:** un Worker privato o uno schema D1 presente non attestano un fitness account pubblico, né un ACK senza readback.

**Autorità:** [Storage e sync](storage-and-sync.md), [`AGENTS.md`](../../AGENTS.md), [Ciclo account](account-lifecycle.md) e [stato Cloudflare](../../docs/operations/cloudflare-current-state.md).

Il Worker identifica il proprietario autenticato in ogni risposta di
`/v1/sync/control`. Il client richiede questo campo e lo confronta con
l’account dell’archivio prima di sigillare un claim o una consegna, adottare
una replica o sostituire un intento dopo un conflitto. Due account possono
avere le stesse revisioni, lo stesso epoch e registri di replica equivalenti.

## Checkpoint candidati CF-03/04

### CF-04 — Preflight causale del rientro, nessuna scrittura (27/11/2026)

`preflightRetiredReplicaRecovery()` è un controllo puro **successivo** alla
lettura del vault autenticato e alla scansione AEAD completa della D1. Confronta
owner, revisione, epoch, consenso, registro dell'incarnazione originale,
documenti business e metadati causali della baseline locale. Controlla anche
che il replay delle operazioni originarie riproduca il dato locale senza
reinterpretarlo. Una sequenza già coperta dal `lastSeq` della **stessa**
incarnazione segnala possibile ACK perso, non permesso di eliminarla. Baseline
divergente, documento extra/mancante, metadato avanzato anche con stesso
valore business (ABA), transizione pendente o replay locale incongruente
richiedono riconciliazione separata. `baseline-unchanged` è soltanto
un'osservazione di preflight: non autorizza una nuova identità causale, un
commit/ACK, una scelta di conflitto o una nuova membership, e può scadere
subito dopo la scansione. Il chiamante futuro deve ottenere ADK già
autorizzata, due control stabili, guard sessione e prova trusted prima/dopo,
poi fencing atomico prima di qualsiasi mutazione. Il preflight non è montato
in UI e non rende disponibile il recupero SYNC-7D/7E.

### CF-04 — Barriera journal per il rientro di una replica ritirata (candidato 27/11/2026)

La diagnostica candidata `inspectKindeCandidateOfflineReplicaJournal()` apre
soltanto un vault già provisionato, con sessione Kinde e consenso trusted
correnti, legge il journal cifrato e verifica due registri D1 owner-bound
identici. Rilegge l'archivio prima della risposta per rifiutare cambi locali
concorrenti e rilascia la capacità di vault su ogni esito. Distingue journal
vuoto, journal archiviato da un consenso precedente, primo claim con pending,
mutazione già sigillata, membership originale
attiva e replica ritirata/sostituita/scaduta o mancante. L'UI candidata
segnala i pending non ACKati senza esporre contenuti salute. Non crea vault,
non acquisisce ADK, non invia commit/claim, non modifica IndexedDB e non
autorizza un replay: una lettura di membership non prova il contenuto del
cloud né la riconciliazione dei conflitti. Non estendere questo responso
al fitness pubblico; un recupero causale esplicito SYNC-7D/7E resta aperto.

Prima di sigillare una nuova richiesta D1, `stageCloudflareReplicaClaim()`
rifiuta un archivio che possiede sia una replica precedente sia operazioni
offline nel journal. Una prima registrazione senza replica può invece
conservare e successivamente inviare gli intenti già durevoli. Poiché una
scheda concorrente può aggiungere modifiche **dopo** lo staging,
`adoptReplicaCheckpoint()` rifiuta anche il commit di una nuova incarnazione
Cloudflare se a quel momento esistono pending della replica precedente.
La ripresa di un claim sigillato che ha nel frattempo acquisito pending della
replica precedente consulta prima il registro owner-bound: senza la stessa
incarnazione ancora attiva e con lease valido non invia il replay, evitando
di occupare inutilmente un posto D1. Un controllo valido non sostituisce il
fence finale IndexedDB, perché la membership può cambiare dopo la lettura.
Lo stesso slot/ID/generazione può riconciliare il proprio checkpoint senza
riscrivere le sequenze. La barriera non elimina il claim già sigillato,
il journal o i dati device: il recupero richiede riconciliazione esplicita.
Le adozioni legacy non Cloudflare rimangono regolate dal proprio contratto.
Questa protezione **non implementa ancora** il rientro autorizzato dei
pending né risolve i conflitti semantici: SYNC-7D resta aperto.

### CF-04 — Annullamento esplicito di claim/retirement sigillati (candidato 25/11/2026)

La schermata candidata legge una richiesta già sigillata nell'archivio owner-scoped soltanto con sessione Kinde, consenso, cookie CSRF, epoch e vault device correnti. La conferma utente conserva la `mutationId` osservata; il bridge rilegge l'intento prima di chiamare il boundary `cancelCloudflareReplicaMutation()`. Non si crea un nuovo vault/claim e non si annulla un'altra operazione se una scheda concorrente ha sostituito l'intento.

La decisione di annullamento viene resa durevole **prima** della rete. Soltanto la prova primaria del CAS remoto che rende impossibile il commit originale consente di rimuovere claim/retirement locale; una richiesta già committata richiede il recupero ordinario, non una cancellazione retroattiva. Risposta persa, cambio sessione/owner/consenso o prova incompleta preservano intento, marker e journal, senza ACK business. Il percorso pubblico `identityOnly` non espone l'azione. Test client/React e test isolati SQL sono verifiche distinte da un GO su dispositivi/provider reali.

### CF-04 — Ripresa di un invio D1 dopo una scrittura da un altro dispositivo (21/11/2026)

Il bootstrap Kinde candidato riconcilia l'intento cifrato già in IndexedDB prima della hydration. Se D1 prova che il batch originale non è stato committato e il journal viene ristadiato sul nuovo checkpoint autenticato, uno svuotamento esplicito può tentare il batch sostitutivo una sola volta nella stessa richiesta. Conserva le operazioni causali e richiede la ricevuta esatta del batch consegnato. Un nuovo conflitto o errore lascia intatto il journal per una verifica successiva. Il collaudo sintetico conserva due vault e due sessioni distinti e verifica la convergenza dopo un HTTP 429 e una scrittura concorrente. Il percorso rimane candidato.

`e2e/account/kinde-replica-recovery.spec.ts` esercita il riavvio del documento con due contesti Playwright reali. Verifica che il nuovo runtime recuperi il journal da IndexedDB, converga con la scrittura concorrente e lasci soltanto due ricevute. Il gateway candidato e i Worker eseguono su SQL sintetico, con sessioni di prova emesse dalla stessa funzione usata da Kinde.

Prima dello staging, un avanzamento della revisione tra controllo e lettura dei documenti consente di rileggere entrambi una sola volta, con lo stesso fence e consenso e senza arretrare dalla revisione già osservata. Un secondo avanzamento lascia il journal in attesa di riconciliazione. Epoch o consenso divergenti e revisioni in regressione vengono rifiutati. Il recupero degli intenti già sigillati segue la prova di commit separata.

### CF-03/04 — Bootstrap device Kinde e fence contro revoca locale (18/11/2026)

La composizione candidata `prepareKindeCandidateOwner()` prima riusa/crea il vault device owner-scoped solo dopo consent trusted attivo, poi verifica due volte la sessione, esegue hydration AEAD e infine la replica claim con intento cifrato. `isKindeAccountLocalFitnessClear()` è un gate fitness locale aggiuntivo, distinto dal controllo D1: i marker owner-scoped di revoca/cancellazione e una generazione consenso divergente bloccano letture/scritture anche se una risposta remota ancora riporta active. Hydration, claim e journal lo ricontrollano nei guard asincroni/IndexedDB; revoca non è un diritto all'ACK o all'azzeramento del journal. I test usano IndexedDB effettivo in memoria con controllo dell'envelope cifrato; niente grant runtime su `main` senza API/D1 e lifecycle Kinde verificati.

Se il vault contiene già un claim cifrato, il bootstrap riprende la stessa richiesta prima della hydration. La hydration resta bloccata mentre l'intento attende riconciliazione. In questo caso il bootstrap restituisce `checkpointRevision: null` perché durante quel tentativo non ha installato un nuovo checkpoint. Una richiesta di claim di un'altra epoca Auth resta nel vault e non viene inviata.

Il bootstrap riconcilia anche un batch di consegna già sigillato prima di leggere un nuovo checkpoint. Il bridge di recupero richiede il principal, l'epoca Auth e il consenso attesi e accetta solo la ricevuta esatta del batch. La modalità di recupero lascia al normale sync gli edit successivi, anche se la consegna precedente è già stata risolta da un'altra scheda. Un esito ancora da riconciliare sospende la hydration. La lettura cifrata dello stato workout usata dal commit locale è indipendente dal controllo del consenso Firebase sulle scritture device.


### CF-03 — Osservazione del checkpoint D1 con sessione Kinde (17/11/2026)

Il bridge di sola lettura `inspectKindeCandidateCloudCheckpoint` verifica sessione e consenso, continuità del cookie CSRF e della generazione, ADK monouso, scansione D1 revision-fenced, integrità AEAD owner/path e nuova prova trusted finale. `hydrateKindeCandidateArchive` richiede inoltre un vault già autorizzato per l'owner atteso. Nella transazione IndexedDB ricontrolla la stessa apertura del vault, il cookie, il guard del chiamante, la revisione locale pre-scansione e la generazione del consenso. Una modifica concorrente o una transizione di consegna, claim o retirement pendente sospende la hydration. La copia locale conserva il journal. L'adozione della replica e gli ACK richiedono prove separate. Il bridge resta isolato dal runtime pubblico.


### CF-04 — Claim replica con prova Kinde e recupero locale (18/11/2026, candidato)

`claimKindeCandidateReplica()` collega sessione e consenso trusted, vault device già aperto, owner D1 nel controllo remoto, verifica AEAD completa del checkpoint e doppio controllo stabile prima dello staging. La prova legale locale deve corrispondere alla ricevuta server e viene verificata nuovamente prima e dopo il replay. Il request di claim viene prima registrato nell'envelope cifrato owner-scoped; un claim preesistente viene ripreso con la mutationId invariata, senza rigenerare una richiesta. Un lost ACK, controllo instabile, guest, cambio CSRF/generazione/vault o replica locale scaduta impediscono nuove attribuzioni; la ADK temporanea viene azzerata sempre. La funzione rimane candidata non montata nel provider o nella UI, e i risultati `adopted`/`already-active` **non** autorizzano da soli fitness, ACK del journal, diritti o cutover Production. La replica già presente si accetta come `already-active` soltanto con incarico e lease coincidenti nel controllo owner-bound.


## Checkpoint Kinde e consenso legale nel baseline (18/11/2026)

Il checkpoint D1 completo e AEAD può alimentare il baseline locale solo dopo
fence del vault e della sessione Kinde. `legalConsent` proviene dallo stato
`active` trusted con versioni correnti e timestamp canonico stabile prima
e dopo la scansione, non da un root cloud assente o obsoleto. Il commit
`hydrateLocal` è vincolato alla revisione locale osservata e preserva
pending e recovery; non crea lease replica, ricevute cloud o ACK.
Il percorso resta candidato finché Auth/consenso/replica non sono attivi.
## Collegamento candidato sessione Kinde → journal D1 (CF-03/04)

`src/lib/sync/kindeCandidateJournalBridge.ts` mette in sequenza il boundary
sessione+consenso Kinde, lo stato dell'archivio locale verificato, l'acquisizione
ADK per una sola operazione e la consegna D1 con receipt sul journal durabile.
Il CSRF random della sessione deve restare identico ad ogni attesa e durante
l'ACK: UID e revisioni uguali dopo un re-login **non** dimostrano la stessa
sessione. Nessuna ADK viene acquisita per un journal vuoto; la chiave viene
azzerata anche su errore. Le verifiche non eseguono purge, registrazione
replica o sincronizzazione iniziale; la composizione **non è ancora collegata**
a Firebase AuthContext né a route Cloudflare pubbliche. In particolare non
certifica recovery, multi-device o integrità E2E Production.

## Protezione trasporto D1 candidato (CF-04)

`src/lib/sync/cloudReplicaTransport.ts` applica un timeout HTTP di 15 secondi e
limiti di lettura alle risposte JSON prima del parsing: fino a otto documenti
cifrati da 950 KB più overhead per `read`/`scan`, 64 KB per il controllo
replica e 16 KB per ricevute, mutation e risposte 428. Il limite è distinto
dalle dimensioni dei *request body* imposte dal Worker D1. Un timeout, una
risposta incompleta o superiore ai limiti, oppure una prova 428 malformata
non autorizzano ACK, riavvii o purge del journal durevole: restano errori di
trasporto e richiedono recovery secondo il protocollo. Il trasporto è ancora
un candidato non collegato al percorso cloud pubblico, dunque questi test
non equivalgono a un collaudo con Kinde/D1 Production.

## Cloudflare D1 — candidato di trasporto, non runtime corrente (CF-01/02/04)

Il codice integrato dalla [PR #1070](https://github.com/gernotfound/logbook/pull/1070) su main contiene migration D1 versionate `0001`/`0002` (quest'ultima verificata anche sul provider D1 sintetico EU) e un Worker in `cloudflare/api/`, il trasporto `src/lib/sync/cloudReplicaTransport.ts`, il verificatore `cloudReplicaCheckpoint.ts`, il costruttore di batch `cloudReplicaCommit.ts` e il motore puro condiviso `cloudMergeEngine.ts` (utilizzato anche da `transactionWriter.ts`). **Il percorso attivo rimane Firestore e non va commutato per il solo fatto che questi file siano presenti.**

- **MUST per l'integrazione futura:** mantenere esattamente la separazione memoria → journal IndexedDB durevole → commit D1/receipt → ACK IndexedDB; timeout o 409 non cancellano pending. La receipt di un batch deve includere il digest degli stessi byte ciphertext, replica, consenso, sequenza, revisione ed **epoch account** che il client verifica. Il commit deve inviare `expectedFenceEpoch` dal suo snapshot, verificato contro la generazione Auth trusted prima del CAS.
- **MUST (candidate journal→D1):** `cloudReplicaDurableDelivery.stageCloudflareDelivery()` sigilla il batch e registra nell'**envelope cifrato owner-scoped** un intento con batchId, nonce/ciphertext immutabili, identità e operazioni del prefisso consegnato **prima** di ogni chiamata remota. `resumeCloudflareDelivery()` riusa il batch originale e richiede una receipt hash-bound verificata; un errore remoto, una response persa o un ACK locale fallito non autorizzano la pulizia del journal. Il solo `acknowledgeThrough()` protegge la transizione indivisibile: rimuove il prefisso effettivamente confermato e l'intento D1 nello **stesso update IndexedDB**, con guard sessione verificato dentro la callback e replay delle nuove operazioni rimaste. Rifiutare tentativi contemporanei, risquenziamento, checkpoint, rollback/recupero consenso che invaliderebbero un intento non riconciliato. Il Firebase writer attivo NON attraversa questo candidato; nessun ACK D1 è abilitato in Production.
- **MUST (orchestrazione CF-04 candidata):** `deliverCloudflareJournalCandidate()` legge controllo e documenti sotto lo stesso epoch/consenso, seleziona un prefisso causale bounded, effettua lo staging durevole e riprende la receipt prima di qualsiasi nuovo batch. Un intento già presente viene ripreso senza generare un altro nonce/batchId. Il runner è isolato e richiede un guard sessione, ADK e CSRF forniti dal futuro percorso Auth: **non è collegato a `replicateJournal()`**. Se il CAS perde e una receipt non è dimostrabile, in caso di `409` il candidato può ristadiare l'intento **soltanto** dopo prova SQL primaria `not-committed`, full scan AEAD della nuova revisione e doppio control identico, con replica/consenso/epoch/sequence invariati. Il nuovo batchId e i nuovi ciphertext sono salvati insieme nell'owner-vault con il medesimo prefisso causale; il journal e i nuovi edit non vengono ACKati. `retry-staged` non invia il nuovo batch: il replay avviene soltanto in una successiva invocazione. Qualsiasi risultato `committed`/`inconclusive`, scansione falsificata o controllo instabile lascia l'intento originale inalterato.
- **MUST (prova di non-commit D1):** `POST /v1/sync/commit/status` legge dalla **primaria in un'unica SELECT** la revisione account e l'eventuale ricevuta del batch originale, vincolata a owner, consenso, epoch, sessione e hash dell'intero body cifrato. Il solo `409`, il timeout o una lookup separata della receipt non provano l'assenza di commit. Soltanto `not-committed` con revisione ormai avanzata e receipt assente dimostra che quel CAS non può più riuscire nella stessa generazione; `committed` non è un ACK locale e richiede comunque la ricevuta contenuto-vincolata. Il candidato esegue il rebase solo dopo `not-committed` provato, full scan ADK/AEAD, doppio controllo del registro e sostituzione atomica dell'intento (con `retry-staged`), senza ACK o consegna immediata. L'attivazione reale richiede ancora Auth/ADK, claim, consent e test provider.
- **MUST (intent di replica candidato):** `cloudReplicaClaimRecord.ts` valida il body immutabile della registrazione; `stageCloudflareReplicaClaim()` salva `mutationId`, checkpoint clock, consenso e revisione nell'owner-vault IndexedDB **prima** della richiesta. `resumeCloudflareReplicaClaim()` riusa la richiesta; una ricevuta storica non autorizza l'adozione. Una receipt storica `reconciliationRequired` **non** autorizza automaticamente un grant: dopo una revisione indipendente è riutilizzabile soltanto se due letture stabili del registro dimostrano l'incarnazione ancora `active` con metadata di receipt immutati e checkpoint clock originale invariato, una nuova scansione AEAD completa della stessa revisione presenta il **medesimo clock staged**, e `adoptReplicaCheckpoint()` verifica la mutationId, l'identità locale e la sessione dentro il commit IndexedDB, eliminando l'intento nella stessa transazione. Se cloud clock, replica, consenso/epoch o registro divergono, restituire `reconciliation-required` senza toccare journal/ciphertext; la rebase di claim dopo 409 è ammessa **solo** con prova SQL primaria atomica di assenza del ledger e revisione avanzata, scansione AEAD nuova, doppio control stabile e sostituzione dell'intento nel vault prima di riprendere la rete. L'incremento della [PR #1072](https://github.com/gernotfound/logbook/pull/1072) ristadia nel vault owner-encrypted i claim **già committati** solo quando la stessa replica attiva e tutti i metadati attestati dalla receipt rimangono invariati, due controlli coincidono e il clock cloud avanzato è derivato da full scan AEAD della revisione attuale; una nuova mutationId viene salvata **prima** del replay e non è grant/ACK. Gli altri claim non adottabili e l'integrazione runtime account restano aperti. Una revoca del consenso non rende il vault illeggibile, ma blocca sempre il vecchio replay.
- **MUST (retirement D1 candidato):** prima di `replica/retire`, `stageCloudflareReplicaRetirement()` salva nell'owner-vault il mutationId, consenso, epoch e target incarnation immutabili. `resumeCloudflareReplicaRetirement()` riusa la stessa richiesta per recuperare il lost ACK; anche con ricevuta corrente deve osservare due controlli remoti coerenti e uno slot `retired` corrispondente prima di eliminare l'intento nella transazione IndexedDB, senza ACK di business journal. La ricevuta storica autenticata alla richiesta può autorizzare soltanto la chiusura dell'intento di retirement se **due letture remote identiche** confermano ancora la medesima generazione `retired`, stesso stato receipt (lastSeq/lease/checkpoint), consenso/epoch invariati e revisione non precedente alla ricevuta: un aumento indipendente della revisione non invalida di per sé un retirement già riuscito. Una receipt storica e due controlli identici che provano una generazione successiva con replicaId diverso autorizzano soltanto `superseded` (chiusura intento, nessun ACK/GC); riuso alla stessa generazione, controllo instabile o consenso cambiato preservano l'intento; il retry **staged** con nuova mutation dopo CAS 409 è ammesso soltanto quando la query primaria congiunta su revisione/ledger prova `not-committed` e la stessa generazione originale è ancora `active`, due control identici e consenso/epoch invariati: nel percorso automatico il lease deve essere scaduto oltre 5 minuti; nel percorso esplicito (candidato 0019) il registro deve attestare owner e testimone confermato `lastSeq/checkpointAtMs/leaseUntilMs` immutati. L'update IndexedDB MUST sostituire l'esatto intento dopo il fence sessione, senza ACK journal. Staging/resume MUST impedire il ritiro della replica locale corrente, che potrebbe ancora possedere journal da inviare. Esiti incerti, lease rinnovati e slot riutilizzati conservano la mutation originale. Mai dedurre un ACK business o una prova di GC da tale chiusura. Staging delivery, claim e retirement sono mutuamente esclusivi; senza Auth/consenso live validati il percorso resta solo candidato.
- **MUST:** i DTO Protocol 3 pubblici e l'HTTP `replica` contengono **solo** `slot`, `replicaId`, `generation`; non usare lo spread dell'identità locale completa (porta `leaseUntilMs`, `checkpointAtMs`) per costruire `_sync.writer` o il payload Zod. TypeScript `Pick` non elimina campi a runtime. Test di regressione reale obbligatorio con `ReplicaIdentity` completo.
- **MUST:** una scansione account completa include root e tutti i mesi con paginazione bounded e revisione/fence uguale a ogni pagina. Un cambio concorrente causa restart/fail-closed, mai hydration parziale. Ogni envelope deve essere aperto con ADK/UID/path e autenticato **prima** che uno snapshot sia considerato idoneo al merge; la sola `_sync` pubblica non basta.
- **MUST (Cloudflare Auth/D1 candidate, branch #1083):** il digest del token di sessione proviene esclusivamente dal service binding privato `AUTH_GATE` e viene ricontrollato dalla D1 nella stessa transazione che legge snapshot/receipt/repliche o scrive documenti e membership. `withSession('first-primary')` non sostituisce il predicato Auth; scadenza, logout, cambio Auth epoch, account disabilitato e assenza della prova di consenso iniziale corrente devono impedire l'accesso se precedono lo snapshot SQL. Il predicato riusa il vincolo di revisione 1 del gate corrente; prima di introdurre riaccettazioni future entrambi devono evolvere insieme. Batch di lettura compositi coerenti; nessun ACK restituito dopo prova di accesso fallita. Le risposte già prodotte prima del logout sono eventi precedenti, non prova di futura autorizzazione. Questa è una **modifica candidata non distribuita**, non una certificazione Cloudflare o un nuovo formato.
- **MUST:** il client ottiene il registro `POST /v1/sync/control` come snapshot autorevole. La sua revisione/epoch/consenso devono coincidere con la lettura di tutti i documenti che alimentano il merge; `stableFrontierFromControl()` usa **solo** checkpoint delle repliche attive. Il CAS server controlla nuovamente revisione, owner, consenso, epoch e identità. Le mutation `replica/claim` e `replica/retire` candidate avanzano ora la stessa revisione del registro nella transazione D1 con ricevuta e trigger CAS, impedendo scan parziali validi con un vecchio frontier. L'ID di mutation/intent e il risultato devono essere durevoli e riutilizzati dopo timeout: una risposta persa non è una prova di mancata registrazione. La ricevuta storica di claim/retire può essere ricercata anche dopo revisioni successive dello stesso account/epoch, ma `reconciliationRequired` **non è un grant attuale**: il client riceve un errore tipizzato e può rivalutare il claim esclusivamente con full scan AEAD e clock staged invariato più doppia lettura del registro per la stessa replica attiva; per retirement deve dimostrare la corrispondente replica ancora ritirata. Quando queste prove mancano non eliminare l'intento né inventare ACK. **Solo per un 409 claim o retirement** si può ristadiare una nuova mutationId dopo una risposta autorevole `not-committed`: la stessa query SQL sulla **primaria** deve osservare insieme nessuna receipt della mutation originale e una revisione corrente maggiore di quella attesa (CAS antico quindi definitivamente impossibile). Prima di sostituire nel vault l'intento originale il client MUST verificare medesimo consent/epoch, revisione della prova, due controlli identici e mutationId/replica/sessione dentro l'update IndexedDB. Per il **claim** è obbligatoria anche una nuova scansione AEAD completa della revisione attuale; per il **retirement** serve invece la replica originale ancora attiva e non coincidente col writer locale; per quello automatico lease scaduto oltre lo skew, per quello esplicito testimone confermato invariato. Il nuovo intento `retry-staged` MUST essere persistito prima di mandare il nuovo body, preservando il journal; `committed`/`inconclusive`/errori non autorizzano un rebase. La prova non è conferita dal solo 409, da un clock pubblico o da una lettura su replica D1 eventualmente in ritardo. Claim/retirement storicamente committati ma con membership non più riconciliabile richiedono ulteriori flussi distinti; il semplice 409 non è una prova di non-commit. Il server verifica il checkpoint clock contro il join degli `_sync.clock` pubblici in D1, ma questa prova **non sostituisce** la scansione completa AEAD e il fence IndexedDB che il client deve completare prima di adottare la replica.
- **MUST (audit Protocol 3):** `_sync.writer.seq` attesta l'**ultima sequenza del batch**, ma `_sync.clock[writer.slot]` di un singolo documento può essere inferiore se quel documento è stato toccato da una sequenza precedente. Richiedere che ogni documento abbia la sequenza globale falsificherebbe la prova causale e rifiuterebbe batch legittimi. Verificare che il dot dell'actor nel documento sia positivo **e non superi `writer.seq`**, senza fabbricare clock: regressioni con journal reale root+mese e sequenze distinte. Il body HTTP complessivo deve poter contenere gli otto envelope da 950 KB ciascuno, ma questa compatibilità del contratto **non prova** che parsing/hashing sotto 10 ms CPU del Worker Free sia sostenibile: serve misura provider prima del GO.
- **MUST:** snapshot iniziale, checkpoint e server CAS rispettano owner/session epoch, consenso, slot/generation/lease, causal metadata, size limit e max 8 documenti per write. D1 `batch()`/trigger deve abortire le scritture concorrenti senza no-op; non spostare il semantic merge (che richiede ADK) dentro il Worker.
- **Stato tecnico non dimostrato:** Auth Cloudflare privata, provisioning degli account e dei consensi, adozione locale dei checkpoint/retirement, **attivazione del candidato journal/ACK nel runtime con Auth/ADK reali**, ed erasure restano da completare. Il confine staged-and-resume è testabile in isolamento ma non costituisce una sincronizzazione PWA deployata. Claim/retire su fixture SQLite non provano una registrazione utilizzabile sulla PWA né D1 remoto. Il controllo del frontier pubblico non prova la decrittazione completa da parte del client. I test SQLite simulati e la CI non provano D1 remoto, CPU Free, quote, backup o Production; i requisiti di CF-00/03/04/05/06/08/09 restano aperti.

## Integrazioni supplementari candidate

### Ripresa owner-neutral del journal (18/11/2026)

L'owner che consente il replay foreground deve coincidere esattamente
con l'UID del provider registrato in `authenticatedIdentitySource`.
Un hint IndexedDB/localStorage, un owner guest o una sessione precedente
non autorizzano il replay. Il controllo UID è solo un prerequisito:
mantenere fence Auth, consenso, generazione, journal durevole e ACK
verificabile nelle transazioni effettive. Non reintrodurre dipendenze
Firebase nell'owner-neutral store.

## Nessun successo cloud senza identità e prova di journal (18/11/2026)

`DB.saveUserData()` non deve dichiarare `synced` soltanto perché
`firebase.auth.currentUser` è `null`. Anche senza sessione del vecchio
provider, l'owner potrebbe avere un journal IndexedDB durevole da consegnare.
Il risultato passa sempre attraverso `replicateJournal()`, che verifica
owner, sessione, consenso, archivio locale, commit remoto e ACK prima di
consentire lo stato `synced`. Per il guest genuino vale il successo solo
locale verificato dal medesimo boundary; per un account non autorizzato
il journal rimane invariato e il cloud non viene attestato.

**MUST:** quando Auth verrà sostituito con Kinde, utilizzare un writer
Workers/D1 verificato prima di ammettere `synced` per quell'owner;
assenza di Firebase non autorizza un ACK né un fallback implicito.
