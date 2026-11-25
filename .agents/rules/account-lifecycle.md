# Ciclo account, Auth e guest — TheLogBook

> **Checkpoint 24/11:** gli incrementi datati qui sotto descrivono anche stadi storici. La [mappa corrente](../../docs/operations/cloudflare-current-state.md) distingue le funzioni candidate già integrate da quelle mancanti. Il pubblico resta identity-only.

### CF-06 — Cancellazione account e inattività candidate

La cancellazione account è distinta dalla sola revoca salute. Riferimento Kinde da identità OIDC verificata, cifrato con chiave dedicata e vincolato all'owner; mai collegamento per email. La riautenticazione dedicata usa state/PKCE/nonce monouso, sessione/owner originari e prova temporale firmata effettiva: se discovery non attesta il supporto richiesto, negare, senza emissione di sessione normale. L'intento durevole precede il deny indipendente; la richiesta accettata blocca accesso e accoda erasure sanitaria se necessaria. La prova di pulizia applicativa, ADK e floor indipendente precede l'eliminazione Kinde, sotto lease D1 corrente. ACK ambiguo o sola assenza non provano completamento. Pulire anche il marker attività del solo owner. Se il primo consenso ha committato solo nel D1 applicativo, il runner account riconcilia il floor indipendente `pending` direttamente a `blocked` (mai `active`) soltanto con richiesta esatta accettata, prova consenso, job sanitario della stessa generazione e deny indipendente esatto; readback dopo ACK incerto. Un registro sealed, mancante o incoerente resta bloccante. Le operazioni account catturano la generazione aperta del registro: deny e riconciliazione pending→blocked la verificano nel CAS e nel readback, i passi applicativi e le prove Management la confrontano prima degli effetti e prima di confermare. Un cambio invalida la prova, senza annullare un deny durevole o inventare un ACK provider. Un DELETE già inviato non può essere ritirato: se la risposta non è attestabile, conservare il target e lo stato non terminale. La quiescenza dei writer prima del restore rimane obbligatoria; non esiste una transazione cross-D1/provider. Il passo account seleziona la prima tabella auth non vuota dalla allowlist con un'unica lettura scoped e cancella al massimo un chunk: se concorrente e zero righe, retry senza attestare pulizia. Il floor terminale già esatto è provato dalla lettura primaria post-prova applicativa, sotto la generazione catturata dal chiamante; un avanzamento richiede invece CAS e nuova rilettura. La regressione del ciclo scheduler + GET/DELETE e finalizzazione conta le query su entrambe le D1 (budget candidato ≤45), non misura CPU, righe fatturate o runtime provider.

`runOneKindeAccountErasureStep` è un dispatcher candidato non schedulato: legge un intento per tick in ordine di UID, anche se già finalizzato, senza scansioni illimitate di righe completate. Riprende l'accettazione da un intento durevole senza sessione browser, poi delega ai passi applicativi e, soltanto con dipendenze Management esplicite, al passo provider esistente. `blocked` non è un ACK e non impedisce di avanzare al successivo UID. `runKindeAccountErasureSweepTick` persiste il cursore in 0014 con lease SQL di 60 secondi ed epoch/token esatti; lo aggiorna solo dopo il passo owner e ne verifica la rilettura primaria. A fine scansione torna a null; un crash o una risposta di claim persa conserva il punto precedente. Il lease dello scheduler protegge il cursore, non autorizza una cancellazione né sostituisce le fence per owner; i passi possono essere ripetuti. Il nuovo schema non abilita alcun trigger Cloudflare. L'ingresso scheduled candidato richiede `CF06_ERASURE_RUN_ENABLED=enabled`. La modalità `account-application` esegue un tick dello scheduler senza dipendenze Management; `health` (anche se omessa) conserva il percorso sanitario. La modalità `alternating-application` usa il contatore monotono 0015 per assegnare atomicamente un turno prima di ogni passo (dispari salute, pari account). Valori di modalità non riconosciuti mantengono la pausa prima di leggere i binding. Un claim ambiguo non avvia lavoro; una successiva assegnazione può avanzare indipendentemente dall'esito precedente. Un tick non esegue entrambe le pipeline; il contatore non è una fence owner né una prova di cancellazione. Il manifesto rimane privo di flag, trigger e route. Il dispatcher processa anche decisioni di inattività già durevoli; non avvia lo scanner, non monta endpoint e non attiva il cron. Nel runner sanitario i job eleggibili sono ordinati per `MAX(requested_at_ms, lease_until_ms)` e poi richiesta/UID: un job tentato rientra alla scadenza del suo lease, dietro a chi era già eleggibile da prima. Non si prolunga né si riusa il lease per il backoff. La selezione usa l'indice `health_erasure_runnable` (fase/stato/scadenza lease) prima del join per owner: niente scansione dei subject estranei ai job eleggibili. L'ordinamento di fairness e i predicati di ownership restano invariati; il sort delle righe eleggibili non è una prova di costo O(1). Restano da verificare backoff adattivo, quote e attivazione; la fairness di selezione non prova avanzamento in caso di guasto globale.

L'attività online candidata usa `recordKindeForegroundActivity` dopo Auth Gate, CSRF/rate gate e sessione primaria corrente; timestamp SQL, nessuna falsa attività offline/background. Aggregazione conservativa 10 minuti. `readKindeInactivityCandidates` è dry-run bounded (pagina indicizzata di massimo 16 marker prima del join e del filtro sul principal, anche se disabilitati), non accoda/disabilita. Il cursore segue l'ultima riga SQL letta anche quando nessun candidato è eleggibile; l'ordine delle scadenze UTC non è sempre quello dei marker (29 febbraio). Il candidato `runKindeInactivityDryRunTick` conserva il checkpoint diagnostico 0016 con coppia timestamp/UID, lease SQL di 60 secondi ed epoch/token esatti. Avanza anche nelle pagine senza candidati; a fine sweep torna a null, al cambio della policy o generazione recovery ricomincia dal principio. Una risposta persa richiede readback esatto; un claim ambiguo o una pausa non avanzano la scansione. Restituisce soltanto conteggio e fine sweep, non UID o marker. Il cursore dry-run non è prova di eleggibilità né checkpoint riutilizzabile per cancellazioni; il futuro scanner distruttivo dovrà verificare e processare ogni candidato con budget separato. Scadenza 12 mesi calendari UTC con margine; owner senza marker esclusi. La 0013 inizializza il controllo paused; ogni cambio generazione invalida selezioni precedenti. Il candidato `recordKindeInactivityErasureIntent` rivalida atomicamente UID, epoch, marker, scadenza, generazione, target cifrato e assenza di sessione corrente. L'origine inattività è distinta dalla riautenticazione (NULL, evidenza marker/generazione/scadenza UTC); il trigger disabilita il principal nello stesso commit e impedisce riattivazione, senza ancora cancellare dati. Il digest indipendente distingue le origini; il runner e il census usano la stessa prova esatta. Per un nuovo intento automatico serve una generazione recovery aperta esplicitamente autorizzata da configurazione trusted esterna al D1 ripristinabile: mai rileggerla e riarmare automaticamente lo scanner dopo restore. La ricevuta v2 lega owner, epoch, marker, scadenza, generazione della policy e generazione recovery; verifica quest'ultima prima del commit e dopo il readback. Una decisione di inattività di una generazione precedente può proseguire soltanto se il deny indipendente esatto era già durevole; altrimenti resta bloccata, senza nuova cancellazione. Un freeze applicativo committato durante un cambio generazione non è un ACK e richiede riconciliazione operativa, non uno sblocco implicito. Prima del restore resta obbligatoria la quiescenza; prima di riabilitare lo scanner verificare la continuità dei marker attività, non basta un census di owner/consensi. Pausa blocca nuovi intenti ma non annulla un intento durevole già autorizzato; ACK perso richiede rilettura primaria. Le migrazioni 0012/0013 non applicate sono state rinominate per rifiutare il ledger della variante precedente. L'ingresso candidato `inactivity-dry-run` richiede opt-in esatto e pin recovery esterno canonico; non accoda e non entra nelle lane di erasure. Lo scanner distruttivo non è montato. Nessun cron o nuova rotta live, né autorizzazione a cancellare account reali. Rif. [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060).

L'[inventario D1](../../docs/operations/cloudflare-d1-data-inventory.json) classifica le tabelle applicative e recovery, distingue cancellazione fisica, prove mantenute e controlli di restore. La suite `cf06-d1-data-inventory.node.mjs` applica tutte le migrazioni, confronta le tabelle effettive e le allowlist esplicite di erasure, e rifiuta nuove tabelle non classificate. Classificare non autorizza DELETE; la durata delle prove e la minimizzazione rimangono soggette a revisione privacy #824/#835. Non usare questo inventario per generare cancellazioni.

### CF-03 — Orologio D1 per sessione e consenso

Le scritture D1 dei timestamp di identità, sessione, logout e consenso
usano l'orologio SQL. I predicati di validità confrontano gli stessi
timestamp con l'ora D1 nella relativa lettura o scrittura. L'emissione
restituisce cookie solo dopo aver ricevuto la riga SQL con le scadenze
esatte. La transazione che autorizza la replica verifica anche l'istante
di emissione e rifiuta la sessione dall'istante esatto della scadenza.
Il controllo temporale delle credenziali OIDC resta nel boundary OIDC.

### CF-03 — Pianificazione condivisa delle mutazioni schede (22/11/2026)

`src/lib/routineSaveIntent.ts` valida il nome, le identità `exId`,
il numero di serie e i segmenti, e produce soltanto
`DomainOperation` tipizzate per creazione, modifica o duplicazione.
Non legge React, il vault, Auth o Zustand e non attribuisce receipt cloud.
Il guest continua a usare i propri witness e `dispatchDurableOperation`,
mentre la duplicazione Kinde usa lo stesso compilatore attraverso
`realm.submit()`. Il reducer Domain Operations resta l'autorità sulla
validità finale dello stato, sulle identità e sull'ordinamento.

Il form Kinde candidato dispone ora dell'adapter cifrato dedicato (#1366); apertura, mutazioni bufferizzate e recupero di `draft_routine` restano vincolati a owner/epoch/consenso, senza fallback guest. Il form non è montato nel pubblico; multitab, logout e PWA update su provider/dispositivi richiedono prove ulteriori. Non inferire una bozza
salvata da una `DomainOperation` non ancora committata.

### CF-03/04 — Duplicazione ed eliminazione delle schede Kinde (22/11/2026)

L'archivio candidato può ora duplicare ed eliminare schede senza bozza:
`KindeCandidateRoutines` cattura un witness di modifica dal realm `ready`,
richiama esclusivamente `realm.submit()` con `routine.upsert` e
`routine.delete`, senza usare `useTrainingRoutines`, lo store fitness guest
`useAppStore` o l'Auth Firebase. La conferma usa solo `useDialogStore` UI.
La duplicazione crea un identificativo casuale nuovo prima del commit;
il lock locale impedisce due submit contemporanei dallo stesso pannello.
L'eliminazione richiede `GlobalDialog` e riverifica il witness
**dopo** l'attesa della conferma, prima del commit. Quando fase/epoch,
consenso, owner o permit cambiano, il submit è respinto; un journal pending
non viene dichiarato cloud ACK e il pulsante di recheck non reinvia
l'intento. Non si cancellano automaticamente dati device in caso di errore.

La creazione e modifica di schede dall'editor candidato usano l'adapter di bozza cifrata Kinde integrato in #1366, non il writer guest/legacy; il contratto resta owner/consenso/fence/recovery.
Il frontend pubblico resta `identityOnly`. Test sintetici e CodeQL non
costituiscono un collaudo account/D1 Production.

### CF-03 — Presentazione isolata delle schede Kinde (22/11/2026)

