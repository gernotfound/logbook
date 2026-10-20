# Ciclo di vita account — TheLogBook

**Quando leggere:** backup/import/export, email verificata, consenso, logout, cancellazione e recovery.
**Non inferire:** Auth assente, timeout o tombstone scaduto non dimostrano un job server completato né autorizzano purge locale.

> Stato: normativo | Ricognizione originaria: 2026-09-20; rivalidare all'HEAD attuale

## Backup JSON e importazione

**MUST (CRITICAL, backup di recupero con UI bloccata):** quando il consenso è attivo ma una copia device-local di workout non è attribuibile con certezza alla revisione corrente e impedisce la hydration, l'esportazione esplicita dei dati locali deve rimanere accessibile. Il backup è solo device-only, marcato parziale e deve richiedere conferma informata, senza tentare flush, reimport automatico o abilitazione della replica. Deve includere anche i witness immutabili `workout-intent:<id>` e `history-editor-context` validi per nome nello spazio owner-scoped, come prove originali grezze non automaticamente riproducibili. Nessun backup locale sintetico se mancano sia envelope sia record di recupero; se un record esiste ma scompare durante la lettura, rifiutare la copia vuota. La revoca del consenso conserva invece il percorso separato di esportazione diritti via backend trusted, quando applicabile. I file JSON di backup sono in chiaro: l'utente deve custodirli in modo riservato.


`src/lib/backup.ts` usa il formato corrente `logbook-backup` **Backup Schema 3**, con owner, data di esportazione, copertura, `UserData`, versioni data/sync e recovery locale. `src/lib/db/backupSnapshot.ts` legge il root e tutte le pagine mensili di storico/nutrizione dal server, normalizza i documenti cloud, poi rilegge l'envelope locale più recente e riapplica le pending operation quando presenti. Gli originali cloud e il registro locale sono inclusi nella sezione recovery prevista dal formato corrente.

L'esame in sola lettura delle testimonianze `draft:buffered-intent:*` e `draft:dated-intent:*` del dispositivo è disponibile solo su azione esplicita, con consenso e sessione corrente. Mostra le copie ma non recupera valori nel business state, non ripristina bozze da backup, non elimina gli originali e non sostituisce l'esportazione JSON.\n\nIl backup completo rifiuta documenti mancanti o causalmente obsoleti rispetto alla copia locale, o una barriera cloud ancora attiva. Resta disponibile l'esportazione limitata al dispositivo. **MUST:** se il recupero cloud fallisce e non esistono né un envelope locale leggibile né dati validi già presenti nello stato dell'owner corrente, la UI NON deve fabbricare un backup device-only usando valori predefiniti vuoti. Deve segnalare l'assenza di una fonte locale, mantenendo invece possibile l'esportazione rights/cloud riuscita anche in assenza dell'envelope locale.

La lettura di tutti i documenti non costituisce uno snapshot atomico fra dispositivi. Il file registra la propria copertura; con modifiche concorrenti può essere necessario ripetere l'esportazione. Un errore di rete non deve produrre un backup dichiarato completo se la copertura richiesta non è stata acquisita.

**MUST (CRITICAL, coerenza delle prove device in Backup JSON):** l'elenco fisico delle chiavi owner-scoped `workout`, `timer`, `history-editor-context`, `draft:*` e `workout-intent:<id>` va acquisito prima di leggere le copie. Un secondo elenco deve corrispondere all'insieme originale e ogni contenuto decifrato/validato deve risultare invariato a una seconda lettura. Una chiave scomparsa, aggiunta, ambigua o cambiata durante il backup invalida l'intera esportazione e richiede retry, senza generare un file apparentemente completo né modificare le copie. Questa verifica individua gare osservabili tra schede, **non** è una transazione atomica di `localStorage` e non prova assenza di interleaving invisibili (ABA). Non escludere mai prove indipendenti per mascherare i conflitti.

