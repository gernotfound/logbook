# Backup, importazione e portabilità — TheLogBook

**Quando leggere:** Backup JSON, share, merge/restore, recupero device e CSV.
**Non inferire:** replica Firestore, file JSON/CSV, prove grezze e journal riprodotto sono copie e autorizzazioni differenti.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Perimetro e fonti

Applicare il fresh start e la protezione dei dati correnti di AGENTS. Fonti: `src/lib/backup.ts`, `src/lib/db/backupSnapshot.ts`, `src/lib/backupDeviceRecovery.ts`, `src/lib/backupWorkoutRecovery.ts`, `src/lib/streamJsonImport.ts`, `src/lib/csvExport.ts`, hook delle impostazioni e importer.

**MUST (UX):** nessun backup periodico manuale richiesto: lo storage cifrato e la replica cloud dei dati business autorizzati sono automatici. Backup JSON resta una funzione volontaria di portabilità. Non descriverlo come requisito ordinario di protezione, né promettere che sessioni guest, bozze device-only o modifiche mai sincronizzate sopravvivano alla perdita totale del profilo.

## CF-08 — D1 Time Travel e prova di cancellazione indipendente (16/11/2026)

L'incremento v2.497.0 collega il candidato `cloudflare/recovery/runtime-sync-fence.mjs`
alle route `/v1/sync/*` del Worker API privato: readback sessione/consenso
sulla D1 primaria e controllo esterno su `RECOVERY_DB` prima dell'operazione
e prima di un ACK positivo. Questo non protegge ancora le rotte indipendenti
di consenso, chiavi e cancellazione: lasciare il registro `sealed` e le
API dati non pubbliche fino al loro collegamento e collaudo. Il backend deve
mantenere il journal locale ritentabile quando una scrittura è stata committata
ma la prova esterna non è più disponibile al momento della risposta.


Il registro candidato `cloudflare/recovery/independent-owner-fence.mjs` e la sua
migration in `cloudflare/recovery/migrations/` sono **isolati, non collegati
ai gate live**. La D1 EU separata esiste ma non dimostra ancora sicurezza
del restore. Il deny esterno deve precedere la revoca nella D1 originale;
il gate globale è inizialmente `sealed`, quindi qualunque uso senza
provisioning, copertura e collaudo completo deve fallire chiuso. Il ritorno
positivo di una lettura esterna non sostituisce il recheck della sessione e
dell'owner sul database autorevole; vietata riaccettazione implicitamente
basata su uno snapshot precedente.


Un `restore` D1 Time Travel riporta indietro **anche** `health_erasure_finalizations`,
`sync_subjects.erased_before_revision`, sessioni, consensi e ADK wrapped
della stessa D1: il trigger SQL `0010` non dimostra anti-resurrection fuori
dallo snapshot ripristinato. `cloudflare/recovery/restore-preflight.mjs`
è un diagnostico non collegato al runtime, e soltanto se gli viene fornito
un floor da una risorsa *indipendente*; `consistent-for-diagnostics-only`
non è approvazione a riaprire l'accesso. Anche il controllo diagnostico multi-owner `inspectRestoredOwnerCoverage` verifica solo la corrispondenza fra due elenchi forniti: **non** autentica la fonte esterna e non dimostra che siano stati censiti tutti gli owner. I test `cf08-restore-preflight.node.mjs`
riproducono un rollback sintetico con schema corrente e AuthGate reale.
Il censimento operatore `cloudflare/recovery/restore-census.mjs` legge
direttamente entrambe le tabelle complete dalle rispettive D1 primarie,
esclusivamente con controllo indipendente `sealed`. Limita il numero
di owner, confronta doppie letture e contatori, e rifiuta omissioni e
cambiamenti rilevati durante il controllo; **non** crea uno snapshot atomico
cross-D1, non verifica l'isolamento IAM e non autorizza restore o riapertura
degli accessi. Il risultato positivo resta soltanto diagnostico.