`KindeCandidateRoutines` monta la libreria condivisa `RoutineLibraryList`
soltanto con snapshot `ready` del realm owner-scoped, separata da
`useTrainingRoutines`, da Zustand e dalle preferenze/draft del guest.
`RoutineCard` rende le azioni di menu solo quando il chiamante
fornisce i rispettivi handler: il wrapper guest conserva modifica,
duplica ed elimina; il candidato Kinde offre duplicazione ed eliminazione
attraverso il realm; creazione e modifica sono state aggiunte nel candidato con #1366.
Ricerca, espansione,
riepilogo serie e mappa muscolare usano soltanto la libreria dello
stesso owner Kinde e sono smontati alla perdita del permesso.

Le bozze delle schede e l'editor sono disponibili nel candidato isolato (#1366), con controlli dedicati e senza confondere i testimoni guest. Il writer delle azioni
immediate è soltanto `realm.submit()` con journal cifrato: un'azione
account non può usare l'owner o il recupero del guest.
I test React contrappongono dati guest con gli stessi
identificativi; un E2E sintetico a due profili browser verifica la
lettura dopo una ricevuta D1 senza nuove scritture/ACK. Non è un
collaudo funzionale Production né abilita fitness pubblico.

### CF-03/04 — Storico allenamenti Kinde isolato, consultazione ed eliminazione (22/11/2026)

`KindeCandidateTrainingHistory` monta il calendario condiviso
`history/TrainingHistoryView.tsx` soltanto con lo snapshot di un realm
`ready`. Non monta `useTrainingHistory`, non legge `useAppStore`
e non eredita il writer Firebase. Il report riceve storico, libreria
e nutrizione dallo stesso snapshot owner-scoped, attraverso
`WorkoutReportView` senza stato globale.

La cancellazione di una sessione esistente richiede conferma esplicita,
un witness corrente di owner/sessione/consenso catturato prima della
conferma e una sola `realm.submit({ type: 'history.delete', id })`.
Un guard impedisce richieste simultanee dallo stesso pannello.
Un journal `local-pending` non equivale a un ACK D1 e non autorizza
a reiterare l'intento; recheck e recupero sono responsabilità del realm.
Una conferma tardiva dopo revoca/logout o una risposta di errore
di una sessione precedente non possono autorizzare una nuova
cancellazione né mostrare un alert obsoleto.