L'importazione JSON utilizza una lettura semplice fino a 64 MiB e un **parser JSON incrementale** sopra tale soglia: 64 MiB è la soglia di scelta del percorso, **non** un limite alla dimensione recuperabile. Il parser legge blocchi da 256 KiB e non materializza una seconda stringa con l'intero contenuto del file. Mantiene gli stessi controlli di schema, owner e validazione prima della conferma e del salvataggio. I dati decodificati, le normalizzazioni e la preparazione del merge richiedono ancora memoria proporzionale all'archivio: su dispositivi con poca RAM non è garantito il ripristino di qualunque dimensione. Errori di lettura/parsing o cambio sessione non devono modificare i dati. Non cambia Backup Schema 3 e non tronca il backup. Il CSV è un export analitico, non un backup ripristinabile. La replica Firestore non è un backup versionato indipendente: cancellazione account, browser storage cancellato o chiave locale perduta possono rendere irrecuperabili le copie disponibili. Una copia JSON esplicita, protetta e verificata dall'utente resta necessaria per il recupero esterno.

La baseline clean-cut corrente **non importa Backup Schema V1/V2**: `decodeImport()` li rifiuta tramite `LegacyVersionError`. Anche versioni future sconosciute falliscono chiuso e richiedono aggiornamento. Non esiste più un percorso prodotto che legga, preservi o esporti la vecchia cache locale non attribuita `logbook_cached_user_data`: il compatibility layer fu rimosso nella baseline pre-lancio. La motivazione è storica, non certifica l'assenza odierna di utenti o copie locali e non autorizza ulteriori rimozioni senza verifica.

- **Importa JSON:** opera soltanto su formati supportati e applica l'unione prevista senza mutazioni in place. Un `activeWorkout` non nullo ma invalido nel backup blocca l'importazione con un errore esplicito, senza scartarlo in silenzio; il file sorgente resta invariato. Le collisioni e i ricalcoli seguono il contratto corrente dell'importer.
Dopo l'importazione business, un consenso separato permette di recuperare solo bozze device presenti nel backup e ancora assenti sul dispositivo: il flush delle bozze correnti precede il controllo strict e le write cifrate owner-scoped, senza sovrascrivere copie locali. Il recupero opzionale ammette fino a 1.024 bozze, ciascuna non oltre 100.000 caratteri e massimo 1.000.000 di caratteri complessivi; il limite non è quello di 64 testimoni concorrenti per singolo campo. Se la sezione opzionale supera tali limiti o contiene bozze malformate, l'anteprima avvisa chiaramente che **nessuna bozza** verrà ripristinata durante l'importazione, ma consente l'importazione separata dei dati business validi; il file originale deve essere conservato per recupero ulteriore. Nessuno scarto silenzioso o replay cross-epoch. Fallimenti parziali delle bozze sono segnalati e il backup originale rimane fonte di recovery.
Un recupero separato e confermato dell'allenamento device-local può eseguire una nuova DomainOperation solo se non esiste una sessione locale, non è già nello storico e non sostituisce un diverso activeWorkout. I vecchi intenti/generazioni e il journal NON vengono trapiantati: il commit locale crea il journal corrente.
Solo dopo quel commit è ammesso ripristinare un timer mancante, convertendo lo stato running in paused all'istante dell'export. Non promettere continuità temporale tra dispositivi e non sovrascrivere alcun record esistente.
- **Ripristina:** sostituisce i campi presenti nel formato supportato rispetto allo stato locale disponibile; non autorizza a trattare dati cloud mai caricati come assenti.
- L'anteprima/commit deve invalidarsi se cambia sessione o baseline rilevante durante l'operazione.
- La conferma segue la persistenza locale; offline non va presentata come conferma cloud. **MUST:** l'importazione controlla l'esito tipizzato `SyncResult` di `saveUserData`: il solo completamento della Promise non è prova di commit; `failed`/`rejected` arrestano il flusso prima di recuperi device e conferme, mentre `local-pending` può essere dichiarato solo come dato salvato localmente e non cloud-acknowledged. Il messaggio deve usare l'esito della specifica importazione, non uno stato di sync globale che può essere cambiato da altre operazioni.
- I consensi importati non sostituiscono l'accettazione corrente.
- Nel merge ospite → account, il consenso legale ospite non è trasferibile: `legalConsent` resta quello già associato all'account, se presente; per un account nuovo serve una nuova accettazione esplicita.
- Non inventare conversioni V1/V2 per aggirare la baseline clean-cut.