**MUST prima di GO restore:** prova monotona indipendente e completa per
tutti gli owner, protocollo di scritture cross-resource che fallisce chiuso,
fence applicato ad Auth/consenso/chiavi/sync/diritti anche durante il
ripristino, e collaudo provider su ambiente sintetico isolato. Un backup
JSON locale o una seconda copia della stessa D1 non è l'autorità richiesta.
L'assenza di tale infrastruttura significa **NO-GO**: non usare la simulazione
SQLite per giustificare un restore live. Specifica e limiti nel runbook
`docs/operations/cloudflare-workers-migration.md`.

## Copertura e limiti dei percorsi

| Percorso | Prova di completezza | Cosa non autorizza |
|---|---|---|
| Backup JSON ordinario | Scansione cloud `all`, envelope locale riletto, pending riapplicate e copertura dichiarata | Non è uno snapshot atomico fra dispositivi |
| Recupero protetto con UI bloccata | Prove owner-scoped stabili; file marcato **parziale** | Non abilita hydration, upload o reimport automatico |
| Export diritti dopo revoca | Gate trusted rights-only, checkpoint e ADK esistente, **se** il job di erasure non è in corso | Non riattiva fitness o sincronizzazione; non garantisce un backup completo dopo l'avvio automatico del job |
| Import/restore business | Validazione lossless e commit con esito `SyncResult` | `local-pending` non è ACK cloud; witness grezzi non sono bozze portabili |
| CSV | Campi esplicitamente mappati e output salvati | Non equivale a un backup JSON recuperabile |

Il percorso rapido `Exporter.exportEmergencyJSON()` richiamato dalla protezione del logout e dal dialogo dei conflitti nutrizionali è **distinto** dal recupero protetto della tabella: esporta il solo `userData` in memoria con copertura `device`, senza scansione cloud, envelope/journal o testimoni `recovery.device`. Non prova che tutte le modifiche e le copie device-only siano incluse e non costituisce conferma del salvataggio effettivo da parte del browser. L'azione «Esporta» nel dialogo di logout interrompe il logout; il file rapido non è una prova che un successivo logout forzato sia privo di rischio. Il download rapido MUST rifiutare un `userData` non più identico allo stato dell'owner/sessione corrente: un dialogo asincrono può conservare un riferimento del precedente account, che non deve essere etichettato come backup del nuovo proprietario. Non attribuire a questo percorso le garanzie del backup completo o del recupero protetto.

La replica cloud automatica non costituisce un backup indipendente dalla custodia delle chiavi. Perdita del profilo con dati solo offline o della KEK cloud senza copia ripristinabile può rendere irrecuperabili i dati: vedere [Archivio e cifratura](secure-storage.md).

## Backup JSON e importazione

**MUST (CRITICAL, backup di recupero con UI bloccata):** quando il consenso è attivo ma una copia device-local di workout non è attribuibile con certezza alla revisione corrente e impedisce la hydration, l'esportazione esplicita dei dati locali deve rimanere accessibile. Il backup è solo device-only, marcato parziale e deve richiedere conferma informata, senza tentare flush, reimport automatico o abilitazione della replica. Deve includere anche i witness immutabili `workout-intent:<id>` e `history-editor-context` validi per nome nello spazio owner-scoped, come prove originali grezze non automaticamente riproducibili. Nessun backup locale sintetico se mancano sia envelope sia record di recupero; se un record esiste ma scompare durante la lettura, rifiutare la copia vuota. La revoca del consenso conserva il boundary separato di esportazione diritti via backend trusted **solo negli stati in cui il job di cancellazione lo consente**: la revoca trusted accoda automaticamente l'erasure e l'export completo non è garantito dopo la conferma. Il backup facoltativo è quindi proposto prima della revoca, senza impedire di revocare. I file JSON di backup sono in chiaro: l'utente deve custodirli in modo riservato.


`src/lib/backup.ts` usa il formato corrente `logbook-backup` **Backup Schema 3**, con owner, data di esportazione, copertura, `UserData`, versioni data/sync e recovery locale. `src/lib/db/backupSnapshot.ts` legge il root e tutte le pagine mensili di storico/nutrizione dal server, normalizza i documenti cloud, poi rilegge l'envelope locale più recente e riapplica le pending operation quando presenti. Gli originali cloud e il registro locale sono inclusi nella sezione recovery prevista dal formato corrente.

