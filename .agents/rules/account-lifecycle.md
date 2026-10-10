# Ciclo di vita account — LogBook

> Stato: normativo | Ultima verifica: 2026-09-20

## Backup JSON e importazione

`src/lib/backup.ts` usa il formato corrente `logbook-backup` **Backup Schema 3**, con owner, data di esportazione, copertura, `UserData`, versioni data/sync e recovery locale. `src/lib/db/backupSnapshot.ts` legge il root e tutte le pagine mensili di storico/nutrizione dal server, normalizza i documenti cloud, poi rilegge l'envelope locale più recente e riapplica le pending operation quando presenti. Gli originali cloud e il registro locale sono inclusi nella sezione recovery prevista dal formato corrente.

La lettura di tutti i documenti non costituisce uno snapshot atomico fra dispositivi. Il file registra la propria copertura; con modifiche concorrenti può essere necessario ripetere l'esportazione. Un errore di rete non deve produrre un backup dichiarato completo se la copertura richiesta non è stata acquisita.

La baseline clean-cut corrente **non importa Backup Schema V1/V2**: `decodeImport()` li rifiuta tramite `LegacyVersionError`. Anche versioni future sconosciute falliscono chiuso e richiedono aggiornamento. Non esiste più un percorso prodotto che legga, preservi o esporti la vecchia cache locale non attribuita `logbook_cached_user_data`: prima dell'esistenza di account reali quel compatibility layer è stato rimosso intenzionalmente.

- **Importa JSON:** opera soltanto su formati supportati e applica l'unione prevista senza mutazioni in place. Le collisioni e i ricalcoli seguono il contratto corrente dell'importer.
- **Ripristina:** sostituisce i campi presenti nel formato supportato rispetto allo stato locale disponibile; non autorizza a trattare dati cloud mai caricati come assenti.
- L'anteprima/commit deve invalidarsi se cambia sessione o baseline rilevante durante l'operazione.
- La conferma segue la persistenza locale; offline non va presentata come conferma cloud.
- I consensi importati non sostituiscono l'accettazione corrente.
- Non inventare conversioni V1/V2 per aggirare la baseline clean-cut.

## Esportazione CSV

`Exporter.exportToCSV` genera dal dataset disponibile in memoria `allenamenti.csv`, `misurazioni.csv` e, quando presenti, `passi.csv` e `cardio.csv`. È un export analitico tabellare: il CSV non ha la completezza del percorso Backup JSON cloud paginato e la UI non deve presentarlo come copia completa o ripristinabile.

- **MUST:** I CSV includono il BOM UTF-8 per compatibilità Excel. Markdown, sorgenti e JSON restano UTF-8 senza BOM.
- **MUST:** Nuove metriche business da esportare devono essere mappate esplicitamente nel contratto tipizzato CSV oppure classificate deliberatamente come escluse.
- **MUST:** Le date business giornaliere usano `YYYY-MM-DD`; gli istanti evento separati usano ISO UTC.
- **MUST:** Un’operazione CSV multi-file termina soltanto dopo che tutti gli output previsti hanno concluso il proprio salvataggio o dopo un annullamento/errore esplicito.

## Eliminazione account

`useSettings` chiede due conferme e riautentica Google prima di invocare `DB.deleteAccount`, passando esplicitamente gli adapter applicativi per congelare i writer e resettare lo store. Il boundary infrastrutturale `db_account.ts` non importa Zustand: riceve queste operazioni tramite context injection. Il client controlla il token aggiornato prima di congelare i writer; il backend trusted verifica nuovamente ID token, revoca e `auth_time` recente e richiede App Check prima di accettare il job.

La cancellazione autenticata è coordinata dal backend Vercel nativo e dal job amministrativo `account_deletions/{uid}`. La collection dei job è server-only: i client non possono leggerla o mutarla. La presenza del job è anche una barriera Firestore globale: le Rules negano accesso al root utente e alle raccolte private da qualunque client autenticato con quell'UID, impedendo ad altri dispositivi o client vecchi di ricreare dati mentre il server cancella.

`account_deletion_devices/{uid}` è un registro server-only bounded: conserva al massimo 12 hash SHA-256 di credenziali device, mai i token raw. La registrazione richiede sessione Firebase valida/non revocata e App Check limited-use consumato, ma non recent-auth perché non avvia operazioni distruttive; recent-auth resta obbligatoria per la cancellazione. Una registrazione riuscita rende la credenziale la più recente; se il registro è pieno, una nuova credenziale sostituisce quella meno recentemente registrata invece di bloccare permanentemente il device. Il registro abilita il recovery locale dopo la rimozione di Firebase Auth e viene eliminato insieme al tombstone scaduto.

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

**MUST:** Un job `failed` deve comunicare che la cancellazione cloud può essere parziale. I batch già riusciti non sono reversibili. Errori transient/retryable possono essere ripresi idempotentemente; residui inattesi o violazioni fail-closed non devono entrare in un retry distruttivo automatico senza nuova valutazione.