## Esportazione CSV

`Exporter.exportToCSV` genera dal dataset disponibile in memoria `allenamenti.csv`, `misurazioni.csv` e, quando presenti, `passi.csv` e `cardio.csv`. È un export analitico tabellare: il CSV non ha la completezza del percorso Backup JSON cloud paginato e la UI non deve presentarlo come copia completa o ripristinabile.

- **MUST:** I CSV includono il BOM UTF-8 per compatibilità Excel. Markdown, sorgenti e JSON restano UTF-8 senza BOM.
- **MUST:** Nuove metriche business da esportare devono essere mappate esplicitamente nel contratto tipizzato CSV oppure classificate deliberatamente come escluse.
- **MUST:** Le date business giornaliere usano `YYYY-MM-DD`; gli istanti evento separati usano ISO UTC.
- **MUST:** Un’operazione CSV multi-file termina soltanto dopo che tutti gli output previsti hanno concluso il proprio salvataggio o dopo un annullamento/errore esplicito.

## Eliminazione account

**MUST:** quando Firebase Auth è attivo ma la migrazione guest→account è differita fino al primo consenso, l'owner locale può restare `guest`. «Esci dall'account» deve soltanto eseguire il sign-out Firebase, preservando l'archivio guest. «Elimina account» deve avviare il job backend per l'UID autenticato senza toccare i dati ospite; ricevuta e cleanup dell'archivio account restano pendenti finché un'altra identità locale è attiva. Il callback Auth null aggiorna sempre `currentUser` a null.

`useSettingsAccountActions` (esposto tramite `useSettings`) chiede due conferme e riautentica Google prima di invocare `DB.deleteAccount`, passando esplicitamente gli adapter applicativi per congelare i writer e resettare lo store. Il boundary infrastrutturale `db_account.ts` non importa Zustand: riceve queste operazioni tramite context injection. Il client controlla il token aggiornato prima di congelare i writer; il backend trusted verifica nuovamente ID token, revoca e `auth_time` recente e richiede App Check prima di accettare il job.

La cancellazione autenticata è coordinata dal backend Vercel nativo e dal job amministrativo `account_deletions/{uid}`. La collection dei job è server-only: i client non possono leggerla o mutarla. La presenza del job è anche una barriera Firestore globale: le Rules negano accesso al root utente e alle raccolte private da qualunque client autenticato con quell'UID, impedendo ad altri dispositivi o client vecchi di ricreare dati mentre il server cancella.

Il registro **locale** delle credenziali di recupero conserva al massimo quattro nuovi account per profilo browser. Se è pieno, una nuova registrazione segnala un errore esplicito senza sostituire una prova di recupero di un altro account; la lettura e la rimozione di record validi ereditati da un formato precedente non devono troncare le altre prove. La creazione della prova è serializzata nello stesso contesto e usa Web Locks tra schede quando disponibili; la ripetizione della registrazione per un UID esistente deve riutilizzare la prova già persistita. La serializzazione non fornisce atomicità tra schede nei browser privi di Web Locks. È un limite distinto da quello **server-side per UID** e non garantisce il recupero su dispositivi non registrati. Un eventuale aumento del limite locale richiede una decisione separata con verifiche sul lifecycle.

`account_deletion_devices/{uid}` è un registro server-only bounded: conserva al massimo 12 hash SHA-256 di credenziali device, mai i token raw. La registrazione richiede sessione Firebase valida/non revocata e App Check limited-use consumato, ma non recent-auth perché non avvia operazioni distruttive; recent-auth resta obbligatoria per la cancellazione.
Una registrazione riuscita rende la credenziale la più recente; se il registro è pieno, una nuova credenziale sostituisce quella meno recentemente registrata invece di bloccare permanentemente il device. Il registro abilita il recovery locale dopo la rimozione di Firebase Auth e viene eliminato insieme al tombstone scaduto.
Il client considera la registrazione riuscita soltanto dopo HTTP 200 e risposta JSON valida con `registered: true`, letta entro la stessa deadline complessiva di 7,5 secondi; risposte mancanti, false o corrotte mantengono la credenziale locale e abilitano nuovi tentativi.