L'esame in sola lettura delle testimonianze `draft:buffered-intent:*` e `draft:dated-intent:*` del dispositivo è disponibile solo su azione esplicita, con consenso e sessione corrente. Mostra le copie ma non recupera valori nel business state, non ripristina bozze da backup, non elimina gli originali e non sostituisce l'esportazione JSON.

Il backup completo rifiuta documenti mancanti o causalmente obsoleti rispetto alla copia locale, o una barriera cloud ancora attiva. Resta disponibile l'esportazione limitata al dispositivo. **MUST:** se il recupero cloud fallisce e non esistono né un envelope locale leggibile né dati validi già presenti nello stato dell'owner corrente, la UI NON deve fabbricare un backup device-only usando valori predefiniti vuoti. Deve segnalare l'assenza di una fonte locale, mantenendo invece possibile l'esportazione rights/cloud riuscita anche in assenza dell'envelope locale.

La lettura di tutti i documenti non costituisce uno snapshot atomico fra dispositivi. Il file registra la propria copertura; con modifiche concorrenti può essere necessario ripetere l'esportazione. Un errore di rete non deve produrre un backup dichiarato completo se la copertura richiesta non è stata acquisita.

**MUST (CRITICAL, coerenza delle prove device in Backup JSON):** l'elenco fisico delle chiavi owner-scoped `workout`, `timer`, `history-editor-context`, `draft:*` e `workout-intent:<id>` va acquisito prima di leggere le copie. Un secondo elenco deve corrispondere all'insieme originale e ogni contenuto decifrato/validato deve risultare invariato a una seconda lettura. Una chiave scomparsa, aggiunta, ambigua o cambiata durante il backup invalida l'intera esportazione e richiede retry, senza generare un file apparentemente completo né modificare le copie.

La verifica preliminare che decide se esiste una fonte di recupero locale deve usare la stessa acquisizione stabile dell'elenco e dei valori: una chiave non rilevata per spostamento degli indici durante la scansione non può autorizzare una conclusione «nessuna copia disponibile». In caso di concorrenza osservabile, bloccare il tentativo e permettere di riprovare conservando gli originali. Questa verifica individua gare osservabili tra schede, **non** è una transazione atomica di `localStorage` e non prova assenza di interleaving invisibili (ABA). Non escludere mai prove indipendenti per mascherare i conflitti.

L'importazione JSON utilizza una lettura semplice fino a 64 MiB e un **parser JSON incrementale** sopra tale soglia: 64 MiB è la soglia di scelta del percorso, **non** un limite alla dimensione recuperabile. Il parser legge blocchi da 256 KiB e non materializza una seconda stringa con l'intero contenuto del file. Mantiene gli stessi controlli di schema, owner e validazione prima della conferma e del salvataggio. I dati decodificati, le normalizzazioni e la preparazione del merge richiedono ancora memoria proporzionale all'archivio: su dispositivi con poca RAM non è garantito il ripristino di qualunque dimensione.

Errori di lettura/parsing o cambio sessione non devono modificare i dati. Non cambia Backup Schema 3 e non tronca il backup. Il CSV è un export analitico, non un backup ripristinabile. La replica Firestore non è un backup versionato indipendente: cancellazione account, browser storage cancellato o chiave locale perduta possono rendere irrecuperabili le copie disponibili. Una copia JSON esplicita, protetta e verificata dall'utente può fornire recupero esterno; non è un'attività periodica obbligatoria per usare la PWA.

La baseline clean-cut corrente **non importa Backup Schema V1/V2**: `decodeImport()` li rifiuta tramite `LegacyVersionError`. Anche versioni future sconosciute falliscono chiuso e richiedono aggiornamento. Non esiste più un percorso prodotto che legga, preservi o esporti la vecchia cache locale non attribuita `logbook_cached_user_data`: il compatibility layer fu rimosso nella baseline pre-lancio. La baseline fresh start elimina il supporto di tali formati, non i controlli sulla sicurezza dei nuovi dati.

- **Importa JSON:** opera soltanto su formati supportati e applica l'unione prevista senza mutazioni in place. Un `activeWorkout` non nullo ma invalido nel backup blocca l'importazione con un errore esplicito, senza scartarlo in silenzio; il file sorgente resta invariato. Le collisioni e i ricalcoli seguono il contratto corrente dell'importer.