Seduta attiva ed editor dello storico sono ora disponibili nel candidato (#1400–#1402), con bozze cifrate separate e CAS sul dato osservato. La chiusura della seduta crea lo storico; l'editor modifica solo la seduta esistente, senza ricrearla se cancellata. Non sono montati nel pubblico. `WorkoutReportModal` e il suo writer guest
rimangono separati. Alla perdita di sessione, epoch, consenso o
chiusura dell'archivio la vista e i report vengono smontati.
Le regressioni UI controllano owner guest estraneo, operazione esatta,
conferma rifiutata, witness revocato, intenti concorrenti e fallimento.
Il compilatore emette tombstone privi di `value`, coerenti con il parser del journal cifrato; il controllo esatto degli intenti persistiti rimane obbligatorio prima dell'invio.

Il test browser isolato `kinde-history-delete.spec.ts` monta il dialogo di conferma
reale e verifica in due profili TLS distinti sia il rifiuto della richiesta,
sia una sola ricevuta D1 osservata prima della replica, sia il retry dello
stesso journal dopo HTTP 429 senza attestare un ACK non acquisito.

L'archivio rimane candidato non pubblico: suite sintetiche e CodeQL
non certificano il comportamento fitness su provider Production.

### CF-03/04 — Scadenza della vista Kinde candidata (21/11/2026)

Il realm fitness candidato richiede, oltre al consenso trusted, la scadenza
applicativa verificata `X-Logbook-Session-Expires-At-Ms` letta dal Worker.
Senza questa prova non espone un nuovo snapshot. L'osservazione D1
`observedAtMs` e la scadenza della stessa lettura primaria delimitano
il tempo residuo. Prima della richiesta di consenso il browser campiona
orologio locale e monotono. Sottrae il maggiore dei due tempi trascorsi,
compreso il readback finale, e rifiuta arretramenti rispetto al campione.
Il permesso resta legato a sessione, vault e consenso ed è verificato
anche dentro il commit. Un nuovo
`refresh()` online può acquisire una prova successiva, ma non ripubblica
plaintext senza completare nuovamente i controlli trusted. Il lifecycle React
chiude la vista candidata quando il permesso scade senza eventi di focus,
cookie o storage; il controllo periodico locale non effettua richieste di rete.
Il percorso pubblico resta `identityOnly`, privo di grant fitness.

### CF-03 — Editor biometrico indipendente dal writer (21/11/2026)

`useProfileEditor()` mantiene soltanto bozza, revisione e intento
`profile.patch`: riceve esplicitamente owner, profilo e un testimone
revocabile della sessione insieme a un singolo writer Domain Operations.
`useSettingsProfile()` conserva l'adapter Zustand/guest o Firebase legacy
sul proprio owner; `useKindeCandidateProfile()` usa **solo** il realm
Kinde confermato e `realm.submit()` verso journal cifrato/D1. Lo stesso
form non può ripiegare sullo store legacy quando l'account è sospeso,
revocato o è cambiata la generazione, nemmeno A→B→A dello stesso UID.
Il form condiviso riusa lo stesso intento nelle due viste. La Promise
dell'editor attesta l'accettazione durevole dell'intento sul dispositivo
o l'assenza di modifiche da salvare. Il realm possiede lo stato della
conferma cloud per tutti gli editor: `local-pending` indica durabilità
locale comprovata e l'esito ambiguo richiede `recheck()` senza ripetere
l'intento. La patch contiene soltanto i campi modificati, così un valore
letto prima di un aggiornamento da un altro dispositivo non diventa una
nuova scrittura. Dopo gli await si ricontrolla il testimone e si ritirano
soltanto le revisioni dei campi incluse nel salvataggio. Il pannello fitness
isolato monta il form dopo l'apertura esplicita dell'archivio verificato.
Alla chiusura dell'archivio il form viene smontato e torna disponibile la
gestione account. La PWA pubblica resta `identityOnly`. Gli altri editor e
writer legacy richiedono migrazione progressiva prima del GO.

### CF-03 — Pianificazione nutrizionale con un solo writer per owner

La pianificazione usa un editor e un form condivisi. L'adapter guest/legacy
legge lo store soltanto per l'owner corrente. La vista candidata Kinde riceve
il profilo e la nutrizione esclusivamente dallo snapshot autorizzato del
realm e invia `nutrition-planning.replace` tramite `realm.submit()`.
La bozza e lo stato di salvataggio sono legati al testimone revocabile:
cambio owner o generazione nasconde i valori precedenti anche quando l'UID
coincide. Il realm è l'autorità sul journal in attesa: l'adapter della pianificazione
restituisce `local-pending` all'editor quando la ricevuta D1 non è ancora
verificata, senza convertire la durabilità locale in conferma cloud. Il pannello monta
l'editor soltanto nella fase `ready`: durante il commit e il recheck lo
smonta, così la riapertura con uno snapshot verificato non riporta l'avviso
stale `local-pending` del vecchio form. Il banner generale del journal
resta visibile finché la riconciliazione non è confermata, senza reinviare
il salvataggio dal form.
L'ingresso account isolato monta la vista solo dopo consenso verificato
e apertura esplicita dell'archivio. Ripristino e azioni di gestione restano
fuori dalla vista mentre il realm è aperto e tornano disponibili quando
viene sospeso. La PWA pubblica resta `identityOnly`.

### CF-03/04 — Diario pasti Kinde candidato

Il diario condivide form e intenti con la modalità locale. Nella vista Kinde
alimenti, pasti e assunzioni provengono dallo snapshot dell'archivio aperto.
Le mutazioni usano `realm.submit()` e le conferme ricontrollano la sessione
catturata. Un journal in attesa viene mostrato dal pannello dell'archivio.
Dopo la verifica resta selezionata la stessa data, senza ripetere l'intento.
Lo storico mostra soltanto i giorni con pasti nello stesso snapshot e ne
apre il diario in sola navigazione. La chiusura dell'archivio rimuove
entrambe le viste.

La scheda Integratori nello stesso archivio legge libreria e assunzioni
dallo snapshot Kinde. Crea, modifica, duplica e rimuove voci o registra e
rimuove assunzioni attraverso lo stesso writer degli altri editor. La
conferma di rimozione resta vincolata alla sessione che l'ha aperta. Durante
un commit il diario è nascosto. Dopo un salvataggio locale la bozza inviata
viene ritirata e le altre quantità già digitate restano nello stesso
archivio fino alla sua chiusura o invalidazione.

La scheda Alimenti usa l'archivio personale dello stesso snapshot e invia
gli intenti attraverso il writer Kinde. Creazione e duplicazione generano
un ID nuovo. Una modifica mantiene l'ID originale e fallisce se la voce
è stata rimossa. L'aggiunta rapida registra una copia nel diario di oggi.
La conferma per rimuovere una voce riverifica la sessione originaria e
lascia intatti i pasti che contengono una copia.

### CF-03/04 — Recheck del journal Kinde dopo esito ambiguo (21/11/2026)

Se `useKindeCandidateFitnessLifecycle.submit()` riceve
`local-pending`, la vista rimane nascosta e la fase diventa
`recheck-required`. L'azione esplicita `recheck()` richiama **solo**
`KindeCandidateFitnessRealm.refresh()`: verifica di nuovo identità,
epoch, cookie, consenso trusted e vault, quindi riconcilia il journal
e la ricevuta D1 originale. **Non ripete** `DomainOperation` e non
converte un timeout in ACK. Una risposta arrivata dopo logout, nuovo
owner/generazione o chiusura dello scope è respinta senza pubblicare
plaintext. Se il recheck fallisce, il vecchio scope viene chiuso;
una nuova apertura richiede una nuova readiness completa.
Un errore terminale durante il submit rilascia lo stesso scope
senza eliminare ciphertext o journal. Le regressioni coprono React e
Worker/AuthGate/D1/IndexedDB sintetici con risposta persa **dopo**
il commit D1, accertando una sola modifica e un solo receipt.
Questa API resta candidata e **non montata nel pubblico**.

### CF-03 — Lifecycle React Kinde isolato, senza grant legacy (21/11/2026)

`openKindeCandidateFitnessRealm()` verifica il percorso Kinde/consenso/owner,
idrata e riconcilia il checkpoint cifrato attraverso
`withKindeCandidateLocalReadiness()`, quindi restituisce un
ambito esplicito con snapshot copiato, `refresh()`, `submit()` e
`close()`. Il realm usa il writer Domain Operations senza installare
un lettore Auth globale o conservare le chiavi in RAM tra operazioni.
`submit()` usa `submitKindeCandidateDomainIntent()`: se un commit o
trasporto è incerto, la vista precedente è invalidata; un esito
`local-pending` conserva il journal ma non è un cloud ACK.

`useKindeCandidateFitnessLifecycle()` orchestra la stessa risorsa in
React soltanto con **abilitazione esplicita** e fase `consent-confirmed`
(email verificata, epoch e revisione positivi). Un cambio generazione
React, sessione/cookie, marker revoca, cambio scheda, foreground o
unmount invalida il tentativo e nasconde la vista; una risposta asincrona
obsoleta non la può riaprire. Prima che la pagina venga congelata nella
cache Indietro/Avanti, `pagehide` chiude il realm e rimuove subito la vista
fitness. Al ritorno dalla cache, `pageshow` richiede una nuova verifica della
sessione attraverso lo stesso controllo di foreground. L'apertura
dell'archivio resta esplicita. Nessun mount pubblico, nessuna chiamata
automatica di bootstrap, nessuna installazione
`authenticatedIdentitySource` o `AuthContext.currentUser`.
Il vault è chiuso al termine di ogni scope, anche quando React continua
a conservare temporaneamente uno snapshot consentito.

**Salvataggio offline candidato:** lo stato consenso del Worker
può riportare `X-Logbook-Session-Expires-At-Ms` dopo il readback
primario e il controllo del registro indipendente, per una sessione
verificata con CSRF e consenso attivo alle versioni legali correnti.
Un realm già aperto online può usare questo limite per salvare nel
journal cifrato quando il browser segnala assenza di rete. Il permesso
vive nel documento, è vincolato a sessione, consenso, vault e replica,
e scade al primo limite fra sessione e replica. Il journal riusa
l'osservazione D1 e gli stessi campioni temporali del realm,
con la scadenza della replica come ulteriore limite. La vista e il
testimone di modifica condividono questo
controllo offline. React lo verifica al passaggio offline e durante il
controllo periodico, chiudendo la vista se il permesso non vale più.
La transazione IndexedDB verifica di nuovo envelope,
revoca, purge e scadenza. La scrittura resta locale fino alla rilettura
trusted al rientro online, quando `refresh()` riconcilia il journal
senza ripetere l'intento. Dopo un reload offline il realm candidato
non può ancora riaprire l'account. Prima del GO restano il lifecycle
completo di UI, reload, multitab e logout, WebKit su dispositivo e
prove sul provider isolato. **Il frontend pubblico resta identity-only.**

### CF-03/04 — Intento fitness Kinde con journal cifrato e ricevuta D1 (21/11/2026)

`src/lib/auth/kindeCandidateDomainIntent.ts` compone, **solo nel percorso
candidato**, la readiness Kinde con consenso server trusted, vault device
temporaneo, replica verificata e journal completamente riconciliato, quindi
`commitDomainOperations()` con guard owner/sessione dentro la transazione
IndexedDB. La mutazione business e il journal semantico sono durevoli **prima**
della consegna cifrata a D1 tramite `deliverKindeCandidateJournal()`.
`legal-consent.set` è rifiutata: il registro trusted D1 è autorità per il
consenso e nessuna operazione fitness può creare una nuova prova legale.

La risposta distingue `local-only`, `local-pending` e
`cloud-acknowledged`: un errore di rete non diventa `local-pending` senza
rilettura della sequenza semantica originale ancora durevole, e un ACK cloud
richiede ricevuta verificata dal bridge e frontiera causale locale che copra
esattamente le operazioni committate. Una ricevuta di batch **non** garantisce
che tutte le future modifiche siano state drenate. Nessun retry reinventa
l'intento, l'UID non costituisce prova Auth e il vault viene rilasciato.

Questo componente non è un runtime account offline o multi-tab già montato:
il provider pubblico resta **identity-only**, senza `D1_API` o grant fitness.
La sua integrazione effettiva richiede lifecycle owner/sessione React, guard
delle normali mutazioni e recovery offline verificati; non usare una flag per
aggirare questi gate.

### CF-05 — ambito di preparazione locale Kinde, senza grant globale (20/11/2026)

Il percorso candidato `withKindeCandidateLocalReadiness()` compone
bootstrap con consenso verificato, hydration AEAD, claim replica e journal
interamente riconciliato con un nuovo controllo del consenso trusted D1.
Riapre un vault device soltanto durante una callback isolata e lo richiude
nel `finally`, anche per cambio cookie CSRF, sessione obsoleta, revoca
locale, errore del chiamante o dati incoerenti. Non installa
`authenticatedIdentitySource`, non crea un `currentUser` Firebase e non
equivale a un grant fitness: ogni futura richiesta cloud deve continuare a
verificare sessione, consenso, owner e recovery nel Worker.
**Il provider pubblico rimane identity-only; questa API non è montata.**

## CF-05 — Revoca Kinde candidata e stato UI (19/11/2026)

`KindeAccountEntry` richiede un **secondo** opt-in
`candidateLifecycleEnabled` per presentare la revoca candidata
ed il diritto di lettura post-revoca. Non è montato nel
`KindeAccountSessionProvider` pubblico. Il componente
`KindeCandidateWithdrawalPanel` nella vista `consent-suspended` è solo
riconciliazione read-only quando esiste un marker pendente, anche dopo
reload: non mostra una seconda azione distruttiva. Nel consenso attivo
contiene l'offerta volontaria
di backup seguita da conferma esplicita della cancellazione; un
cambio marker anche da un'altra scheda sopprime il backup e la
richiesta distruttiva. Lo stato `pending:1` non viene cancellato
né convertito in successo dal solo client.

`useKindeAccountSession.withdrawCandidateConsent` esegue solo il
boundary trusted Kinde e aggiorna la vista dopo la conferma server;
`reconcileCandidateWithdrawal` usa esclusivamente le letture
trusted per recuperare l'esito incerto senza **ripetere** il POST.
Il percorso `prepareCandidateRightsJson` resta separato, disponibile
anche all'email non più verificata con generazione di consenso 1,
e richiama il solo export di documenti ancora presenti. La vista
non conferma erasure completa, non crea vault/owner fitness e non
riattiva account. Il test di integrazione React conserva il blocco
identity-only/guest e le prove SQL Worker/D1 originali restano
autorità dei contratti di revoca.


### Consenso D1 autorevole durante ACK cifrato (19/11/2026)

La CI del primo candidato ha trovato un difetto concreto: il root business cifrato D1, che non è autorità per la prima accettazione, poteva contenere `legalConsent: null`; il normale `acknowledgeThrough()` lo rigiocava dopo una ricevuta remota e perdeva la scelta legale già verificata. Il bridge Kinde ora trasmette il `legalConsent` ricevuto da `readKindeCandidateAccess()` insieme al gate sessione/consenso fino alla consegna cifrata. Solo per il batch D1, il boundary atomico IndexedDB verifica che la prova corrisponda al consenso locale e impedisce che il business root sovrascriva la scelta legale durante l'ACK; se i valori divergono rifiuta l'ACK e conserva l'intento originale. Il percorso Firebase generico resta invariato. Una ricevuta D1 non è mai un nuovo consenso, né prova che il journal completo sia stato drenato.

### Continuità Kinde → consegna journal nel candidato React (19/11/2026)

Il pulsante esplicito `Continua` del solo ingresso candidato Kinde invoca `prepareCandidateArchive({ drainPendingJournal: true })`. Il bridge già esistente verifica nuovamente UID/sessione/CSRF, consenso D1 e owner, riapre il vault device, confronta checkpoint e replica, quindi riconcilia il journal cifrato con un ACK verificato o accerta che non vi siano operazioni in attesa. **Il solo checkpoint o la replica attiva NON sono successo di consegna** e `journalOutcome: 'acknowledged'` prova un singolo batch, non necessariamente l'intero journal. Dopo ogni consegna il bootstrap rilegge IndexedDB sotto il medesimo vault/session fence e restituisce `journalDrained: true` soltanto se non esistono né pending né delivery intent; altrimenti restituisce `kind: 'journal-pending'` e chiude il vault temporaneo. L'interfaccia mostra il completamento solo con checkpoint e replica confermati, `journalDrained: true` e outcome `idle | acknowledged`. Risposte perse, modifiche arrivate durante l'ACK, journal non confermato, claim in riconciliazione ed errori rimangono `pending`/errore, con retry non distruttivo.

Il `KindeAccountSessionProvider` pubblico mantiene `identityOnly: true`, `candidatePreparationEnabled: false`; nessun account fitness, `authenticatedIdentitySource`, owner globale o API sanitaria pubblica è autorizzato da questo passaggio. La chiave device del tentativo candidato viene sempre rilasciata (`retainDeviceVault: false`), la KEK resta solo lato Worker. L'eventuale revoca/erasure conserva precedenza sui risultati di richieste tardive: `isKindeAccountLocalFitnessClear` e i fence Auth/consenso sono ricontrollati nei bridge; per l'attivazione reale servirà un lifecycle Kinde completo e verificato anche in browser/provider.

### Continuità consenso Kinde → preparazione vault in React (candidato 19/11/2026)

L'ingresso `KindeAccountEntry` può collegare, nella modalità esplicita `candidateMode="preparation"`, la conferma autorevole del primo consenso a un pulsante ordinario `Continua` che richiama `useKindeAccountSession.prepareCandidateArchive()`. Non genera/mostra chiavi, non installa un owner fitness, non chiama direttamente D1 ed è disponibile soltanto dopo `consent-confirmed`; l'azione non parte automaticamente al mount o al login. Un risultato con checkpoint e replica verificati rimane soltanto una osservazione candidata; la consegna ambigua o fallita è mostrata come in attesa/errore e non diventa successo. Lo stato del componente è scoped alla generazione UID/epoch/revisione, quindi la sessione sostituita non può pubblicare il risultato precedente.

**MUST (confine pubblico):** `src/main.tsx` monta `KindeAccountSessionProvider` con `identityOnly: true`, `candidatePreparationEnabled: false`; `App.tsx` monta `KindeAccountEntry identityOnly`. Il pulsante candidato non è visibile né eseguibile nella PWA pubblica. Restano obbligatori consenso/revoca/diritti, owner install, Vault lifecycle, integrazione gateway D1 e prove provider/browser prima di attivare un account fitness.

### Collegamento React Kinde → bootstrap D1 candidato (19/11/2026)

L'osservatore condiviso `useKindeAccountSession` espone `prepareCandidateArchive()` soltanto per prove di integrazione con attivazione **esplicita**: nel provider pubblico `candidatePreparationEnabled: false` e `identityOnly: true`. Il metodo può partire soltanto da una sessione email verificata e revisione consenso account positiva, con generazione React corrente e lo stesso cookie CSRF; rifiuta guest, sessioni sostituite, doppio avvio, completamenti tardivi e teardown. La lettura Kinde continua a essere unica per la UI e nessun percorso esegue automaticamente il bootstrap al mount, al ritorno in foreground o al login.

Il bootstrap candidato si carica dinamicamente solo dopo questo gate e usa `retainDeviceVault: false`: **anche un checkpoint/claim D1 riuscito rilascia la chiave del vault dell'esatto tentativo**, senza revocare una nuova apertura concorrente. L'esito osservato non installa `authenticatedIdentitySource`, `currentUser`, owner fitness, sessione applicativa o diritti. Una futura abilitazione richiede comunque lifecycle consenso/revoca/rights/erasure, riapertura e fencing del vault, binding D1/KEK e collaudi veri; impostare il flag non rappresenta un GO funzionale.


### Identità nel controllo di aggiornamento PWA

Il ramo di aggiornamento dalla schermata di accesso legge la sorgente di identità registrata dal provider montato. Un client Firebase importato può ancora conservare un utente e non decide l'owner di questa schermata. Il reload rapido resta possibile solo con memoria senza dati, nessun guest attivo o revocato e sessione locale invariata. Se la sorgente non è leggibile, i controlli di sessione continuano a bloccare il reload.

### Regressione E2E guest senza rete Auth (18/11/2026, v2.531.0)

Il test browser `e2e/account/guest-network-isolation.spec.ts` verifica, **dopo l'attivazione guest**, che modifica salute locale cifrata, apertura seconda scheda, ricaricamento e ripresa offline non originino richieste verso Kinde, Firebase Auth/Firestore/App Check, API Auth o API sanitarie Workers. Le destinazioni sono anche bloccate durante la prova; si controllano il dato reale riletto e il ciphertext owner-scoped IndexedDB. Il primo test del gate ha individuato chiamate reali a `www.google.com/recaptcha/enterprise.js` dopo il reload guest: la causa era `ensureAppCheckProvider(firebaseApp)` invocato durante **l'import** di `src/lib/firebase.ts`. Il bootstrap App Check è stato reso on-demand: `getDb()` lo inizializza sincronicamente prima di Firestore; `ensureAppCheck()` prima dell'acquisizione di credenziali, senza fallback per autorizzare il cloud. Una regressione unitaria blocca il ritorno dell'effetto di import. Questo è un gate comportamentale dell'ospite; non prova l'eliminazione degli SDK Firebase dal bundle né l'accesso Kinde fitness. Il primo ingresso non autenticato può verificare la sessione Kinde prima che l'utente scelga esplicitamente ospite. I gate WebKit/Safari reali e il ritiro degli import restano distinti.

### React Kinde presence boundary (18/11/2026, v2.530.0)

Il runtime pubblico monta un unico `KindeAccountSessionProvider` **dentro** il `GuestOnlyAuthProvider`: la verifica della sessione browser Kinde è riusata dalla schermata di ingresso anziché avviare due probe concorrenti. Un cambiamento cookie CSRF, reconnect/focus o guest generation riconcilia lo stesso stato condiviso, con generazione e annullamento dei risultati obsoleti. Lo stato `identity-verified` è **solo presenza**; non installa `authenticatedIdentitySource`, non crea `currentUser` Firebase, non sblocca vault né abilita fitness/consenso/ADK/ACK. Il ramo pubblico continua `identityOnly`, il guest conserva il suo namespace e non è associato automaticamente a Kinde. Un futuro grant fitness richiede uno specifico adapter Kinde con consenso/D1/chiavi/sync e diritti verificati; **non** interpretare il contesto presenza come authorization.


### Preparazione account Kinde non montata (18/11/2026)

Il candidato `prepareKindeCandidateOwner()` compone verifica fidata email/consenso, recovery del vault device Kinde (senza Firebase), hydration cifrata e claim D1 recuperabile. La generazione della sessione del chiamante e il CSRF host-only restano fissati attraverso ogni await; non installa `currentUser`, non trasferisce guest né abilita direttamente le funzioni fitness. `isKindeAccountLocalFitnessClear()` rifiuta guest attivo, revoca salute locale (anche pending), cancellazione account e generazione locale divergente; tale verifica è ripetuta in hydration, claim e journal. Restano obbligatori il runtime Auth/consenso/diritti, API/provider Production e test multi-device/Safari prima del cutover.


### Confine lettore di identità autenticata indipendente dal provider (17/11/2026, candidato)

`src/lib/sync/session.ts` non importa più Firebase direttamente. Il lettore sincrono di identità è registrato dal **solo provider attivo** e restituisce `null` se non è autenticato; un secondo provider concorrente, un UID malformato o un errore della sorgente falliscono chiusi. La registrazione legacy esiste soltanto mentre il vecchio `AuthProvider` è montato: l'import di `src/lib/firebase.ts` non registra più alcun UID. Il consumer Kinde-first non installa ancora un owner autenticato. Per il passaggio a Kinde sarà obbligatorio rimuovere il vecchio provider e registrare la sorgente soltanto dopo la verifica della sessione Kinde, con fencing delle sue generazioni. La sola presenza di un UID non sblocca vault, consenso o operazioni D1.

### Bridge claim Kinde candidato (18/11/2026)

La nuova `claimKindeCandidateReplica()` presuppone sessione e consenso attivi, vault device già creato e sbloccato per lo stesso UID, baseline legale server-derived e generazione sincrona del chiamante; non installa il reader Auth e non concede un account fitness. Blocca mutazioni se l'owner del controllo D1, il cookie CSRF, il consenso, il vault o la replica non coincidono, e conserva gli intent cifrati recuperabili dopo risposta remota ambigua. Serve ancora la composizione runtime di identità, lifecycle consenso/diritti/erasure, replica/journal e verifica API/provider prima di eliminare il blocco `identityOnly`.

**Quando leggere:** email verificata, accesso guest→account, sessioni, account deletion, logout e purge.
**Non inferire:** Auth assente, timeout o tombstone scaduto non provano cancellazione completa né autorizzano purge locale.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

### Isolamento del lettore UID Firebase non montato (18/11/2026, v2.525.0)

Il modulo `src/lib/firebase.ts` può ancora essere importato per i servizi legacy, ma **non registra più automaticamente `auth.currentUser`** come fonte di owner locale. Il vecchio `src/contexts/AuthContext.tsx` installa il reader soltanto durante il montaggio di quel provider e lo rilascia allo smontaggio. `authenticatedIdentitySource.install` conserva il reader quando esistono più mount dello **stesso** provider e rifiuta un provider concorrente diverso. Un disposer tardivo è innocuo. Anche un hint owner valido viene validato ma non usato da `storageOwner()` se nessun reader di provider è registrato; la sua presenza non è una sessione. In produzione Kinde-first, dove è montato solo `GuestOnlyAuthProvider`, un UID Firebase persistito non può essere letto da `storageOwner()` come utente attivo né autorizzare il purge come identità corrente. I marker owner-scoped corrotti o non verificati restano fence separati e non vanno eliminati per comodità.

Non è il ritiro del client Firebase: `initializeAuth`, App Check e i chiamanti legacy sono ancora importabili/caricabili e alcuni possono eseguire I/O; l'account Kinde verificato non sblocca vault/consenso/journal. Niente GO API/fitness.

### Purge guest disaccoppiato da Firebase (18/11/2026, v2.526.0 candidato)

Il percorso guest Kinde-first usa `guestLocalPurge.ts`: riprende i fence owner, consenso, recupero cancellazione account e Web Lock/IndexedDB senza importare `DB` o Firebase. `useGuestLogin` riceve la callback di purge dal provider attivo: il provider legacy mantiene il proprio adattatore, mentre `GuestOnlyAuthProvider` usa il percorso locale. Il comportamento di revoca e cancellazione fisica rimane fail-closed, inclusi i purges interrotti; questa separazione **non** sblocca account Kinde o fitness e non prova la rimozione delle altre dipendenze Firebase nel runtime.

### Bootstrap Kinde-first senza AuthProvider Firebase (18/11/2026, v2.524.0 candidato)

`src/main.tsx` monta `GuestOnlyAuthProvider` anziché il vecchio `AuthProvider` e non monta più il recupero di cancellazione Firebase pre-lancio. Il provider corrente non sottoscrive `onAuthStateChanged`, non fabbrica `User` Firebase, non adotta identità Kinde né owner account, e rifiuta esplicitamente i vecchi comandi email/Google. Usa `useGuestLogin` e `logoutActiveGuestSession` per lock, revoca durevole, controllo tra schede e purge guest. Il vecchio provider rimane nel codice per test e come riferimento temporaneo ai chiamanti da convertire, **non** è l'autorità runtime della nuova baseline.

**Residuo e rischio:** altre importazioni statiche (`db.ts`, `healthConsent.ts`, componenti e impostazioni) caricano ancora il modulo Firebase; la sua inizializzazione e il lettore UID legacy non sono stati rimossi. Un utente Kinde verificato vede solo identità, non può usare ancora le funzioni fitness account e non deve essere rappresentato da un `User` simulato. Il ritiro vero di Firebase richiede convertire storage/consenso/replica/impostazioni e verificare che il guest non usi più Firebase sulla rete.

### Ritiro schermata login Firebase (18/11/2026, v2.523.0 candidata)

Il componente non montato `LoginBox` e i relativi test esclusivamente legacy sono stati eliminati. L'ingresso account in `App.tsx` continua a montare `KindeAccountEntry identityOnly` e la scelta guest rimane limitata allo stesso owner/vault, senza adozione cloud. Il ritiro della UI **non** ritira `AuthProvider` né gli SDK ancora importati dal lifecycle guest/account, storage e consenso: non presentarli come rimossi finché i chiamanti e i trasporti Workers/D1 non sono convertiti e verificati. Regressioni di branding, tema e ingresso Kinde sostituiscono gli assert del vecchio form.

### Ingresso guest: non invocare la registrazione Firebase (17/11/2026)

Senza un trasferimento guest→Kinde collaudato, l'overlay guest non può montare `LoginBox` e la scheda Account ospite non deve offrire registrazione Firebase Google/email. Un dialog non distruttivo e con focus confinato spiega la sospensione e permette di ritornare ai dati locali; resta invariato il logout guest protetto. L'apertura/chiusura non modifica owner, generazione, vault o journal, né interroga Kinde. Non confondere il blocco UI con l'effettiva rimozione del vecchio `AuthProvider` o con la realizzazione del trasferimento a Kinde.

### Continuità sessione Kinde per letture multi-step (17/11/2026)

Identità, consenso e replica candidati devono fissare il cookie CSRF di sessione **prima** della prima lettura HTTP, non soltanto fra due letture. UID, `fenceEpoch` e revisione consenso uguali non provano la stessa sessione A→B→A. Il cookie canonico è indispensabile prima di interpretare un `200 authenticated`; la sua assenza è ammessa solo per un `401 unauthorized` canonico. Cambi, duplicati, valori malformati e incoerenza dopo un'attesa falliscono chiusi. La prova CSRF è distinta dall'autorizzazione server e non concede owner, vault, ADK o sync.

### Fence sincrono azione/foreground Kinde (17/11/2026)

Un evento `focus` o `online` nello stesso turno di un comando Kinde non deve invalidare la generazione del comando prima del commit di `busy` React. Usare un latch sincrono di operazione, rilasciato anche per errori/teardown; un recheck foreground può partire solo senza operazioni in corso. L'osservatore non autorizza fitness, consenso o accesso ad archivi, anche in caso di sessione verified.

### Azione Kinde legata alla sessione visualizzata

L'ingresso React conserva in memoria la prova del cookie per la sessione
che ha mostrato il tasto di disconnessione. Il client ricontrolla quel token
prima di inviare il logout. Una scheda con una schermata obsoleta non può
revocare la sessione sostitutiva. Il riscontro resta un 401 attendibile,
perché il Worker rimuove il cookie della sessione appena terminata.

### Riconciliazione sessione Kinde foreground (17/11/2026)

La schermata React Kinde `identityOnly` deve rileggerne lo stato trusted al ritorno dal background o della rete, invalidando i risultati di richieste precedenti e accorpando gli eventi simultanei. Un errore di rete o una sessione non verificata non concede owner, consenso, vault o fitness; la modalità guest già attiva non effettua queste letture. Questo è soltanto un osservatore UI: `AuthProvider`, `storageOwner()` e il ciclo guest→account Firebase restano da convertire. La diagnostica HTML è indipendente e richiede una prova Network sul browser normale prima di attribuirne il blocco a uno specifico componente.

### Confine identità per l'avvio guest (17/11/2026)

`useGuestLogin` non legge più direttamente `firebase.auth.currentUser`: il provider fornisce `readAuthIdentity(): unknown`, oggetto opaco che deve conservare identità stabile soltanto durante la stessa sessione, e un `authRunRef` monotono. La vecchia implementazione Firebase passa esattamente il suo oggetto `auth.currentUser`, preservando il comportamento corrente; il nuovo provider Cloudflare dovrà passare un token di sessione stabile, **non** solo UID, e incrementare la generazione a ogni cambio/riaccesso A→B→A. Dopo ogni await il guest lock continua a verificare generazione, owner, sessione e vault prima di pubblicare dati. Questo è un refactoring preparatorio, **non** l'adozione della sessione Kinde o il cutover dell'AuthProvider.

### Riavvio OAuth senza sessione attestata (17/11/2026)

Nell'ingresso React `identityOnly`, un errore di lettura dell'identità non deve bloccare un nuovo accesso esplicito attraverso il Worker Kinde: il POST same-origin di avvio ha propri gate CSRF/state/rate-limit. **Non** trasformare questo errore in un login autenticato, consenso o permesso cloud. La pagina diagnostica `/verifica-accesso` usa un form HTML nativo separato; il mancato avanzamento nel browser normale non è ancora causalmente dimostrato e va distinto dal blocco della vecchia sessione Firebase sul frontend.

### Sessione Kinde reale e logout applicativo diagnostico (17/11/2026)

Il proprietario ha registrato un account email/password di prova su Kinde e ha confermato il login con due letture `/api/auth/session` dal browser, email verificata, epoca 1 e consenso sanitario a revisione 0. Non è un'abilitazione dell'archivio locale o delle API fitness. La pagina `/verifica-accesso` può ora verificare la revoca della **sola sessione applicativa** tramite CSRF host-only e successivo status 401; non è logout SSO Kinde né purge e resta da collaudare in browser reale.

### Osservatore email e primo ingresso UI Kinde (candidato CF-03, 16/11/2026)

`readKindeCandidateIdentity` legge due status trusted con controllo di generazione e CSRF per distinguere la sessione assente dall'email non verificata, mantenendo i percorsi rights-only privi di permessi fitness. La sola variante `identityOnly` di `KindeAccountEntry` è montata nell'ingresso React: non adotta né crea un `User` Firebase e non interroga consenso/ADK. Le tre scelte esplicite per il consenso D1 e la replica restano candidate non montate. Il guest rimane escluso dalle operazioni Kinde mentre il trasferimento non è implementato; non si cancellano dati guest. La risposta positiva di identità o consenso non sblocca IndexedDB né la replica. Il cutover effettivo richiede separazione di AuthContext e percorso cloud con test browser/provider; non attivare salute sul dominio senza tutti i gate.

### Checkpoint storico — ingresso Kinde nella PWA (17/11/2026, v2.506.0; prima di GuestOnlyAuthProvider)

La schermata account **senza Firebase User** in `src/App.tsx` monta ora `KindeAccountEntry identityOnly` solo quando `AuthProvider` segnala nessun account Firebase e nessuna sessione guest. Lo stato viene letto esclusivamente dal servizio `/api/auth/session` con conferma dell'email e cookie CSRF; in questa fase non viene chiamato `/v1/consent/status`, non viene prodotto alcun `User` Firebase, non viene adottato un owner Kinde e non si sblocca il vault né la sincronizzazione. La modalità guest locale resta accessibile per scelta esplicita dopo 401 oppure quando Kinde è indisponibile, senza mai concedere permessi cloud o adottare un owner remoto. Una sessione Kinde verificata (anche con email non verificata) non offre un ingresso guest implicito. La schermata guest già avviata presenta ora un blocco informativo senza chiamare Firebase: **il trasferimento guest→Kinde non è ancora supportato** e i dati locali restano preservati. L'app continua a montare `AuthProvider` Firebase e gli altri consumer legacy; **non è il cutover completo**.

### Destinazione dopo il callback Kinde

Dopo l'emissione della sessione D1, il Worker risponde con un redirect 303 a `/` sullo stesso origin. La destinazione è fissa, senza parametri OAuth o dell'utente. All'arrivo la schermata account React verifica la sessione tramite `POST /api/auth/session`; il redirect da solo non concede accesso al vault o ai dati. La pagina `/verifica-accesso` resta consultabile direttamente per la diagnostica.

## Target Kinde selezionato — contratto corrente

Kinde è il provider di identità per la **nuova baseline fresh start**. Lo stack legacy Firebase descritto nelle sezioni successive documenta i chiamanti e gli invarianti ancora da sostituire; il frontend pubblico monta GuestOnlyAuthProvider e l'ingresso Kinde identity-only, **non** impone di usare Firebase dopo il cutover. Nessun dato/credenziale/UID vecchio viene migrato. Il backend Worker verifica token Kinde con RS256/JWKS, `iss` e `aud` esatti, `azp` per il solo client autorizzato e scadenze brevi; un token valido **non** costituisce da solo prova di email verificata, consenso salute, o autorizzazione D1. L'identità Kinde (`iss` + `sub`) deve essere associata all'owner interno senza collisioni e verificata tramite flusso trusted prima che `session-issuer.mjs` crei una sessione. Nessun endpoint pubblico può emettere sessioni con UID forniti dal chiamante. Il provisioner interno `cloudflare/auth/kinde-principal-provisioner.mjs`, tramite `kinde-owner-id.mjs`, deriva un owner ID `k_` dal digest SHA-256 separato per dominio di `issuer + subject` **solo dopo** verifica OIDC con email verificata e nonce dal callback trusted. Il primo insert in D1 è idempotente e una read primaria valida lo stato; login successivi non riattivano owner disabled/deleted e non reimpostano `auth_epoch`. La derivazione non è una chiave cifrante né una prova di sessione. Il candidato HTTP `kinde-oauth-flow.mjs` già consuma state e PKCE monouso, verifica nonce e token firmati e crea la sessione D1; il Worker HTTP Kinde privato è collegato al gateway frontend limitato a OAuth/sessione identity-only, non a D1 fitness. Le prove manuali di email/password e Google/logout/rientro sono registrate in CF-03; reset, revoca/email cambiata, lifecycle completo e collaudo su dispositivi reali restano da verificare. Revoca/erasure aggiornano il fence applicativo in D1 e impediscono subito accesso, indipendentemente dalla vita residua degli access token Kinde. Login, reset, signup e cambio password devono rispettare minimo 15 caratteri tramite workflow `NewPasswordProvided`, collaudato anche dopo reset. Google, emailVerified, guest→account, Safari/PWA, anti-replay, multi-tab/device e cancellazione account sono gate; audit dei test prima di ritirare i flussi Firebase.

Il candidato `acceptKindeCandidateInitialConsent()` raccoglie la decisione esplicita
(maggiore età, Termini e dati salute), invia solo il formato Server-D1 corrente
e richiede una successiva lettura autorevole di sessione e consenso con UID,
epoca e versioni legali esatte. Errori 409/503 o risposta persa non autorizzano
un retry automatico: si verifica lo stato primario senza considerare un 200
come consenso già provato. Consente la scelta esplicita anche mentre il guest
ha un archivio da migrare, ma non ne assume mai proprietà e non lo cancella.
Il componente non è ancora montato nella UX pubblica.

La nuova composizione candidata `deliverKindeCandidateJournal()` richiede una prova HTTPS
Kinde di sessione, prima accettazione, revisione e stato attivo, e una
verifica continua della generazione in memoria e del cookie CSRF casuale per
impedire A→B→A con lo stesso owner. Blocca una modalità guest ancora marcata
in storage. **Non** crea account, consenso o vault; la progressione del client
AuthContext/guest è ancora un gate distinto. Nessun dato pre-lancio da trasferire.

Il candidato browser `revokeKindeCandidateSession()` chiede al backend solo la revoca
della **sessione D1 corrente** con cookie host-only e token CSRF letto dal cookie
non-HttpOnly; non effettua logout SSO Kinde, purge IndexedDB, migrazione guest
o navigazione. La risposta HTTP 200 `signed-out` non basta da sola: serve
un nuovo status HTTP 401 con payload `unauthorized` validato. Se rete,
sessione, CSRF o generazione UI cambiano durante l'operazione, il client
mantiene la condizione indeterminata e il chiamante non può liberare il vault
o scartare il journal sulla sola promessa di logout. Il modulo resta
**non collegato** ad AuthContext fino al porting completo di identità,
consenso e recovery.

Kinde è responsabile delle email Auth; non sono previsti fornitori transazionali separati nel nuovo percorso. Per **cancellazione account** prima completare e provare revoca e cancellazione D1/chiavi, poi eliminare identità Kinde con ricevuta autorevole, senza dichiarare `complete` su timeout o errore. La revoca del solo consenso sanitario non elimina necessariamente l'identità Kinde. Nessuna Kinde console/configurazione è stata letta o attivata in questo incremento.

## Perimetro e contratti collegati

**MUST:** applicare il fresh start definito in `AGENTS.md`. Non è necessario recuperare account o backup pre-lancio e non si introducono nuovi percorsi per importare o migrare chiavi ownerless. Il purge di ogni account deve agire solo sull'archivio owner-scoped e sui marker tecnici/Auth con proprietà verificabile; i vecchi nomi business/IndexedDB globali non sono letti, attribuiti o cancellati. Restano obbligatori Web Locks e fence, verifica del journal, consenso, cancellazione server-complete, recupero da crash e protezione dei dati **della baseline corrente**. Nessun reset automatico di provider o storage di altri account.

Leggere [Consenso salute](health-consent.md) per primo consenso, offline, revoca/riaccettazione, export diritti e cancellazione dei soli dati; [Portabilità](backup-and-portability.md) per backup/import/CSV. Non assimilare questi percorsi alla cancellazione dell'account.

## Mappa delle transizioni di identità

| Transizione | Prova necessaria | Comportamento in caso di blocco |
|---|---|---|
| Registrazione → account verificato | Firebase Auth, email verificata e sessione corrente | Niente hydration account; dati guest e account separati |
| Guest → account | Scelta esplicita, origine dell'esito Auth, generazione guest e journal | Non attribuire dati guest al nuovo UID sulla sola notifica Auth; conservare l'intento |
| Logout ordinario | Owner e gate di persistenza/integrità | Non eliminare ciphertext o journal non verificati |
| Revoca di tutte le sessioni | Recent Auth, token non revocato, App Check e prova server | Esito ambiguo non è successo; niente purge forzato |
| Cancellazione account | Job trusted `complete`, lease e assenza dei residui | Conservare copie locali e ricevuta fino alla prova di completamento |
| Cancellazione dei soli dati salute | Revoca trusted, job sanitario `complete`, revisione e chiave verificate | Firebase Auth resta; niente purge anticipato ([Consenso salute](health-consent.md)) |

La tabella è un indice delle decisioni, non sostituisce i guard di transazione, i dettagli di recovery né i requisiti dei paragrafi seguenti.

## Verifica email e accesso account

L'accesso account/cloud richiede che Firebase Auth riporti `emailVerified === true`. Il bootstrap client di una sessione non verificata non deve avviare idratazione Firestore, replica, **registrazione automatica** del dispositivo né migrazione guest→account. L'endpoint trusted per la registrazione delle credenziali di recovery resta distinto dal bootstrap e accetta un Firebase ID token valido e non revocato anche senza email verificata: non abilita l'accesso fitness, richiede App Check limited-use e rifiuta qualsiasi registrazione dopo la creazione del job di cancellazione. Per gli account email/password, la registrazione richiede l'invio del link di verifica; alla conferma il client esegue `reload(user)` (con pochi ricontrolli limitati nel tempo se Firebase non espone ancora la verifica), aggiorna il token ID con `getIdToken(true)` e riprende il bootstrap tramite ricaricamento protetto. Il feedback distingue verifica pendente, conferma e risultato divenuto obsoleto per cambio di sessione. Un reinvio email conferma «inviata» soltanto dopo l'effettivo successo di `sendEmailVerification`, distinguendo l'indirizzo già verificato e la sessione cambiata; errori di lettura dell'owner/sessione impediscono l'azione e sono mostrati senza esporre dettagli tecnici.

**MUST:** il blocco UI precede tutte le schermate di dati account; le Security Rules richiedono `request.auth.token.email_verified == true` su root e collezioni private e non si affidano soltanto alla UI. Le letture pubbliche del catalogo restano accessibili senza account.

**MUST:** lasciare un account non verificato per usare la modalità locale esegue sign-out Firebase senza il purge dell'owner account; eventuali copie IndexedDB dell'account, progressi guest e intento di migrazione restano preservati. Prima di iniziare un nuovo guest, lo store in memoria non deve riciclare dati di un altro owner. La migrazione riprende soltanto dopo verifica e con scelta guest ancora valida o richiesta nuovamente se scaduta.

La verifica email dei singoli endpoint trusted segue [Consenso salute](health-consent.md) e [Configurazione Firebase](firebase-config.md): alcuni diritti restano disponibili anche senza claim email verificata, senza autorizzare accesso fitness.

Il collegamento email/password confermato da Identity Toolkit con il medesimo UID è distinto dal successivo `reload(user)`. Se il refresh locale fallisce, comunicare il collegamento già riuscito, ritirare il form di creazione password per quell’UID e usare soltanto il reload protetto; non invitare a ripetere la mutazione remota. Errori HTTP o risposte prive dell’UID atteso restano esiti non confermati.

**MUST:** le azioni account catturano la sessione prima delle attese SDK, recent-auth e password policy. Dopo un cambio Auth, incluso A→B→A, non inviano nuove mutazioni/redirect né mostrano feedback o avviano reload per il vecchio tentativo. Il link email ricontrolla la sessione dopo il token e prima di inviare credenziali a Identity Toolkit; un successo remoto già confermato rimane distinto da un refresh locale che non è più applicabile. Le risposte tardive di verifica email non aggiornano il gate o i messaggi della sessione successiva.

## Google redirect: proprietà della scheda e del tentativo

**MUST:** il marker Google `logbook_awaiting_redirect` vive esclusivamente nel `sessionStorage` della scheda che ha avviato il redirect: un'altra scheda non può leggerlo, eliminarlo o usarlo per un reload. Il risultato SDK del redirect resta l'unica prova Auth valida. Il purge dell'archivio non gestisce i marker Auth `true`/`failed`; il flusso Auth li riconcilia esclusivamente nella scheda d'origine. **MUST (tentativi successivi nella stessa scheda):** ogni nuovo fallback Google redirect assegna un ID casuale al proprio tentativo nel `sessionStorage` della stessa scheda prima di pubblicare il marker `true`.

Un callback SDK/errore più vecchio può rimuovere il marker o veto del redirect soltanto se il proprio ID coincide con quello corrente; il nuovo tentativo resta intatto anche se quello precedente termina in un ordine diverso. La rimozione riuscita pulisce sia marker sia ID; un errore storage non viene interpretato come assenza del marker. La prova Auth resta esclusivamente il `UserCredential` SDK e non il token locale. Non confondere il ritiro della compatibilità pre-lancio con il cleanup di un tentativo di login ancora valido.

## Scelta guest→account e provenienza Auth

**MUST (CRITICAL, scelta guest→account e ownership fra schede):** l'intento Auth condiviso è una prenotazione della generazione guest, non una prova che ciascuna scheda Firebase abbia avviato l'accesso. La creazione è serializzata dal Web Lock guest e da un Web Lock dedicato all'intento: una seconda scelta Google/email non può sovrascrivere un tentativo ancora attivo. L'ID casuale del tentativo deve corrispondere alla ricevuta `sessionStorage` della scheda initiatrice (persistente attraverso redirect/reload); una seconda istanza browser che abbia copiato la ricevuta non può consumare un intento già rivendicato dal realm originario.

Il bind usa il Web Lock dell'intento e verifica provider/email/UID, poi registra l'istanza che ne rivendica la migrazione. L'intero passaggio locale guest→account, incluso il recupero dopo crash che modifica la generazione guest, avviene sotto il Web Lock guest, in modo che una nuova scelta esplicita o un logout guest non possano intercalarsi al commit. Il cleanup Auth usa lo stesso lock dell'intento e ritira soltanto l'ID atteso; la migrazione già durabile riprende dall'envelope account owner-scoped senza inventare una seconda scelta.

Un retry *esplicito*, con Firebase UID e guest generation ricontrollati dentro il lock, può sostituire una prenotazione rimasta dopo un accesso interrotto; non modifica dati di altri account. In assenza di Web Locks o storage critico leggibile l'operazione fallisce chiusa preservando il guest; un login iniziato su un'altra scheda può mostrare un blocco finché la scheda originaria termina o l'utente richiede un retry esplicito.

Se, dopo l'attesa del lock, il guest risulta già ritirato, il bootstrap Auth corrente chiude il caricamento con errore recuperabile senza importare dati guest in memoria sotto l'account corrente; azzera solo il flag React obsoleto, non il journal o i record device. Il retry quando permane uno snapshot RAM di altro owner deve usare esclusivamente il reload barrier rigoroso, senza trattare la semplice replica del journal account come ripresa riuscita: in caso di copia non verificabile la PWA conserva i dati e resta bloccata. Un errore di acquisizione del lock deve lasciare la UI in stato di errore recuperabile, non in caricamento indefinito.

Nessun consenso cloud o controllo UI è sostituito dai marker Auth.

**MUST (CRITICAL, scadenza dei tentativi Auth concorrenti):** un callback di errore di login Google/email può ritirare soltanto l'intento di migrazione guest→account che **quel tentativo** ha creato, usando l'ID casuale persistito; se il login non era guest o l'intento è stato consumato/sostituito da un'altra scheda, non cancellare la chiave condivisa. Il fallimento del fallback redirect Google ritira il proprio tentativo solo quando il lancio è effettivamente fallito; un redirect avviato conserva la sua prova per il recovery. Un recovery di migrazione già persistita conosce l'UID dell'envelope ma non necessariamente l'ID dell'intento Auth originario: non può perciò cancellare indiscriminatamente un intento attivo. Questa verifica evita i cambi osservabili fra due tentativi; **non** fornisce CAS cross-tab durante il singolo read/remove e non autorizza l'importazione di una migrazione di altro account.

**MUST (CRITICAL, provenienza del risultato Auth):** una notifica `onAuthStateChanged` (anche con UID, email e provider identici) non dimostra che il tentativo avviato da questa scheda abbia ottenuto un risultato. Per un intento guest non di recovery, `bindGuestMigrationIntentToUser` può accettare solo una prova del `UserCredential` restituito dall'azione popup/email di questa esecuzione, oppure `getRedirectResult` confermato dalla propria ripresa Google. Tale prova non deve essere condivisa in `localStorage`: l'intento e la ricevuta `sessionStorage` sono prenotazioni, non attestazioni. Dopo reload/crash senza risultato Auth dimostrabile, o dopo mancata attestazione/timeout, conservare guest, journal e scelta prenotata; consentire il recovery esplicito con nuova scelta, senza migration automatica né purge. Per una registrazione email, l'invio del link di verifica non deve dipendere dalla riuscita dell'attestazione guest; il reload successivo richiede nuova conferma se la prova non è più presente in memoria. Il timeout non è prova di fallimento di Auth né autorizzazione distruttiva.

**MUST (CRITICAL, proprietà dell'intento guest→account):** `guest_migration_intent_v1` appartiene al ciclo di vita guest/Auth e può restare valido prima che esista un UID. Il purge di un account autenticato, anche dopo un crash o con un marker precedente, non può attribuirsi, inventariare come cancellabile o eliminare tale intento; il reset del guest conserva invece la responsabilità della relativa pulizia, insieme alla gestione esplicita nel flusso Auth. Le impronte persistite per vecchie cancellazioni restano compatibili, ma la posizione di questa chiave è ignorata nel purge di account: un hash storico non è prova di proprietà.

**MUST:** la prova di ripresa guest→account è owner-scoped nella chiave `logbook:v2:user:${uid}:guest-migration-sync-recovery`, con UID, generazione guest originaria e ID casuale della specifica migrazione verificati nel valore. Il recupero che ritira `logbook_is_guest` è serializzato dal Web Lock guest e può ritirare soltanto la generazione attestata dalla prova: se è comparsa una nuova generazione, preserva il marker e si blocca. Ogni cleanup del marker sotto lo stesso lock deve presentare l'ID esatto letto prima di attese asincrone: un retry obsoleto dello stesso UID non elimina una nuova prova. La pulizia di un owner può eliminare soltanto la propria chiave, mai la prova di un altro account.

## Avvio guest e ripresa della migrazione

La modalità guest ha archivio e workout separati dagli utenti. La migrazione conserva la copia guest e registra il risultato locale prima della replica. Le callback vecchie sono invalidate tramite owner ed epoch.

**MUST (CRITICAL):** dopo l'attesa di `ensureLocalVaultReady('guest')`, l'accesso guest deve verificare che la generazione esattamente attivata sia ancora quella corrente e che il vault sia effettivamente sbloccato. La cancellazione della readiness può risolvere la Promise senza sbloccare il vault; ciò non autorizza `setIsGuest`, `setUserData` o altri dati in memoria. Riesaminare sessione/epoch anche dopo l'attesa del catalogo e prima di pubblicare **sia** la modalità guest (`isGuestRef`/`setIsGuest`) **sia** `UserData` o copie di recupero. Un accesso guest obsoleto termina senza modificare il nuovo owner.

**MUST:** anche con policy `skip` (nessun trasferimento dell'archivio guest), oppure senza dati guest da fondere, un journal già pendente dell'account autenticato deve essere rigiocato o dichiarato `local-pending`/fallito secondo l'esito durevole; la hydration da sola non prova un ACK cloud. La copia guest resta separata e invariata.

**MUST (CRITICAL):** durante il recovery di una migrazione guest→account già durevole, pubblicare l'envelope autenticato nello stato UI soltanto dopo il controllo dell'owner/sessione e senza attraversare `setUserData()` o altri writer di modifica business. Un vecchio snapshot guest in memoria non è la baseline del nuovo account. I journal e le copie device-critical di entrambi gli owner devono rimanere protetti; il ripristino dell'allenamento autenticato usa il recovery owner-scoped canonico.

## Revoca globale delle sessioni

«Disconnetti tutti i dispositivi» è un'azione distinta dal logout ordinario. Richiede conferma dell'utente, autenticazione Firebase recente, token ID verificato con revocation check e App Check limited-use consumato. Il backend determina l'UID dal token validato, non da un input client, e revoca i refresh token tramite Firebase Admin.

**MUST:** il backend registra prima della revoca il limite temporale monotono `session_revocations/{uid}.revokedAfterSeconds`. Dopo la revoca lo aggiorna con il timestamp autorevole Firebase. Firestore Rules negano l'accesso ai documenti privati se `auth_time <= revokedAfterSeconds`, anche con un ID token ancora formalmente valido; il record è server-only e un record malformato blocca l'accesso. Una ripetizione dell'operazione non può arretrare il limite.

**MUST:** una risposta incompleta o un errore non equivale a successo; un limite già scritto non deve essere rimosso dopo un fallimento. La cancellazione account impedisce la creazione concorrente di nuovi marker, li elimina sotto transazione e ne verifica l'assenza prima di rimuovere Firebase Auth. Il client non avvia la revoca se riscontra modifiche locali non sincronizzate o condizioni che rendono insicura la pulizia del vault; dopo una revoca confermata usa il logout ordinario protetto, senza purge forzato.

**LIMITAZIONE:** la revoca blocca l'accesso cloud alle sessioni precedenti ma non elimina i dati già conservati su dispositivi offline né ne impedisce l'uso locale finché restano offline. Nessuna interfaccia deve promettere una cancellazione remota dei dati locali. Il controllo del consenso sanitario resta un requisito indipendente.

## Eliminazione account

**MUST:** quando Firebase Auth è attivo ma la migrazione guest→account è differita fino al primo consenso, l'owner locale può restare `guest`. «Esci dall'account» deve soltanto eseguire il sign-out Firebase, preservando l'archivio guest. «Elimina account» deve avviare il job backend per l'UID autenticato senza toccare i dati ospite; ricevuta e cleanup dell'archivio account restano pendenti finché un'altra identità locale è attiva. Il callback Auth null aggiorna sempre `currentUser` a null.

`useSettingsAccountActions` (esposto tramite `useSettings`) chiede due conferme e riautentica Google prima di invocare `DB.deleteAccount`, passando esplicitamente gli adapter applicativi per congelare i writer e resettare lo store. Il boundary infrastrutturale `db_account.ts` non importa Zustand: riceve queste operazioni tramite context injection. Il client controlla il token aggiornato prima di congelare i writer; il backend trusted verifica nuovamente ID token, revoca e `auth_time` recente e richiede App Check prima di accettare il job.

La cancellazione autenticata è coordinata dal backend Vercel nativo e dal job amministrativo `account_deletions/{uid}`. La collection dei job è server-only: i client non possono leggerla o mutarla. La presenza del job è anche una barriera Firestore globale: le Rules negano accesso al root utente e alle raccolte private da qualunque client autenticato con quell'UID, impedendo ad altri dispositivi o client vecchi di ricreare dati mentre il server cancella.

Il registro **locale** delle credenziali di recupero conserva al massimo quattro nuovi account per profilo browser. Se è pieno, una nuova registrazione segnala un errore esplicito senza sostituire una prova di recupero di un altro account; la lettura e la rimozione di record validi ereditati da un formato precedente non devono troncare le altre prove. La creazione della prova è serializzata nello stesso contesto e usa Web Locks tra schede quando disponibili; la ripetizione della registrazione per un UID esistente deve riutilizzare la prova già persistita. La serializzazione non fornisce atomicità tra schede nei browser privi di Web Locks. È un limite distinto da quello **server-side per UID** e non garantisce il recupero su dispositivi non registrati. Un eventuale aumento del limite locale richiede una decisione separata con verifiche sul lifecycle.

`account_deletion_devices/{uid}` è un registro server-only bounded: conserva al massimo 12 hash SHA-256 di credenziali device, mai i token raw. La registrazione richiede sessione Firebase valida/non revocata e App Check limited-use consumato, ma non recent-auth perché non avvia operazioni distruttive; recent-auth resta obbligatoria per la cancellazione. **MUST (concorrenza):** la registrazione legge `account_deletions/{uid}` nella stessa transazione Firestore del registro device e rifiuta la registrazione (HTTP 409) se il job esiste, anche se la richiesta era stata autenticata prima dell'avvio della cancellazione. Non aggiungere, sostituire o rinnovare credenziali dopo l'inizio del job; quelle già registrate restano valide per il polling di recovery fino al retirement del tombstone.
Una registrazione riuscita rende la credenziale la più recente; se il registro è pieno, una nuova credenziale sostituisce quella meno recentemente registrata invece di bloccare permanentemente il device. Il registro abilita il recovery locale dopo la rimozione di Firebase Auth e viene eliminato insieme al tombstone scaduto.
Il client considera la registrazione riuscita soltanto dopo HTTP 200 e risposta JSON valida con `registered: true`, letta entro la stessa deadline complessiva di 7,5 secondi; risposte mancanti, false o corrotte mantengono la credenziale locale e abilitano nuovi tentativi.
**MUST:** quando esistono credenziali device salvate e il client risulta online, l'assenza dell'origin del backend trusted è un errore di configurazione esplicito, non un esito `none` né una verifica riuscita. Non fare richieste verso un host implicito; conservare integralmente credenziali e copie locali e mostrare l'impossibilità di verificare. Senza credenziali non inventare un job pendente. Offline non dedurre una cancellazione dal mancato controllo.

**Diagnostica recovery:** le verifiche periodiche di credenziali device, la loro registrazione e la riconciliazione di marker di cancellazione restano operazioni distinte. I timeout e gli errori transitori di routine non attestano una cancellazione e vengono segnalati solo se ripetuti (terzo fallimento consecutivo e poi ogni decimo, con reset dopo un controllo riuscito).
Le violazioni di integrità, gli stati cloud `failed` e i fallimenti di pulizia locale successivi a prova `complete` restano immediatamente visibili. L'osservatore locale riceve soltanto un riepilogo testuale con operazione, fase, categoria, stato HTTP e conteggio, mai eccezioni grezze, stack, UID o credenziali; non esiste un trasporto diagnostico esterno. Il throttling diagnostico non modifica timeout, marker, retry e protezioni del recupero.

Flusso normativo:

1. Il client attende journal e scritture Firestore già pendenti, ottiene App Check, crea una receipt casuale da 256 bit e la salva nel marker locale persistente prima della richiesta. La receipt in chiaro resta sul dispositivo; il server salva solo SHA-256.

2. `POST /api/account-deletion` verifica Firebase ID token, UID derivato esclusivamente dal token, revoca, autenticazione recente e App Check; crea o aggiorna idempotentemente il job e avvia subito il cleanup nella stessa invocazione.

3. Il job revoca i refresh token e acquisisce un lease breve. POST, polling GET e cron possono tentare recovery, ma un solo worker per UID esegue operazioni distruttive alla volta, considerando **anche** il job separato di cancellazione dei dati sanitari. L'acquisizione del lease account aspetta che un job sanitario sia `complete` oppure `failed` non recuperabile: i due lease indipendenti non possono operare contemporaneamente sulle stesse raccolte. Un lease scaduto è riprendibile.

4. Il server elimina pagine da massimo 400 documenti dalle tre raccolte private correnti: `history_months`, `nutrition_months`, `sync_control`. Dopo ogni batch il retry riparte dalla prima pagina; il cursor è telemetria/progresso e non è una dipendenza di correttezza.

5. Se il budget della Function si avvicina al limite, il job salva uno stato riprendibile e termina senza dichiarare successo. `GET /api/account-deletion` può far avanzare un job incompleto durante il polling. Il cron giornaliero `/api/account-deletion-cron` è soltanto una rete di sicurezza per job rimasti incompleti.

6. Dopo le raccolte note il server elimina `/users/{uid}` e i marker amministrativi (incluso `health_consent_withdrawals/{uid}`) nella stessa transazione protetta dal lease, **conservando temporaneamente `user_data_keys/{uid}`**. Verifica quindi che non restino root, raccolte private (anche inattese) o marker amministrativi; solo dopo una verifica riuscita ritira la chiave sotto il lease e ripete la verifica completa. Un errore prima del ritiro preserva la chiave, così i dati cifrati eventualmente residui non diventano irrecuperabili. Solo dopo la verifica finale elimina Firebase Auth; `auth/user-not-found` in un retry è successo idempotente.

7. Il client elimina la copia locale e la receipt solo dopo stato server `complete`. Se Auth è già sparita, bootstrap e `AccountDeletionRecovery` preservano l'envelope dell'owner e interrogano lo stato tramite UID + receipt + App Check senza richiedere un ID token ancora valido.

8. Quando il job diventa `complete`, il server assegna `purgeAfter` a 30 giorni dal completamento. Il cron giornaliero dà priorità ai job ancora recuperabili e usa soltanto il budget residuo per eliminare i tombstone `complete` scaduti. Il record tecnico di recovery non contiene i dati fitness/nutrizione cancellati; conserva l'identificativo tecnico del job, stato/timestamp e hash della receipt necessari alla riconciliazione.

**MUST:** Firebase Auth è sempre l'ultima risorsa cloud eliminata. Un errore di query, batch, verifica, backend o stato non autorizza il purge locale né una dichiarazione di successo.

**Controllo provider Firebase Auth (stato desiderato, NON applicato dal repository):** in Authentication → Impostazioni → Azioni utente, mantenere **Abilita creazione** attiva e disabilitare soltanto **Abilita eliminazione**. Firebase rifiuta così la cancellazione self-service tramite SDK client o REST con `auth/admin-restricted-operation`; il backend trusted conserva la capacità amministrativa `adminAuth().deleteUser(uid)` grazie all'Admin SDK. Il blocco provider è necessario anche quando la PWA non chiama `deleteUser`: un client modificato potrebbe farlo finché l'opzione è abilitata. Non ripristinare l'import/export del metodo client in `src/lib/firebase.ts` né introdurre endpoint `accounts:delete` nella PWA. **VERIFY-LIVE:** la policy non è impostata dalla CI e il suo stato effettivo va letto nella console; il percorso di cancellazione completo e il rifiuto self-service devono essere collaudati su identità di prova autorizzate prima di attestare la protezione end-to-end. Il cambio non deve disabilitare registrazione, sign-in, recovery o la cancellazione dei soli dati sanitari, che lascia intatta Firebase Auth.

### Recovery, marker e confini applicativi

**MUST:** Un job `failed` deve comunicare che la cancellazione cloud può essere parziale. I batch già riusciti non sono reversibili. Errori transient/retryable possono essere ripresi idempotentemente; residui inattesi o violazioni fail-closed non devono entrare in un retry distruttivo automatico senza nuova valutazione.

**MUST:** Il marker locale sospende replica, logout distruttivi e reset locali ordinari finché la receipt non è riconciliata. Il boundary di purge deve applicare la protezione anche quando viene chiamato direttamente; solo la finalizzazione con prova server `complete` può usare il percorso di purge dedicato. Offline o con endpoint non raggiungibile, la copia locale resta conservata e il marker continua a bloccare i writer.

**MUST:** Un HTTP 400/401/403 su un nuovo POST non dimostra che un precedente POST con receipt già persistita non sia stato accettato: sui retry preservare marker e receipt. Ogni tentativo di recovery (inclusi provider di token e parsing del body) deve avere una deadline complessiva e non deve proseguire con side effect quando scaduta. La riconciliazione deve considerare tutti gli owner indipendentemente, senza far bloccare un marker valido da un altro in errore o corrotto.

**MUST:** Il boundary `src/lib/db/db_account.ts` resta indipendente dallo store Zustand. Le operazioni applicative `cancelPendingSyncs` e `resetStore` vengono iniettate dai chiamanti/orchestratori; non reintrodurre un import inverso dal layer DB verso `useAppStore`.

**MUST:** La retention del tombstone server non autorizza mai un purge locale per inferenza. Se un dispositivo torna online dopo che il tombstone `complete` è già scaduto e il server non può più provare lo stato, la copia locale resta conservata fail-safe e richiede gestione esplicita invece di essere eliminata alla cieca.

**MUST:** Le credenziali Firebase Admin e `CRON_SECRET` sono server-only, mai `VITE_*`, mai committate. `service-account.json` resta ignorato e non deve entrare nel repository.

Le Functions native account deletion mantengono `maxDuration = 300`; le richieste interattive POST/GET usano budget riprendibili di 5 secondi e un headroom runner dedicato inferiore al budget interattivo, mentre i percorsi background mantengono un margine più conservativo. Il client applica un timeout HTTP bounded, conservando receipt e copia locale in caso di risposta incerta.
Il cron giornaliero è recovery, non il percorso primario. **MUST:** il budget interattivo e il relativo headroom devono restare definiti da un contratto condiviso e testato insieme: il runner non può considerare esaurito un budget POST/GET appena creato. **VERIFY:** piano Vercel effettivo, limiti commerciali e configurazione runtime sono esterni al repository e non vanno assunti senza verifica.
Non introdurre Nitro, Workflow, `waitUntil` come sostituto di durability, o una migrazione di piattaforma/backend senza un nuovo piano esplicito.

### Cron, fairness e retention

**MUST:** il cron seleziona i job recuperabili in ordine persistente server-side per evitare starvation oltre il limite di pagina; le query ordinate dipendono dagli indici `account_deletions(status, updatedAt)` e `account_deletions(status, retryable, updatedAt)` che devono essere `READY` prima della distribuzione del backend.

**MUST:** il purge di un tombstone scaduto e del corrispondente registro delle credenziali device usa una singola transazione Firestore; un errore non può eliminare solo uno dei due record. Le fasi indipendenti del cron devono proseguire se una query o una manutenzione fallisce, conservando un unico riepilogo aggregato, identico nei log e nella risposta JSON, privo di UID e credenziali. Per la cancellazione account, i worker che restituiscono `failed` sono conteggiati separatamente dalle eccezioni lanciate; `processed` indica tentativi, non il numero di cancellazioni completate.

**MUST:** il cron mantiene un budget limitato e un margine di sicurezza per job di cancellazione account, erasure sanitaria e retention delle ricevute, senza interrompere deliberatamente una transazione Firestore in corso. Anche lo scheduler dell'inattività, se abilitato, riceve il limite temporale per avviare nuove query/transazioni e conserva il cursore già verificato nel margine riservato; non può consumare senza controllo tutto il tempo residuo del cron.

## Logout e pulizia locale

Il logout autenticato ordinario deve verificare il journal IndexedDB durabile, non solo lo stato di sincronizzazione in memoria. Una generazione di consenso positiva, canonica e rappresentabile come intero sicuro non è di per sé una transizione pendente; revisioni malformate, richieste di consenso non riconciliate e journal appartenenti a una generazione precedente devono invece bloccare il purge, anche dopo una scelta di uscita forzata. Il preflight finale avviene sotto Web Lock di owner: prima si consolidano le bozze correnti, poi si verifica che il journal non abbia pending, si persiste il purge fence e soltanto allora si invalida Firebase Auth.
I writer di altre schede devono rifiutare la fence. Un sign-out fallito prima della prima cancellazione revoca soltanto la nuova fence; una cancellazione incompleta la conserva per il recovery. Il percorso esplicitamente distruttivo del dialogo può scartare pending dopo scelta consapevole, ma deve preservare gli altri gate di consenso e cancellazione account.


`secureLogOut` propaga un errore di `auth.signOut` e conserva il locale. **Prima di invalidare Firebase Auth**, il logout autenticato rifiuta intenti di revoca/riaccettazione salute non ancora riconciliati, journal non inviati dopo una revoca confermata e journal di una generazione di consenso precedente ancora da recuperare.
Il purge ordinario ripete queste verifiche, anche se chiamato direttamente; un errore di lettura del marker o dell'envelope non autorizza la cancellazione. Dopo sign-out riuscito, purga l'archivio dell'owner catturato prima del logout. Gli archivi owner-scoped degli altri utenti restano separati.
L'eliminazione volontaria dell'account ha un boundary di finalizzazione separato, autorizzato solo dal completamento verificato del server.

`purgeAllLocalUserData` tenta ogni rimozione e rigetta con un errore aggregato se alcune falliscono: la UI comunica la pulizia incompleta. Durante una cancellazione server la receipt viene esclusa dal purge ordinario e rimossa solo dopo il successo di tutte le altre operazioni locali.

**MUST:** Non eliminare la cache del service worker durante logout: contiene gli asset necessari all'avvio offline.

### Purge locale e cambio identità

**MUST:** la finalizzazione locale di una cancellazione account completa deve ricontrollare, sotto il lock dell'owner, che non sia diventato attivo un altro account o una sessione ospite. Anche il retry di un purge già fenced deve rispettare il controllo prima di eliminare chiavi locali condivise; il server-complete resta prova distinta da questa barriera locale.

**MUST:** anche il recovery generico di un purge interrotto verifica sotto il Web Lock l'identità corrente Firebase, il marker dell'owner autenticato e l'eventuale nuova generazione guest prima di procedere; un'altra identità attiva lascia intatti i dati e conserva il fence incompleto. Il controllo ordinario non può essere saltato chiamando direttamente il boundary generico con un fence già presente. **MUST:** dopo ogni `await` che può precedere l'eliminazione di chiavi condivise, la pulizia deve ricontrollare l'identità.

L'envelope owner-scoped viene eliminato e verificato separatamente prima della chiave crittografica; chiavi business globali pre-lancio non partecipano alla pulizia. Un cambio sessione conserva il fence incompleto, impedisce l'ulteriore pulizia delle copie condivise e non viene trattato come un completamento riuscito.

**MUST:** la pulizia non adotta record pre-lancio senza owner e conserva il controllo d'identità fra attese asincrone; per le chiavi del proprio owner, gli indici di storage modificati durante la scansione devono essere rilevati prima di eliminare la chiave crittografica. Web Locks non costituisce CAS fra schede.

### Chiave locale automatica e purge

Il vault cifrato dell'owner è apribile automaticamente dopo il gate d'identità Firebase o la generazione guest; non richiede un secondo segreto. **MUST:** `purgeOwnerLocalData` elimina tutti i dati cifrati IndexedDB e device-critical prima di rimuovere la wrapping key IndexedDB; una rimozione parziale non autorizza perdita di chiavi se rimangono byte recuperabili. L'inventario delle chiavi `localStorage` deve rilevare indici mancanti/duplicati e insiemi modificati tra letture successive, anche per variazioni di chiavi non appartenenti all'owner: una scansione instabile blocca la rimozione della chiave, conserva il purge fence e consente retry. Il doppio inventario non rende atomiche le modifiche tra schede e non protegge da gare invisibili dopo la verifica. In caso di cancellazione account, il percorso receipt-based con stato server `complete` può effettuare la pulizia ciphertext senza aprire il vault.

Se il key store non è disponibile ma esiste ciphertext, non generare una nuova chiave per sovrascriverlo. Preservare le evidenze e offrire retry/recupero non distruttivo. La chiave di dispositivo in IndexedDB non impedisce a un attaccante con copia integrale del profilo browser di tentare la decifratura: non descriverla come E2EE.

## Aggiornamenti PWA

Il contratto completo è in [Storage e sync](storage-and-sync.md): flush, attivazione Service Worker e seconda barriera prima della navigazione. I controlli di questa regola su owner, consenso, logout e purge si applicano anche durante un update.

## Evidenze e fonti

Fonti principali: `src/contexts/AuthContext.tsx` e `src/contexts/auth/` orchestrano il lifecycle; `src/lib/auth/` gestisce provenienza e marker; `src/lib/db/db_account.ts` e `src/lib/db/ownerLocalPurge.ts` sono boundary infrastrutturali; `server/accountDeletion/` e gli endpoint `api/account-deletion*` gestiscono il job trusted.

I test devono attraversare questi boundary secondo [Verification hardening](verification-hardening.md), con il gate [CI](ci-verification.md). Le configurazioni live sono prove separate.

## CF-03 — confine browser Kinde preparato, non attivato

Il candidato `src/lib/auth/kindeCandidateClient.ts` fornisce un lettore **solo consultivo** di sessione e consenso Workers/D1, senza importare Firebase, modificare storage o abilitare la sincronizzazione. La lettura segue `POST /api/auth/session` → `POST /v1/consent/status` → nuovo controllo `POST /api/auth/session`, sempre con cookie host-only e policy HTTP same-origin/no-store; dati, revisioni ed epoch incongruenti sono errore, **non** logout/guest implicito. Il chiamante deve fornire un guard per la generazione corrente e non può usare un risultato `consent-confirmed` come prova di disponibilità ADK, vault, sync o ACK. Il consenso guest non si eredita dall'account.

Per avviare Authorization Code + PKCE è predisposta una navigazione HTML nativa `POST /api/auth/kinde/start` senza campi, segreti né parametri client; il Worker candidato accetta soltanto un body effettivamente vuoto (anche se rappresentato da stream), non campi aggiunti o Content-Length ingannevole. Il redirect 303 cross-origin **non** va recuperato via fetch. Il modulo non viene richiamato dall'attuale `AuthProvider` Firebase o dal login UI: mancano ancora onboarding Kinde live, guest→account fencing, chiavi/consenso client e gate di attivazione sicuri. Nessuna route pubblica è stata abilitata. Dettagli nel [runbook Cloudflare](../../docs/operations/cloudflare-workers-migration.md).

### Dipendenza di sicurezza temporanea del candidato Kinde (18/11/2026)

Il backport `picomatch` della PR #1209 è limitato al tooling e non
modifica il contratto Auth, consenso, chiavi o erasure. Il monitor
giornaliero produce solo una issue al rilascio ufficiale verificato;
non autorizza upgrade automatici, cambi OAuth, deploy o rimozione
delle protezioni sui dati. La CI verde sulle dipendenze non costituisce
GO funzionale Kinde/Workers né prova la completa rimozione Firebase.

### Deadline del body delle risposte Kinde (18/11/2026)

La verifica della sessione Kinde limita separatamente il tempo di
consumo del body JSON, oltre ai byte e al numero di chunk. Un HTTP
200 che invia solo una risposta incompleta e poi si blocca non puo'
impedire indefinitamente il controllo dell'identita': la lettura
termina in errore fail-closed, non crea alcun owner o consenso.
Il controllo non allarga le route pubbliche e non emette ACK cloud.

### Logout guest indipendente dal provider (18/11/2026)

La chiusura della modalita' locale e' nel modulo
`src/contexts/auth/logoutActiveGuestSession.ts`, richiamato
dall'AuthProvider attuale. La procedura non importa Firebase:
l'identita' guest resta provata dalla generazione corrente,
si richiede conferma di cancellazione e il Web Lock protegge
revoca, pulizia e reset. Il chiamante fornisce soltanto
`purgeGuest`, che deve conservare l'ordinamento ciphertext →
key e la semantica fail-closed dell'archivio. Nessun vecchio
account, cookie Kinde, UID o consenso account puo' autorizzare
la cancellazione guest. Una nuova generazione nel frattempo
annulla l'operazione precedente senza eliminare dati.

### Protezione cancellazione locale indipendente da Firebase (18/11/2026)

Il guard di purge `src/lib/db/ownerPurgeIdentityFence.ts` legge la
sorgente di identita' autenticata condivisa dal runtime, non
`firebase.auth.currentUser`. Nel vecchio provider la sorgente e'
gia' registrata da Firebase; un futuro provider Kinde vi potra'
subentrare soltanto dopo aver rimosso quello precedente ed aver
verificato la sessione. Un owner hint conserva il proprio ruolo
di **fence conservativo**, mai di prova Auth. Ogni cancellazione
rilegge UID e storage sotto il lock: una identita' concorrente,
storage non leggibile o provider corrotto interrompono il purge.
Il gate non cambia l'ordine ciphertext → device key.

## CF-05 — UI candidata per la copia prima della revoca (19/11/2026)

`KindeCandidateBackupPanel` e
`useKindeAccountSession.prepareCandidateBackup()` sono disponibili
soltanto nell'entrypoint Kinde **candidato esplicitamente abilitato**
(`identityOnly:false`, modalità `candidateMode` esplicita), dopo
identità email verificata e consenso `consent-confirmed`. Il provider
montato da `main.tsx` mantiene `identityOnly:true` e
`candidatePreparationEnabled:false`: la UI non viene esposta agli
account pubblici e non attiva il fitness.

L'azione non crea né migra un vault: richiede l'archivio device
già `active` e lo apre con un grant temporaneo owner-scoped, che
viene rilasciato in `finally` senza interferire con aperture
successive. Sessione, cookie CSRF, UID/epoch/consenso e marker locali
negativi restano controllati lungo la scansione Kinde/D1. Il file
`logbook-backup` Schema 3 è disponibile come link di download
**solo dopo** verifica completa e creazione esplicita del Blob URL,
separata dal click sincrono del browser (Safari incluso). Cambio
sessione, revoca/erasure locale o smontaggio della UI causano rifiuto
del click o rilascio dell'URL, non un successo implicito.

La UI spiega che il JSON contiene dati sanitari leggibili, permette
di scartare il file temporaneo e non interpreta il click come copia
effettivamente salvata. La revoca del consenso e il percorso rights-only
post-revoca NON sono montati in questo incremento. L'eventuale
attivazione runtime richiede verifica del lifecycle completo,
consenso, rights/erasure, browser/provider e KEK indipendente.