**Diagnostica recovery:** le verifiche periodiche di credenziali device, la loro registrazione e la riconciliazione di marker di cancellazione restano operazioni distinte. I timeout e gli errori transitori di routine non attestano una cancellazione e vengono segnalati solo se ripetuti (terzo fallimento consecutivo e poi ogni decimo, con reset dopo un controllo riuscito).
Le violazioni di integrità, gli stati cloud `failed` e i fallimenti di pulizia locale successivi a prova `complete` restano immediatamente visibili. La diagnostica invia soltanto categoria, fase, stato HTTP e conteggio, mai eccezioni grezze, UID o credenziali. Il throttling diagnostico non modifica timeout, marker, retry e protezioni del recupero.

Flusso normativo:

1. Il client attende journal e scritture Firestore già pendenti, ottiene App Check, crea una receipt casuale da 256 bit e la salva nel marker locale persistente prima della richiesta. La receipt in chiaro resta sul dispositivo; il server salva solo SHA-256.
2. `POST /api/account-deletion` verifica Firebase ID token, UID derivato esclusivamente dal token, revoca, autenticazione recente e App Check; crea o aggiorna idempotentemente il job e avvia subito il cleanup nella stessa invocazione.
3. Il job revoca i refresh token e acquisisce un lease breve. POST, polling GET e cron possono tentare recovery, ma un solo worker per UID esegue operazioni distruttive alla volta; un lease scaduto è riprendibile.
4. Il server elimina pagine da massimo 400 documenti dalle sei raccolte private correnti: `history_months`, `nutrition_months`, `sync_control`, `telemetry_errors`, `telemetry_events`, `telemetry_anomalies`. Dopo ogni batch il retry riparte dalla prima pagina; il cursor è telemetria/progresso e non è una dipendenza di correttezza.
5. Se il budget della Function si avvicina al limite, il job salva uno stato riprendibile e termina senza dichiarare successo. `GET /api/account-deletion` può far avanzare un job incompleto durante il polling. Il cron giornaliero `/api/account-deletion-cron` è soltanto una rete di sicurezza per job rimasti incompleti.
6. Dopo le raccolte note il server elimina `/users/{uid}`, verifica root e raccolte note vuote e fallisce chiuso se trova dati privati inattesi. Solo dopo la verifica elimina Firebase Auth; `auth/user-not-found` in un retry è successo idempotente.
7. Il client elimina la copia locale e la receipt solo dopo stato server `complete`. Se Auth è già sparita, bootstrap e `AccountDeletionRecovery` preservano l'envelope dell'owner e interrogano lo stato tramite UID + receipt + App Check senza richiedere un ID token ancora valido.
8. Quando il job diventa `complete`, il server assegna `purgeAfter` a 30 giorni dal completamento. Il cron giornaliero dà priorità ai job ancora recuperabili e usa soltanto il budget residuo per eliminare i tombstone `complete` scaduti. Il record tecnico di recovery non contiene i dati fitness/nutrizione cancellati; conserva l'identificativo tecnico del job, stato/timestamp e hash della receipt necessari alla riconciliazione.

**MUST:** Firebase Auth è sempre l'ultima risorsa cloud eliminata. Un errore di query, batch, verifica, backend o stato non autorizza il purge locale né una dichiarazione di successo.

**MUST:** la finalizzazione locale di una cancellazione account completa deve ricontrollare, sotto il lock dell'owner, che non sia diventato attivo un altro account o una sessione ospite. Anche il retry di un purge già fenced deve rispettare il controllo prima di eliminare chiavi locali condivise; il server-complete resta prova distinta da questa barriera locale.

**MUST:** Un job `failed` deve comunicare che la cancellazione cloud può essere parziale. I batch già riusciti non sono reversibili. Errori transient/retryable possono essere ripresi idempotentemente; residui inattesi o violazioni fail-closed non devono entrare in un retry distruttivo automatico senza nuova valutazione.