### Recuperi device separati dall'importazione business

Dopo l'importazione business, un consenso separato permette di recuperare solo bozze device presenti nel backup e ancora assenti sul dispositivo. **MUST (CRITICAL, testimonianze non portabili):** `draft:buffered-intent:*`, `draft:dated-intent:*` e le altre testimonianze tecniche restano nella sezione grezza `recovery.device` del file esportato, ma NON sono bozze portabili: non vengono contate nel limite delle bozze ripristinabili, non sono ripristinate automaticamente o con il consenso generico alle bozze, e la funzione di restore deve rifiutarle anche se invocata direttamente. Mostrare nell'anteprima che tali prove restano soltanto nel file originale, senza promettere replay o conversione di owner/epoch. Il recupero delle bozze vere continua a prevedere: il flush delle bozze correnti precede il controllo strict e le write cifrate owner-scoped, senza sovrascrivere copie locali. Il recupero opzionale ammette fino a 1.024 bozze, ciascuna non oltre 100.000 caratteri e massimo 1.000.000 di caratteri complessivi; il limite non è quello di 64 testimoni concorrenti per singolo campo. Se la sezione opzionale supera tali limiti o contiene bozze malformate, l'anteprima avvisa chiaramente che **nessuna bozza** verrà ripristinata durante l'importazione, ma consente l'importazione separata dei dati business validi; il file originale deve essere conservato per recupero ulteriore. Nessuno scarto silenzioso o replay cross-epoch. Fallimenti parziali delle bozze sono segnalati e il backup originale rimane fonte di recovery.

Un recupero separato e confermato dell'allenamento device-local può eseguire una nuova DomainOperation solo se non esiste una sessione locale, non è già nello storico e non sostituisce un diverso activeWorkout. I vecchi intenti/generazioni e il journal NON vengono trapiantati: il commit locale crea il journal corrente.

Solo dopo quel commit è ammesso ripristinare un timer mancante, convertendo lo stato running in paused all'istante dell'export. Non promettere continuità temporale tra dispositivi e non sovrascrivere alcun record esistente.

### Restore e conferma della specifica importazione

- **Ripristina:** sostituisce i campi presenti nel formato supportato rispetto allo stato locale disponibile; non autorizza a trattare dati cloud mai caricati come assenti.

- L'anteprima/commit deve invalidarsi se cambia sessione o baseline rilevante durante l'operazione.

- La conferma segue la persistenza locale; offline non va presentata come conferma cloud. **MUST:** l'importazione controlla l'esito tipizzato `SyncResult` di `saveUserData`: il solo completamento della Promise non è prova di commit; `failed`/`rejected` arrestano il flusso prima di recuperi device e conferme, mentre `local-pending` può essere dichiarato solo come dato salvato localmente e non cloud-acknowledged. Il messaggio deve usare l'esito della specifica importazione, non uno stato di sync globale che può essere cambiato da altre operazioni.

- **MUST (CRITICAL, import senza perdita):** prima dell'anteprima e prima che collisioni o parsing dell'allenamento attivo nascondano valori originali, verificare che tutti i campi business selezionati del backup corrente sopravvivano al gateway Zod. Ripetere il confronto sul risultato di merge/restore prima dei ricalcoli derivati e del commit. Chiavi scartate, record quarantinati e fallback che sostituiscono valori interrompono l'importazione senza salvataggio o recuperi device successivi; preservare file originale e dati locali. Restano ammesse conversioni scalari reversibili, default per campi assenti, la policy esplicita delle collisioni e il ricalcolo dei totali nutrizionali. Le esclusioni intenzionali share/consenso e le prove grezze opzionali di recovery non sono campi business da importare. Anche il recupero opzionale del workout confronta lo snapshot business originale con quello validato prima della nuova Domain Operation: un fallback lossy blocca quel recupero, preserva il file e non avvia il ripristino del timer. Il formato e le versioni del backup restano invariati.

- I consensi importati non sostituiscono l'accettazione corrente.

- Nel merge ospite → account, il consenso legale ospite non è trasferibile: `legalConsent` resta quello già associato all'account, se presente; per un account nuovo serve una nuova accettazione esplicita.

