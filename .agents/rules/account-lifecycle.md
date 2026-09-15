# Ciclo di vita account — LogBook

> Stato: normativo | Ultima verifica: 2026-09-14

## Backup JSON e importazione

`src/lib/backup.ts` definisce il formato `logbook-backup`, versione 2: owner, data di esportazione, copertura, intero `UserData` e recovery locale. `src/lib/db/backupSnapshot.ts` legge il profilo e tutte le pagine dello storico/nutrizione dal server (50 documenti per pagina), poi confronta cloud, baseline e ultima revisione locale. Gli originali cloud e il registro locale sono inclusi nella sezione recovery.

La lettura di tutti i documenti non costituisce uno snapshot atomico fra dispositivi. Il file registra inizio/fine lettura; con modifiche concorrenti può essere necessario ripetere l'esportazione. Un errore di rete non produce un backup dichiarato completo: l'utente può scegliere esplicitamente la copia del solo dispositivo, marcata `device`.

Il formato v1 ordinario e quello d'emergenza sono importabili. I formati senza owner richiedono conferma esplicita della provenienza; i backup di un altro account sono rifiutati anche in modalità guest.

- **Importa JSON:** unione incrementale senza mutazioni in place. Le collisioni mantengono il valore locale; i campi mancanti vengono aggiunti. I totali delle giornate con nuovi pasti sono ricalcolati.
- **Ripristina:** sostituisce i campi presenti nel file rispetto allo stato locale disponibile. Un vecchio backup parziale non azzera i campi che omette. Il writer cloud conserva comunque dati remoti mai caricati; non equivale a cancellare e ricreare l'intero account.
- Un'anteprima espone dimensione del risultato e collisioni. Cambi di sessione o modifiche mentre l'anteprima è aperta annullano il commit.
- La conferma segue la persistenza locale; offline il messaggio indica che il cloud è ancora in attesa.
- I consensi importati non sostituiscono l'accettazione corrente.
- La recovery conserva anche bozze e alternative ai conflitti. Il ripristino guidato di questi dati aggiuntivi è ancora da completare; il file originale va conservato.

La vecchia cache senza owner viene copiata senza sovrascrivere un archivio recovery già presente. “Esporta archivio precedente” rende disponibile il file per recupero esplicito. Le vecchie credenziali/code REST non vengono riprodotte o esportate.

## Esportazione CSV

`Exporter.exportToCSV` genera `allenamenti.csv` (serie, dropset, isometrie) e `misurazioni.csv` (peso, macro, circonferenze e sonno) dal dataset disponibile in memoria. Il CSV non ha la completezza del nuovo percorso JSON cloud paginato.

- **MUST:** I CSV includono il BOM UTF-8 per compatibilità Excel. Markdown, sorgenti e JSON restano UTF-8 senza BOM.
- **MUST:** Nuove metriche da esportare devono essere mappate esplicitamente.

## Eliminazione account

`useSettings` chiede due conferme e riautentica Google prima di invocare `DB.deleteAccount`. Il client controlla il token aggiornato prima di congelare i writer; il backend trusted verifica nuovamente ID token, revoca e `auth_time` recente e richiede App Check prima di accettare il job.

La cancellazione autenticata è coordinata dal backend Vercel nativo e dal job amministrativo `account_deletions/{uid}`. La collection dei job è server-only: i client non possono leggerla o mutarla. La presenza del job è anche una barriera Firestore globale: le Rules negano accesso al root utente e alle raccolte private da qualunque client autenticato con quell'UID, impedendo ad altri dispositivi o client vecchi di ricreare dati mentre il server cancella.

Flusso normativo:

1. Il client attende journal e scritture Firestore già pendenti, ottiene App Check, crea una receipt casuale da 256 bit e la salva nel marker locale persistente prima della richiesta. La receipt in chiaro resta sul dispositivo; il server salva solo SHA-256.
2. `POST /api/account-deletion` verifica Firebase ID token, UID derivato esclusivamente dal token, revoca, autenticazione recente e App Check; crea o aggiorna idempotentemente il job e avvia subito il cleanup nella stessa invocazione.
3. Il job revoca i refresh token e acquisisce un lease breve. POST, polling GET e cron possono tentare recovery, ma un solo worker per UID esegue operazioni distruttive alla volta; un lease scaduto è riprendibile.
4. Il server elimina pagine da massimo 400 documenti dalle cinque raccolte private note: `history_months`, `nutrition_months`, `telemetry_errors`, `telemetry_events`, `telemetry_anomalies`. Dopo ogni batch il retry riparte dalla prima pagina; il cursor è telemetria/progresso e non è una dipendenza di correttezza.
5. Se il budget della Function si avvicina al limite, il job salva uno stato riprendibile e termina senza dichiarare successo. `GET /api/account-deletion` può far avanzare un job incompleto durante il polling. Il cron giornaliero `/api/account-deletion-cron` è soltanto una rete di sicurezza per job rimasti incompleti.
6. Dopo le raccolte note il server elimina `/users/{uid}`, verifica root e raccolte note vuote e fallisce chiuso se trova dati privati inattesi. Solo dopo la verifica elimina Firebase Auth; `auth/user-not-found` in un retry è successo idempotente.
7. Il client elimina la copia locale e la receipt solo dopo stato server `complete`. Se Auth è già sparita, bootstrap e `AccountDeletionRecovery` preservano l'envelope dell'owner e interrogano lo stato tramite UID + receipt + App Check senza richiedere un ID token ancora valido.

**MUST:** Firebase Auth è sempre l'ultima risorsa cloud eliminata. Un errore di query, batch, verifica, backend o stato non autorizza il purge locale né una dichiarazione di successo.

**MUST:** Un job `failed` deve comunicare che la cancellazione cloud può essere parziale. I batch già riusciti non sono reversibili. Errori transient/retryable possono essere ripresi idempotentemente; residui inattesi o violazioni fail-closed non devono entrare in un retry distruttivo automatico senza nuova valutazione.

**MUST:** Il marker locale sospende replica e reset distruttivi finché la receipt non è riconciliata. Offline o con endpoint non raggiungibile, la copia locale resta conservata e il marker continua a bloccare i writer.

**MUST:** Le credenziali Firebase Admin e `CRON_SECRET` sono server-only, mai `VITE_*`, mai committate. `service-account.json` resta ignorato e non deve entrare nel repository.

La produzione usa Vercel Functions native sul piano Hobby con un budget interno inferiore al limite della Function. Il cron giornaliero è recovery, non il percorso primario. Non introdurre Nitro, Workflow, `waitUntil` come sostituto di durability, o una migrazione a Firebase Blaze senza un nuovo piano esplicito.

## Logout e pulizia locale

`secureLogOut` propaga un errore di `auth.signOut` e conserva il locale. Dopo sign-out riuscito, purga l'archivio dell'owner catturato prima del logout. Gli archivi v2 degli altri utenti restano separati.

`purgeAllLocalUserData` tenta ogni rimozione e rigetta con un errore aggregato se alcune falliscono: la UI comunica la pulizia incompleta. Durante una cancellazione server la receipt viene esclusa dal purge ordinario e rimossa solo dopo il successo di tutte le altre operazioni locali.

**MUST:** Non eliminare la cache del service worker durante logout: contiene gli asset necessari all'avvio offline.

## Guest e aggiornamenti

La modalità guest ha archivio e workout separati dagli utenti. La migrazione conserva la copia guest e registra il risultato locale prima della replica. Le callback vecchie sono invalidate tramite owner ed epoch.

Gli aggiornamenti PWA sono differibili. Prima del reload: flush delle bozze, attesa dei salvataggi, confronto fra store e copia IndexedDB e snapshot sincrono del workout. Errori locali bloccano il reload. Un errore di caricamento chunk apre lo stesso prompt; non scatena più un reload automatico che può ripetersi.