**MUST:** Il marker locale sospende replica, logout distruttivi e reset locali ordinari finché la receipt non è riconciliata. Il boundary di purge deve applicare la protezione anche quando viene chiamato direttamente; solo la finalizzazione con prova server `complete` può usare il percorso di purge dedicato. Offline o con endpoint non raggiungibile, la copia locale resta conservata e il marker continua a bloccare i writer.

**MUST:** Un HTTP 400/401/403 su un nuovo POST non dimostra che un precedente POST con receipt già persistita non sia stato accettato: sui retry preservare marker e receipt. Ogni tentativo di recovery (inclusi provider di token e parsing del body) deve avere una deadline complessiva e non deve proseguire con side effect quando scaduta. La riconciliazione deve considerare tutti gli owner indipendentemente, senza far bloccare un marker valido da un altro in errore o corrotto.

**MUST:** Il boundary `src/lib/db/db_account.ts` resta indipendente dallo store Zustand. Le operazioni applicative `cancelPendingSyncs` e `resetStore` vengono iniettate dai chiamanti/orchestratori; non reintrodurre un import inverso dal layer DB verso `useAppStore`.

**MUST:** La retention del tombstone server non autorizza mai un purge locale per inferenza. Se un dispositivo torna online dopo che il tombstone `complete` è già scaduto e il server non può più provare lo stato, la copia locale resta conservata fail-safe e richiede gestione esplicita invece di essere eliminata alla cieca.

**MUST:** Le credenziali Firebase Admin e `CRON_SECRET` sono server-only, mai `VITE_*`, mai committate. `service-account.json` resta ignorato e non deve entrare nel repository.

Le Functions native account deletion mantengono `maxDuration = 300`; le richieste interattive POST/GET usano budget riprendibili di 5 secondi e un headroom runner dedicato inferiore al budget interattivo, mentre i percorsi background mantengono un margine più conservativo. Il client applica un timeout HTTP bounded, conservando receipt e copia locale in caso di risposta incerta.
Il cron giornaliero è recovery, non il percorso primario. **MUST:** il budget interattivo e il relativo headroom devono restare definiti da un contratto condiviso e testato insieme: il runner non può considerare esaurito un budget POST/GET appena creato. **VERIFY:** piano Vercel effettivo, limiti commerciali e configurazione runtime sono esterni al repository e non vanno assunti senza verifica.
Non introdurre Nitro, Workflow, `waitUntil` come sostituto di durability, o una migrazione di piattaforma/backend senza un nuovo piano esplicito.

## Cancellazione dei soli dati dopo revoca (mantenendo Firebase Auth)

**MUST:** l'azione distinta «Elimina definitivamente i miei dati» è visibile solo al titolare di account con revoca salute confermata dal server, mai come effetto implicito della revoca. Richiede rete, due conferme consapevoli, recente autenticazione Firebase, verifica ID token con revocation check e App Check limited-use consumato. Il server determina sempre l'UID dal token, non dall'input.

`health_data_erasures/{uid}` è un job amministrativo server-only, riprendibile con lease, pagine bounded e cron. Il job non cancella **Firebase Auth, il marker di consenso o il marker di revoca delle sessioni**. Elimina le collection business e telemetriche Firestore dell'account e il root, poi verifica l'assenza anche di collection inattese. Un residuo sconosciuto impedisce il completamento; una cancellazione parziale non equivale a successo. `recordHealthConsentReacceptance` rifiuta qualsiasi job non completato.

**MUST:** al completamento il backend avanza **atomicamente** la revisione di consenso ancora `withdrawn` e registra `erasedBeforeRevision`. Una vecchia replica non può scrivere con la generazione cancellata. I retry dello stesso job sono idempotenti anche dopo l'avanzamento della revisione. La retention del job completo è 30 giorni; solo il cron con prova persistente dell'epoch può rimuoverlo.

**MUST:** il client può cancellare IndexedDB, device-critical e chiavi soltanto dopo stato `complete` letto dal proprio endpoint trusted; per una nuova pulizia dei soli dati salute la prova della revisione corrente deve essere ripetuta **dentro il lock esclusivo dell'owner**, immediatamente prima del fence. Un purge già interrotto e fenced resta riprendibile senza richiedere una seconda prova sotto lock. Il purge locale resta fenced fino alla prova di rimozione delle copie cifrate. Dopo la pulizia, effettua sign-out **senza eliminare Firebase Auth**. Se la connessione, la verifica del server o la pulizia locale fallisce, nessun messaggio deve dichiarare cancellazione completa.