- Non inventare conversioni V1/V2 per aggirare la baseline clean-cut.

## Esportazione CSV

`buildCsvFiles` in `src/lib/csvExport.ts` genera in modo deterministico dal dataset disponibile in memoria `allenamenti.csv`, `misurazioni.csv` e, quando presenti, `passi.csv` e `cardio.csv`. `Exporter.exportToCSV` orchestra esclusivamente l'avviso per lo storico vuoto e il salvataggio sequenziale, con annullamento che interrompe gli output successivi. `Exporter.downloadFile` aggiunge il BOM UTF-8 al contenuto CSV prima del salvataggio. È un export analitico tabellare: il CSV non ha la completezza del percorso Backup JSON cloud paginato e la UI non deve presentarlo come copia completa o ripristinabile.

- **MUST:** I CSV includono il BOM UTF-8 per compatibilità Excel. Markdown, sorgenti e JSON restano UTF-8 senza BOM.
- **MUST:** Nuove metriche business da esportare devono essere mappate esplicitamente nel contratto tipizzato CSV oppure classificate deliberatamente come escluse.
- **MUST:** Le date business giornaliere usano `YYYY-MM-DD`; gli istanti evento separati usano ISO UTC.
- **MUST:** Un’operazione CSV multi-file termina soltanto dopo che tutti gli output previsti hanno concluso il proprio salvataggio o dopo un annullamento/errore esplicito.

## Metadati e recovery del formato corrente

Gli export backup/share/emergency usano la factory e le versioni correnti di `src/lib/schemaEvolution.ts`. Il recovery raw cloud può conservare gli originali con `_schemaVersion`/`_sync`, ma lo snapshot business usa soltanto dati autenticati e normalizzati ed esclude tali metadati dal modello `UserData`.

I consensi importati non autorizzano il cloud o il trattamento account; leggere [Consenso salute](health-consent.md). Provenienza e witness device restano disciplinati da [Bozze e stato device](device-drafts.md); chiavi e ciphertext da [Archivio e cifratura](secure-storage.md). La verifica canonica è in [Verifica CI](ci-verification.md).

## CF-05 — JSON diritti Kinde candidato, non backup di ripristino (19/11/2026)

`src/lib/auth/kindeCandidateRightsExport.ts` compone la scansione rights-only
Kinde/D1 con AEAD e controlli sessione prima di costruire un JSON esplicito
(`thelogbook-cloud-rights-export`, versione 1). Il file conserva business e
metadati causali dei soli documenti cloud **ancora leggibili**; la copertura
`not-proven-after-withdrawal` non attesta l'archivio originale: il job di
cancellazione può già essere in corso. Sono esclusi dati locali, bozze e
journal non consegnati. Non è un `logbook-backup` Schema 3 e non può essere
importato come copia completa. La preparazione fallisce senza file su errori
di autenticazione, CSRF, rete, AEAD, revisione, formato o limite JSON di
64 MiB. La richiesta di download non certifica il salvataggio del browser.

Il percorso resta **candidato non montato nel frontend pubblico**: prima di
offrirlo in Impostazioni bisogna comporre i dati locali e la UX di consenso,
proporre un backup facoltativo prima della revoca e verificare con browser
e provider isolati. Non modificare `D1_API` pubblico per questo incremento.

## CF-05 — evidenze distinte prima della revoca Kinde (candidato 19/11/2026)

`src/lib/auth/kindeCandidatePreWithdrawalExport.ts` offre una preparazione
**esplicita e in sola lettura** quando il consenso Kinde/D1 e' ancora
`active`. Richiede il vault device corrente **gia' sbloccato**, senza
crearlo, inizializzare un envelope, modificare dati o inviare journal.
`inspectKindeCandidateCloudCheckpoint` verifica sessione, CSRF,
consenso e scansione cloud completa alla revisione osservata, con apertura
AEAD di ogni documento. Il nuovo `backupDeviceSnapshot.ts` riusa la
lettura rigorosa dei record device dell'export Firebase, senza importare
Firebase: l'envelope IndexedDB validato comprende business, baseline,
journal in attesa e intenti D1, mentre localStorage conserva workout,
timer, bozze e testimonianze tecniche raw ancora riconoscibili.