**MUST:** Il marker locale sospende replica, logout distruttivi e reset locali ordinari finché la receipt non è riconciliata. Il boundary di purge deve applicare la protezione anche quando viene chiamato direttamente; solo la finalizzazione con prova server `complete` può usare il percorso di purge dedicato. Offline o con endpoint non raggiungibile, la copia locale resta conservata e il marker continua a bloccare i writer.

**MUST:** Un HTTP 400/401/403 su un nuovo POST non dimostra che un precedente POST con receipt già persistita non sia stato accettato: sui retry preservare marker e receipt. Ogni tentativo di recovery (inclusi provider di token e parsing del body) deve avere una deadline complessiva e non deve proseguire con side effect quando scaduta. La riconciliazione deve considerare tutti gli owner indipendentemente, senza far bloccare un marker valido da un altro in errore o corrotto.

**MUST:** Il boundary `src/lib/db/db_account.ts` resta indipendente dallo store Zustand. Le operazioni applicative `cancelPendingSyncs` e `resetStore` vengono iniettate dai chiamanti/orchestratori; non reintrodurre un import inverso dal layer DB verso `useAppStore`.

**MUST:** La retention del tombstone server non autorizza mai un purge locale per inferenza. Se un dispositivo torna online dopo che il tombstone `complete` è già scaduto e il server non può più provare lo stato, la copia locale resta conservata fail-safe e richiede gestione esplicita invece di essere eliminata alla cieca.

**MUST:** Le credenziali Firebase Admin e `CRON_SECRET` sono server-only, mai `VITE_*`, mai committate. `service-account.json` resta ignorato e non deve entrare nel repository.

Le Functions native account deletion mantengono `maxDuration = 300`; le richieste interattive POST/GET usano budget riprendibili di 5 secondi e un headroom runner dedicato inferiore al budget interattivo, mentre i percorsi background mantengono un margine più conservativo. Il client applica un timeout HTTP bounded, conservando receipt e copia locale in caso di risposta incerta. Il cron giornaliero è recovery, non il percorso primario. **MUST:** il budget interattivo e il relativo headroom devono restare definiti da un contratto condiviso e testato insieme: il runner non può considerare esaurito un budget POST/GET appena creato. **VERIFY:** piano Vercel effettivo, limiti commerciali e configurazione runtime sono esterni al repository e non vanno assunti senza verifica. Non introdurre Nitro, Workflow, `waitUntil` come sostituto di durability, o una migrazione di piattaforma/backend senza un nuovo piano esplicito.

## Verifica email e accesso account

L'accesso account/cloud richiede che Firebase Auth riporti `emailVerified === true`. Una sessione non verificata non deve avviare idratazione Firestore, replica, registrazione del dispositivo né migrazione guest→account. Per gli account email/password, la registrazione richiede l'invio del link di verifica; alla conferma il client esegue `reload(user)`, aggiorna il token ID con `getIdToken(true)` e riprende il bootstrap tramite ricaricamento protetto.

**MUST:** il blocco UI precede tutte le schermate di dati account; le Security Rules richiedono `request.auth.token.email_verified == true` su root e collezioni private e non si affidano soltanto alla UI. Le letture pubbliche del catalogo restano accessibili senza account.

**MUST:** lasciare un account non verificato per usare la modalità locale esegue sign-out Firebase senza il purge dell'owner account; eventuali copie IndexedDB dell'account, progressi guest e intento di migrazione restano preservati. Prima di iniziare un nuovo guest, lo store in memoria non deve riciclare dati di un altro owner. La migrazione riprende soltanto dopo verifica e con scelta guest ancora valida o richiesta nuovamente se scaduta.

## Logout e pulizia locale

`secureLogOut` propaga un errore di `auth.signOut` e conserva il locale. Dopo sign-out riuscito, purga l'archivio dell'owner catturato prima del logout. Gli archivi owner-scoped degli altri utenti restano separati.

`purgeAllLocalUserData` tenta ogni rimozione e rigetta con un errore aggregato se alcune falliscono: la UI comunica la pulizia incompleta. Durante una cancellazione server la receipt viene esclusa dal purge ordinario e rimossa solo dopo il successo di tutte le altre operazioni locali.

**MUST:** Non eliminare la cache del service worker durante logout: contiene gli asset necessari all'avvio offline.

## Guest e aggiornamenti

La modalità guest ha archivio e workout separati dagli utenti. La migrazione conserva la copia guest e registra il risultato locale prima della replica. Le callback vecchie sono invalidate tramite owner ed epoch.

Gli aggiornamenti PWA sono differibili. Prima del reload: flush delle bozze, attesa dei salvataggi, confronto fra store e copia IndexedDB e snapshot sincrono del workout. Errori locali bloccano il reload. Un errore di caricamento chunk apre lo stesso prompt; non scatena più un reload automatico che può ripetersi.