**LIMITAZIONE:** dispositivi offline possono conservare copie vecchie impossibili da eliminare da remoto. Il protocollo impedisce la replica delle generazioni vecchie nel cloud; un successivo recupero esplicito di archivi precedenti richiede attenzione per non reintrodurre dati eliminati. Non dichiarare cancellazione universale di copie offline, fornitori esterni o backup non verificati.

## Verifica email e accesso account

L'accesso account/cloud richiede che Firebase Auth riporti `emailVerified === true`. Una sessione non verificata non deve avviare idratazione Firestore, replica, registrazione del dispositivo né migrazione guest→account. Per gli account email/password, la registrazione richiede l'invio del link di verifica; alla conferma il client esegue `reload(user)`, aggiorna il token ID con `getIdToken(true)` e riprende il bootstrap tramite ricaricamento protetto.

**MUST:** il blocco UI precede tutte le schermate di dati account; le Security Rules richiedono `request.auth.token.email_verified == true` su root e collezioni private e non si affidano soltanto alla UI. Le letture pubbliche del catalogo restano accessibili senza account.

**MUST:** `POST /api/health-consent` richiede il claim server-side `email_verified === true` per `accept-initial` e `reaccept`, che attivano il trattamento fitness. La verifica di UID, ID token non revocato e App Check limited-use consumato si applica anche a `GET` e alla revoca `withdraw`, ma il claim email non deve bloccare né la consultazione dello stato né la revoca dei propri consensi.
Anche cancellazione account, registrazione credenziale di recovery ed esportazione durante consenso revocato restano disponibili al titolare autenticato quando l'email non è più verificabile. L'export trusted richiede UID derivato dal token, stato `withdrawn` attestato dal server e App Check; non accetta UID forniti dal client.

**MUST:** lasciare un account non verificato per usare la modalità locale esegue sign-out Firebase senza il purge dell'owner account; eventuali copie IndexedDB dell'account, progressi guest e intento di migrazione restano preservati. Prima di iniziare un nuovo guest, lo store in memoria non deve riciclare dati di un altro owner. La migrazione riprende soltanto dopo verifica e con scelta guest ancora valida o richiesta nuovamente se scaduta.

**MUST:** Per un account con consenso iniziale *già attestato* dal server è consentita una nuova scelta esplicita offline dopo revoca locale. Il nuovo consenso abilita **esclusivamente** il dispositivo già verificato; marker persistente e revisioni mantengono il debito di revoca e riaccettazione sul server.
`isHealthConsentCloudWritable` deve restare falso durante tale fase, anche se la rete torna disponibile. Il backend riceve prima la revoca relativa alla generazione nota e poi la riaccettazione attuale, entrambe con CAS; un GET trusted successivo deve confermare revisione e versioni legali prima di sbloccare la replica.
Gli utenti al primo consenso, nuove identità, account non verificati, revisioni non attendibili e consenso legale scaduto non possono ottenere riattivazione offline. Una revoca più recente da un altro dispositivo sospende l'accesso; un'accettazione più recente richiede una scelta esplicita.
Journal e ciphertext precedenti restano recuperabili e non si riproducono automaticamente nella nuova generazione. Le copie workout device-critical rimaste prima del commit IndexedDB sono un intento separato dal journal: le nuove copie associano la revisione locale di consenso e non possono essere rigiocate in una revisione differente. I vecchi intenti senza prova di origine, se la revisione corrente è superiore a 1, restano conservati ma non sono caricati automaticamente nel journal. Anche una copia IndexedDB senza pending può contenere dati cancellati dal server: se il limite trusted `erasedBeforeRevision` include la revisione dell'envelope esistente, la transizione alla nuova revisione rimane bloccata **dentro la transazione locale**, conservando l'originale senza autorizzare accesso fitness o replica. Questo stato è distinto dal recupero delle modifiche offline: i dati cancellati non possono essere reimportati automaticamente. L'utente può esportare una copia e scegliere un logout protetto per ripartire dal cloud; il journal pendente continua a rispettare i gate esistenti. Il recupero esplicito di un vecchio journal richiede una seconda verifica trusted della revisione e del limite server `erasedBeforeRevision` dopo la scansione cloud, prima del commit IndexedDB; se la revisione cambia o la cancellazione ha raggiunto il journal originale, nessuna nuova operazione viene creata. Un errore di rete o App Check non equivale a consenso cloud confermato.