La composizione ripete lettura IndexedDB e inventario/valori di recupero
prima di produrre il JSON: cambi rilevabili, corruzione, owner/consenso
incoerente o vault sostituito falliscono senza download. Questo **non**
crea uno snapshot atomico fra D1, IndexedDB e schede. L'export
`thelogbook-prewithdrawal-evidence` versione 1 mantiene sezioni cloud
e device separate, con provenienza e intestazione `restorableBackup:false`.
**Non e' un Backup Schema 3** e non deve essere passato all'importer come
dataset ricostruito; non inventare merge, ACK o ripristino automatico.
La copia può includere dati salute in chiaro nel file scaricato e
va custodita privatamente. La dimensione massima del JSON candidato
in memoria e' 64 MiB; il click di download non prova il salvataggio.

Questa e' una fase preparatoria, **non collegata alla PWA pubblica**.
Prima di offrire una funzione di backup/ripristino completo occorrono
composizione causale lossless, gestione di copie orfane/bozze e UI
esplicita prima della revoca, con test isolati browser/provider. Non
abilitare il binding pubblico `D1_API` in base al solo test candidato.

## CF-05 — preparazione di un Backup Schema 3 Kinde prima della revoca (candidato 19/11/2026)

Il candidato `src/lib/auth/kindeCandidatePortableBackup.ts` riusa la
raccolta read-only `captureKindeCandidatePreWithdrawalSources()` e il
motore causale di sincronizzazione `applySemanticOperations()`, anziché
creare un secondo algoritmo di merge. Dopo una scansione D1 completa e
AEAD autenticata, valida senza perdita root e shard mensili, metadati
causali e frontiera cloud rispetto agli ACK locali. Include il journal
pendente soltanto quando il risultato conserva integralmente i dati
locali e i documenti coinvolti corrispondono alla proiezione locale.
Una copia mancante, uno shard corrotto, un frontier arretrato, una
transizione `cloudflareDelivery`/`claim`/`retirement` ancora
irrisolta, un fence di integrità o un conflitto impediscono il backup
completo: l'esportazione `thelogbook-prewithdrawal-evidence` resta
separatamente disponibile senza fusione né falso successo.

Il JSON importabile usa l'attuale `logbook-backup` Schema 3; conserva
in `recovery` i documenti cloud originali decifrati, il LocalEnvelope
con journal e intenti e le testimonianze device. L'import business
passa da `decodeImport` e mantiene l'owner; i testimoni tecnici e il
journal grezzo non sono automaticamente trapiantati come ACK o riprodotti
sull'account di destinazione.

Prima di pubblicare un file definito importabile, il candidato esegue
anche `prepareImport(..., 'restore')` **sullo stesso dataset** usando
un account inizialmente vuoto con il consenso corrente indipendente.
L'intero stato `UserData` risultante deve coincidere con i dati del
backup, non soltanto superare la lettura Schema 3: altrimenti si blocca
l'export senza generare un file dichiarato completo. La simulazione è
in memoria, non esegue commit locale, ripristino di bozze o sync D1.
È necessaria una successiva integrazione dell'importatore Kinde con
journal durevole e conferme corrette, seguita da test restore su dispositivo
pulito: il solo controllo non prova un recupero fisico o cloud. Le operazioni device e cloud non hanno
un'unica transazione: la doppia lettura iniziale di IndexedDB/localStorage,
seguita da un'ulteriore verifica dopo il caricamento asincrono del catalogo
e la composizione del JSON, rileva corse osservabili senza promettere
atomicità cross-tab o recupero di scritture mai registrate su dispositivo. Il controllo prima di costruire
il file è in sola lettura e non sincronizza né revoca dati.

La separazione di `backupDeviceDraftSelection.ts` ha eliminato la
dipendenza transitiva da `deviceStorage` e Firebase nel parser
`backup.ts`; il writer di restore conserva i suoi guard. La
preparazione resta **non montata nell'interfaccia pubblica**, che rimane
identity-only. Non pubblicare D1 API o promettere GO da questa prova.
Un file JSON contiene dati sanitari leggibili: il salvataggio resta
volontario e sotto custodia esplicita dell'utente; la preparazione non
garantisce il click o la disponibilità della copia indipendente.
