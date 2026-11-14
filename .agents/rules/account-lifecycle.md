# Ciclo account, Auth e guest — TheLogBook

**Quando leggere:** email verificata, accesso guest→account, sessioni, account deletion, logout e purge.
**Non inferire:** Auth assente, timeout o tombstone scaduto non provano cancellazione completa né autorizzano purge locale.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Target Kinde selezionato — 14/11/2026 (non ancora attivo)

Kinde è il provider di identità per la **nuova baseline fresh start**. Lo stack legacy Firebase descritto nelle sezioni successive documenta ancora il runtime attuale e i suoi invarianti, **non** impone di usare Firebase dopo il cutover. Nessun dato/credenziale/UID vecchio viene migrato. Il backend Worker verifica token Kinde con RS256/JWKS, `iss` e `aud` esatti, `azp` per il solo client autorizzato e scadenze brevi; un token valido **non** costituisce da solo prova di email verificata, consenso salute, o autorizzazione D1. L'identità Kinde (`iss` + `sub`) deve essere associata all'owner interno senza collisioni e verificata tramite flusso trusted prima che `session-issuer.mjs` crei una sessione. Nessun endpoint pubblico può emettere sessioni con UID forniti dal chiamante. Il candidato interno `cloudflare/auth/kinde-principal-provisioner.mjs` deriva un owner ID `k_` dal digest SHA-256 separato per dominio di `issuer + subject` **solo dopo** verifica OIDC con email verificata e nonce dal callback trusted. Il primo insert in D1 è idempotente e una read primaria valida lo stato; login successivi non riattivano owner disabled/deleted e non reimpostano `auth_epoch`. La derivazione non è una chiave cifrante né una prova di sessione. Il candidato HTTP `kinde-oauth-flow.mjs` già consuma state e PKCE monouso, verifica nonce e token firmati e crea la sessione D1; `kinde-http-worker.mjs` non è collegato al frontend o pubblicato. Il percorso con il provider Kinde reale, la gestione completa di revoca/email cambiata e il login browser restano da implementare o verificare. Revoca/erasure aggiornano il fence applicativo in D1 e impediscono subito accesso, indipendentemente dalla vita residua degli access token Kinde. Login, reset, signup e cambio password devono rispettare minimo 15 caratteri tramite workflow `NewPasswordProvided`, collaudato anche dopo reset. Google, emailVerified, guest→account, Safari/PWA, anti-replay, multi-tab/device e cancellazione account sono gate; audit dei test prima di ritirare i flussi Firebase.

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