## Revoca globale delle sessioni (F-03)

«Disconnetti tutti i dispositivi» è un'azione distinta dal logout ordinario. Richiede conferma dell'utente, autenticazione Firebase recente, token ID verificato con revocation check e App Check limited-use consumato. Il backend determina l'UID dal token validato, non da un input client, e revoca i refresh token tramite Firebase Admin.

**MUST:** il backend registra prima della revoca il limite temporale monotono `session_revocations/{uid}.revokedAfterSeconds`. Dopo la revoca lo aggiorna con il timestamp autorevole Firebase. Firestore Rules negano l'accesso ai documenti privati se `auth_time <= revokedAfterSeconds`, anche con un ID token ancora formalmente valido; il record è server-only e un record malformato blocca l'accesso. Una ripetizione dell'operazione non può arretrare il limite.

**MUST:** una risposta incompleta o un errore non equivale a successo; un limite già scritto non deve essere rimosso dopo un fallimento. La cancellazione account impedisce la creazione concorrente di nuovi marker, li elimina sotto transazione e ne verifica l'assenza prima di rimuovere Firebase Auth. Il client non avvia la revoca se riscontra modifiche locali non sincronizzate o condizioni che rendono insicura la pulizia del vault; dopo una revoca confermata usa il logout ordinario protetto, senza purge forzato.

**LIMITAZIONE:** la revoca blocca l'accesso cloud alle sessioni precedenti ma non elimina i dati già conservati su dispositivi offline né ne impedisce l'uso locale finché restano offline. Nessuna interfaccia deve promettere una cancellazione remota dei dati locali. Il controllo del consenso sanitario resta un requisito indipendente.

## Logout e pulizia locale

Il logout autenticato ordinario deve verificare il journal IndexedDB durabile, non solo lo stato di sincronizzazione in memoria. Una generazione di consenso positiva, canonica e rappresentabile come intero sicuro non è di per sé una transizione pendente; revisioni malformate, richieste di consenso non riconciliate e journal appartenenti a una generazione precedente devono invece bloccare il purge, anche dopo una scelta di uscita forzata. Il preflight finale avviene sotto Web Lock di owner: prima si consolidano le bozze correnti, poi si verifica che il journal non abbia pending, si persiste il purge fence e soltanto allora si invalida Firebase Auth.
I writer di altre schede devono rifiutare la fence. Un sign-out fallito prima della prima cancellazione revoca soltanto la nuova fence; una cancellazione incompleta la conserva per il recovery. Il percorso esplicitamente distruttivo del dialogo può scartare pending dopo scelta consapevole, ma deve preservare gli altri gate di consenso e cancellazione account.


`secureLogOut` propaga un errore di `auth.signOut` e conserva il locale. **Prima di invalidare Firebase Auth**, il logout autenticato rifiuta intenti di revoca/riaccettazione salute non ancora riconciliati, journal non inviati dopo una revoca confermata e journal di una generazione di consenso precedente ancora da recuperare.
Il purge ordinario ripete queste verifiche, anche se chiamato direttamente; un errore di lettura del marker o dell'envelope non autorizza la cancellazione. Dopo sign-out riuscito, purga l'archivio dell'owner catturato prima del logout. Gli archivi owner-scoped degli altri utenti restano separati.
L'eliminazione volontaria dell'account ha un boundary di finalizzazione separato, autorizzato solo dal completamento verificato del server.

`purgeAllLocalUserData` tenta ogni rimozione e rigetta con un errore aggregato se alcune falliscono: la UI comunica la pulizia incompleta. Durante una cancellazione server la receipt viene esclusa dal purge ordinario e rimossa solo dopo il successo di tutte le altre operazioni locali.

