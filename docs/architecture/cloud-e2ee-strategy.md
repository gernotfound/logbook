# TheLogBook — strategia per la cifratura dei dati cloud

> **Stato: decisione di prodotto sulla direzione, PROPOSTA TECNICA NON IMPLEMENTATA.** Il 24 ottobre 2026 il product owner ha scelto di rendere illeggibili i contenuti degli utenti agli amministratori di Firestore, chiedendo una soluzione essenziale. Baseline GitHub esaminata: main **03b50f59ed8b8547b72ff868f08490a583313187**. Questo documento non dimostra lo stato dei provider, non modifica i contratti runtime e non autorizza cancellazioni dei dati. Le scelte crittografiche devono essere validate da codice e test prima del rilascio.

## 1. Obiettivo e confine della promessa

I contenuti business personali di un account autenticato (profilo fisico, allenamenti, storico, nutrizione, pianificazioni, integratori, dolori, note, routine e catalogo personale) devono essere cifrati **nel browser prima della replica Firestore**. Il personale con accesso amministrativo al database non deve poterne leggere i valori.

**Non promettere anonimato completo o protezione da un operatore che controlla la distribuzione della PWA.** Firebase Auth, il server e Firestore continueranno a conoscere alcuni metadati (UID, esistenza dell'account, consenso, controllo replica, dimensioni e tempi dei documenti, identificatori dei mesi e metadati causali). JavaScript malevolo distribuito dalla stessa origine, XSS, estensioni e dispositivi compromessi possono vedere i dati mentre la PWA li decifra. La cifratura autenticata non impedisce al database di rifiutare, eliminare o ripresentare una versione precedente del ciphertext; restano essenziali gli attuali fence di integrità e recovery.

Sono fuori perimetro: anonimato della rete, nuovo identity provider, backend che elabori contenuti personali, sistema di pairing via QR, seconda copia cloud/backup automatico, protocollo crittografico inventato, migrazione generalizzata di formati pre-lancio.

## 2. Scelta minima di architettura

**Cifrare i documenti business, non il journal locale né singolarmente ogni campo dell'interfaccia.**

- Un'unica chiave dati casuale **AES-256** per account (Account Data Key, ADK), distinta dalla chiave del vault del singolo dispositivo. Mai derivarla da UID, password Firebase, token o API key.
- Ogni documento business sincronizzato (root utente e singoli shard mensili di storico e nutrizione) contiene un payload cifrato con **AES-256-GCM**, nonce casuale nuovo a 96 bit per ogni cifratura, formato versionato e AAD che lega almeno applicazione, UID, percorso documento e versione. Preferire bytes nativi Firestore ai payload Base64 per limitare l'espansione. Esigere autenticazione prima del parsing e controlli di dimensione e versione.
- Restano leggibili a Firestore **solo** metadati strettamente necessari: versione del formato cifrato, nonce, ciphertext, versione schema/protocollo e metadata di sincronizzazione/fencing. Nessun campo business in parallelo in chiaro. Esaminare con attenzione i path presenti in _sync.fields: possono rivelare nomi o identificatori di dati, quindi il risultato è **riservatezza dei contenuti**, non assenza totale di metadati personali.
- I gateway **client** decifrano il documento all'ingresso, eseguono le attuali convalide Zod e le semantic operations sul contenuto in RAM e ricifrano prima della scrittura. Il merge transazionale è già eseguito dal client: non occorre un servizio che decifri lato server. Mantenere intatti journal IndexedDB, causalità, sequenze, replica-fencing, lost-ack, checkpoint, limite dei batch, consent epochs e protezioni multi-tab.
- Le **Firestore Rules** continuano a imporre owner, Auth, consenso, App Check dove applicabile, schema del contenitore, bounded size, avanzamento della replica e cancellazione protetta. Non possono più convalidare i valori business cifrati o la cardinalità interna degli shard; queste verifiche passano ai gateway client prima di salvare e dopo aver decifrato. Questo limita la difesa contro client compromessi e va dichiarato.
- Nessun contenuto decifrato nei log, in Sentry, nelle API trusted o nei documenti tecnici. Inventariare separatamente i dati non-business e gli export.

**Nota di integrità:** AAD e AEAD rilevano ciphertext falsificato e scambiato fra proprietari/path. I metadata causali esterni richiedono verifiche di coerenza con le operazioni decifrate e i checkpoint già fidati; un database amministrato ostilmente può comunque tentare rollback e denial of service. Non promettere anti-rollback assoluto senza una fonte di fiducia aggiuntiva.

## 3. Chiavi e recupero senza sovraingegnerizzazione

**Un solo codice di recupero casuale ad alta entropia, non una password scelta dall'utente.**

1. Al primo account con consenso valido, la PWA genera casualmente ADK a 256 bit e un **codice di recupero casuale a 256 bit**, mostrato una volta all'utente in forma copiabile/stampabile. Chiedere una conferma esplicita di averlo conservato prima dell'upload di dati personali. Non inviarlo al server o alla telemetria.
2. Derivare con Web Crypto/HKDF, usando contesto di applicazione e UID, una chiave di wrapping dal codice casuale. Salvare su Firestore soltanto un **envelope autenticato con ADK wrappata**, versione, salt/context e nonce; verificare owner e formato. La potenza del codice casuale evita di introdurre KDF costose per password umane.
3. Sul dispositivo iniziale conservare la ADK solo **wrappata sotto la protezione locale owner-scoped già esistente**, mai in chiaro in storage. Riaprirla automaticamente dopo accesso Auth/consenso sullo stesso profilo, anche offline quando la sessione è già valida. La chiave in RAM deve essere invalidata su logout/cambio owner.
4. Su **un nuovo browser/dispositivo**, dopo Firebase Auth e consenso, chiedere il codice di recupero una sola volta. Scaricare l'envelope della ADK, decifrarla sul dispositivo e conservarla protetta nel vault locale. Non scaricare né idratare dati business prima del corretto sblocco.
   **Logout:** il comportamento corrente elimina archivio e chiavi locali dell'owner; per conservare la sicurezza di logout senza eccezioni, **anche un login successivo sullo stesso browser richiederà nuovamente il codice di recupero**. La riapertura automatica vale soltanto durante la sessione persistente legittima e finché l'utente non effettua logout/purge. Non lasciare una ADK riutilizzabile in un archivio escluso dal purge.
5. Da un dispositivo già sbloccato consentire la **rigenerazione del codice**, sostituendo in maniera verificata l'envelope di wrapping della stessa ADK. Nessuna ricifratura di tutti i dati; il vecchio codice non deve più sbloccare un nuovo dispositivo. Considerare esplicitamente concorrenza fra rotazione codice e onboarding.
6. Se non esiste più alcun dispositivo sbloccato e il codice è smarrito, **i contenuti cloud non sono recuperabili**, anche dal proprietario del servizio. Nessun reset automatico della chiave su ciphertext esistente, nessuna cancellazione implicita. La cancellazione dell'account deve comunque funzionare dal backend senza conoscere ADK.

Non introdurre PIN, passphrase o prompt quotidiani. Il codice è richiesto all'attivazione e per i nuovi dispositivi; **questa è una modifica esplicita al requisito UX precedente che escludeva recovery code per l'archivio locale**. Quel requisito continua a valere per l'uso normale sul dispositivo già autorizzato. L'eccezione cloud va recepita nei contratti solo quando l'implementazione è approvata e pronta.

## 4. Capacità conservate, limitate e non più disponibili

| Capacità | Esito |
|---|---|
| Login Google/email, dati personali nell'app, esercizi, nutrizione, storico e statistiche client | **Conservata** |
| Modalità offline, cifratura IndexedDB, journal e recupero da crash dello stesso dispositivo | **Conservata** |
| Sincronizzazione e convergenza multi-dispositivo | **Conservata**, solo dopo installazione della ADK sui dispositivi; regressioni obbligatorie |
| Guest e guest→account | **Conservata**, con creazione/sblocco ADK prima di qualunque upload |
| Esportazione e importazione JSON/CSV attuali | **Conservata**, dopo sblocco; file espliciti potenzialmente in chiaro e da avvisare |
| Cancellazione dati/account, revoca consenso, accesso al solo metadata tecnico | **Conservata** |
| Ripristino automatico del contenuto cloud su un browser vergine con il solo Firebase Auth | **Non disponibile**: serve codice o dispositivo precedentemente autorizzato |
| Nuovo login dopo logout completo, anche sullo stesso browser | **Richiede il codice**, perché il logout attuale elimina anche le chiavi locali e deve continuare a farlo |
| Recupero del contenuto da assistenza/amministratore senza alcuna chiave | **Non disponibile** |
| Lettura dei valori personali dalla console Firestore o da API Admin | **Non disponibile** |
| Esportazione leggibile dei dati cloud dal backend senza chiave | **Non disponibile**: l'API può trasportare ciphertext, poi il client deve decifrare |
| Ricerca/report/analisi server-side sul contenuto o notifiche push personalizzate dai contenuti | **Non disponibili senza eccezioni esplicite**; non risultano prerequisiti delle funzioni fitness correnti. Analisi client e notifiche generiche restano possibili |
| Controllo del contenuto business tramite Firestore Security Rules | **Non più possibile**; usare validazione client e vincoli del contenitore, senza fingere che l'admin possa verificare il plaintext |

**Specifico per TheLogBook:** il percorso [server/healthConsent/export.ts](../../server/healthConsent/export.ts) oggi legge i documenti nel backend per permettere export dopo revoca. Dopo il cutover deve poter trasferire solo ciphertext autenticato al client richiedente, senza decifrarlo; [src/lib/db/withdrawnBackupTransport.ts](../../src/lib/db/withdrawnBackupTransport.ts) e [src/lib/db/backupSnapshot.ts](../../src/lib/db/backupSnapshot.ts) eseguono la decifratura soltanto se ADK disponibile. La portabilità dei dati resta una funzione dell'utente con chiave; senza chiave non si deve generare un JSON presentato come dati leggibili. Allineare la documentazione privacy e i flussi di esercizio dei diritti, con verifica giuridica prima del lancio.

## 5. Ordine di lavoro e criteri per procedere

Realizzare modifiche **piccole, verificabili e isolate**, sul main remoto osservato al momento dell'implementazione. Niente riscrittura dello storage locale e nessuna cancellazione provider.

### Fase A — chiavi e UX minima (senza traffico business cifrato live)
- Specificare i tre stati UI: prima attivazione con conferma codice; nuovo dispositivo che richiede codice; codice perso con opzioni ammesse. In Impostazioni: rigenera codice da dispositivo sbloccato.
- Implementare primitive crittografiche e key wrapping usando Web Crypto; formato/versioning, nonce, AAD, verifica owner, failure fail-closed. Vault locale esistente riutilizzato per proteggere la ADK. Testare riapertura offline e rotazione codice.
- Nessun upload business finché una ADK valida non è stata recuperata.

### Fase B — boundary cloud e sincronizzazione
- Introdurre codec encrypt/decrypt **ai boundary cloud**, senza diffondere logica crypto nella UI o nei singoli Domain Operations.
- Portare in formato cifrato root e mensilizzati nei percorsi di scrittura, hydration, checkpoint, lettura storia/nutrizione e importazione recovery. Mantenere merge semantico sul plaintext solo in RAM.
- Aggiornare schema/cloud protocol **soltanto nelle dimensioni realmente coinvolte**, Security Rules, limiti documento Firestore e parser. Impedire vecchie write plaintext; nessun client deve interpretare ciphertext/key error come account vuoto.

### Fase C — lifecycle ed export
- Aggiornare guest→account, multi-dispositivo, logout, revoca/rinnovo del consenso, account deletion, backup/restore, export dopo revoca e condizioni di errore.
- Esportare copie JSON esplicite in chiaro **solo con avviso chiaro** e dopo sblocco. Non introdurre una seconda pipeline di backup cloud.
- Controllare che Sentry, API backend, diagnostic tools e log non acquisiscano valori business decifrati.

### Fase D — verifica e lancio coordinato
- Test mirati: crypto roundtrip e manomissione (wrong owner/path/key/nonce/version); setup/rotazione/smarrimento codice; chiusura improvvisa, offline e storage denied; due dispositivi con edit concorrenti, causal merge, ack perso, sync retry; guest→account; consenso e rights export; cancellazione senza chiave; Rules Emulator e dimensioni massime.
- Eseguire gate canonico **verify:m8** / CI equivalente su **SHA candidato esatto**, review e verifica post-merge. Coordinare Rules e Hosting secondo i workflow protetti, verificando provider Production separatamente; CI verde non prova il runtime.
- Prima di qualsiasi cutover ispezionare il **reale** stato Firestore: la dichiarazione che non ci sono utenti reali non autorizza automaticamente reset, eliminazione dati o assunzioni sui documenti esistenti. La baseline fresh-start evita supporto a client pre-lancio, ma non giustifica perdita di eventuali dati ancora presenti.
- Nessun rilascio finché Firestore non rifiuta contenuto business in chiaro, gli export non aggirano la cifratura e due dispositivi reali/testati non mantengono la convergenza.

## 6. Dipendenze e rischi residui da accettare

1. **Custodia del codice:** l'utente deve salvarlo. Una volta persi tutti i dispositivi autorizzati e il codice, il servizio non può ripristinare i contenuti.
2. **Metadati:** accessi Admin conservano visibilità su UID, documenti, mesi, dimensioni, tempi e parte della causalità. Ridurli dove possibile senza sostituire il protocollo.
3. **Distribuzione del client:** un operatore che distribuisce JavaScript malevolo, una XSS o un endpoint compromesso possono leggere i dati durante l'uso. E2EE cloud non risolve questo problema.
4. **Integrità e disponibilità:** perdita/riproduzione di ciphertext e rollback completo del database non sono eliminati dalla sola AEAD; mantenere e testare fence e recovery senza promesse assolute.
5. **Portabilità e diritto d'accesso:** con codice perso il backend può restituire al massimo bytes cifrati; documentare il limite e farlo valutare giuridicamente.
6. **Protezione degli export locali:** JSON/CSV creati esplicitamente possono essere plaintext. Non presentarli come automaticamente protetti dal vault o dalla cifratura cloud.

## 7. Perimetro dei file da riesaminare prima dell'implementazione

- Cloud codec, causal operations e writer: [documentProjection.ts](../../src/lib/sync/documentProjection.ts), [transactionWriter.ts](../../src/lib/sync/transactionWriter.ts), [semanticProjection](../../src/lib/sync/semanticProjection), [replicateJournal.ts](../../src/lib/sync/replicateJournal.ts), [schemaEvolution.ts](../../src/lib/schemaEvolution.ts).
- Letture, hydration, journal: [localRepository.ts](../../src/lib/sync/localRepository.ts), [db_training.ts](../../src/lib/db/db_training.ts), [db_nutrition.ts](../../src/lib/db/db_nutrition.ts), auth/consent loaders.
- Vault e identità: [secureArchiveKeys.ts](../../src/lib/sync/secureArchiveKeys.ts), migrazione vault, sessione e guest→account.
- Backup/lifecycle: [backupSnapshot.ts](../../src/lib/db/backupSnapshot.ts), [withdrawnBackupTransport.ts](../../src/lib/db/withdrawnBackupTransport.ts), [health-consent export](../../server/healthConsent/export.ts), account deletion.
- Boundary di sicurezza e documentazione: [firestore.rules](../../firestore.rules), [storage-and-sync.md](../../.agents/rules/storage-and-sync.md), [firebase-config.md](../../.agents/rules/firebase-config.md), [account-lifecycle.md](../../.agents/rules/account-lifecycle.md), [secure-local-archive-design.md](secure-local-archive-design.md), privacy e processing register.

**Criterio di completamento della strategia:** il team può implementare con questo piano senza inventare un nuovo backend o stravolgere la PWA. **Criterio di completamento dell'implementazione:** solo prove eseguite su codice candidato, CI, merge e Production pertinenti, inclusa la verifica che dalla console amministrativa non siano visibili contenuti business in chiaro.
