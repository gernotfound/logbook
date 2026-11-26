# Integrazioni Kinde nel client — candidati CF-03/04/05

**Quando leggere:** accesso e composizione React Kinde, editor fitness candidato, journal cloud, guest boundary, UI diritti e backup.

**Non inferire:** una feature implementata in codice candidato non equivale a montaggio nel frontend pubblico o autorizzazione fitness.

**Autorità:** [Ciclo account](account-lifecycle.md) e [`AGENTS.md`](../../AGENTS.md); verificare [stato Cloudflare](../../docs/operations/cloudflare-current-state.md).

## Integrazioni candidate e checkpoint datati

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