**MUST:** Non eliminare la cache del service worker durante logout: contiene gli asset necessari all'avvio offline.

### Chiave locale automatica e purge

Il vault cifrato dell'owner è apribile automaticamente dopo il gate d'identità Firebase o la generazione guest; non richiede un secondo segreto. **MUST:** `purgeOwnerLocalData` elimina tutti i dati cifrati IndexedDB e device-critical prima di rimuovere la wrapping key IndexedDB; una rimozione parziale non autorizza perdita di chiavi se rimangono byte recuperabili. In caso di cancellazione account, il percorso receipt-based con stato server `complete` può effettuare la pulizia ciphertext senza aprire il vault.

Se il key store non è disponibile ma esiste ciphertext, non generare una nuova chiave per sovrascriverlo. Preservare le evidenze e offrire retry/recupero non distruttivo. La chiave di dispositivo in IndexedDB non impedisce a un attaccante con copia integrale del profilo browser di tentare la decifratura: non descriverla come E2EE.

## Guest e aggiornamenti

La modalità guest ha archivio e workout separati dagli utenti. La migrazione conserva la copia guest e registra il risultato locale prima della replica. Le callback vecchie sono invalidate tramite owner ed epoch.

**MUST:** anche con policy `skip` (nessun trasferimento dell'archivio guest), oppure senza dati guest da fondere, un journal già pendente dell'account autenticato deve essere rigiocato o dichiarato `local-pending`/fallito secondo l'esito durevole; la hydration da sola non prova un ACK cloud. La copia guest resta separata e invariata.

**MUST (CRITICAL):** durante il recovery di una migrazione guest→account già durevole, pubblicare l'envelope autenticato nello stato UI soltanto dopo il controllo dell'owner/sessione e senza attraversare `setUserData()` o altri writer di modifica business. Un vecchio snapshot guest in memoria non è la baseline del nuovo account. I journal e le copie device-critical di entrambi gli owner devono rimanere protetti; il ripristino dell'allenamento autenticato usa il recovery owner-scoped canonico.

Gli aggiornamenti PWA sono differibili. Prima del reload: flush delle bozze, attesa dei salvataggi, confronto fra store e copia IndexedDB e snapshot sincrono del workout. Errori locali bloccano il reload. Un errore di caricamento chunk apre lo stesso prompt; non scatena più un reload automatico che può ripetersi.

**MUST:** il cron seleziona i job recuperabili in ordine persistente server-side per evitare starvation oltre il limite di pagina; le query ordinate dipendono dagli indici `account_deletions(status, updatedAt)` e `account_deletions(status, retryable, updatedAt)` che devono essere `READY` prima della distribuzione del backend.

**MUST:** il purge di un tombstone scaduto e del corrispondente registro delle credenziali device usa una singola transazione Firestore; un errore non può eliminare solo uno dei due record. Le fasi indipendenti del cron devono proseguire se una query o una manutenzione fallisce, conservando log aggregati privi di dati personali.

**MUST:** il cron preserva una finestra temporale dedicata alla retention telemetrica legacy quando i job di cancellazione occupano il budget, senza interrompere deliberatamente una transazione Firestore in corso.

## Riferimenti per consenso e accountability

**MUST (owner e consenso asincroni):** risposte trusted e scelte esplicite del consenso non possono pubblicare revisioni o modificare IndexedDB dopo un cambio UID; ricontrollare identità/decisione dopo le attese e nel commit locale. Il drenaggio del journal deve verificare l'UID anche dopo la lettura IndexedDB prima del flush globale.

- [Decisione e gate sul consenso salute](../../docs/compliance/health-consent-release-gate.md) e [protocollo tecnico della revoca](../../docs/compliance/health-consent-technical-protocol.md): distinguere comportamenti documentati, verifiche manuali pendenti e questioni legali aperte.
- [Pacchetto compliance pre-pilot](../../docs/compliance/README.md): procedure e template non automaticamente approvati, né sostituti di Rules, codice e contratti di questo file.
