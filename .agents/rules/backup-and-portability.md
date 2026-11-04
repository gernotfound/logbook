# Backup, importazione e portabilità — TheLogBook

**Quando leggere:** Backup JSON, share, merge/restore, recupero device e CSV.
**Non inferire:** replica Firestore, file JSON/CSV, prove grezze e journal riprodotto sono copie e autorizzazioni differenti.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Perimetro e fonti

Applicare il fresh start e la protezione dei dati correnti di AGENTS. Fonti: `src/lib/backup.ts`, `src/lib/db/backupSnapshot.ts`, `src/lib/backupDeviceRecovery.ts`, `src/lib/backupWorkoutRecovery.ts`, `src/lib/streamJsonImport.ts`, `src/lib/csvExport.ts`, hook delle impostazioni e importer.

**MUST (UX):** nessun backup periodico manuale richiesto: lo storage cifrato e la replica cloud dei dati business autorizzati sono automatici. Backup JSON resta una funzione volontaria di portabilità. Non descriverlo come requisito ordinario di protezione, né promettere che sessioni guest, bozze device-only o modifiche mai sincronizzate sopravvivano alla perdita totale del profilo.

## Backup JSON e importazione

**MUST (CRITICAL, backup di recupero con UI bloccata):** quando il consenso è attivo ma una copia device-local di workout non è attribuibile con certezza alla revisione corrente e impedisce la hydration, l'esportazione esplicita dei dati locali deve rimanere accessibile. Il backup è solo device-only, marcato parziale e deve richiedere conferma informata, senza tentare flush, reimport automatico o abilitazione della replica. Deve includere anche i witness immutabili `workout-intent:<id>` e `history-editor-context` validi per nome nello spazio owner-scoped, come prove originali grezze non automaticamente riproducibili. Nessun backup locale sintetico se mancano sia envelope sia record di recupero; se un record esiste ma scompare durante la lettura, rifiutare la copia vuota. La revoca del consenso conserva invece il percorso separato di esportazione diritti via backend trusted, quando applicabile. I file JSON di backup sono in chiaro: l'utente deve custodirli in modo riservato.


`src/lib/backup.ts` usa il formato corrente `logbook-backup` **Backup Schema 3**, con owner, data di esportazione, copertura, `UserData`, versioni data/sync e recovery locale. `src/lib/db/backupSnapshot.ts` legge il root e tutte le pagine mensili di storico/nutrizione dal server, normalizza i documenti cloud, poi rilegge l'envelope locale più recente e riapplica le pending operation quando presenti. Gli originali cloud e il registro locale sono inclusi nella sezione recovery prevista dal formato corrente.

L'esame in sola lettura delle testimonianze `draft:buffered-intent:*` e `draft:dated-intent:*` del dispositivo è disponibile solo su azione esplicita, con consenso e sessione corrente. Mostra le copie ma non recupera valori nel business state, non ripristina bozze da backup, non elimina gli originali e non sostituisce l'esportazione JSON.

Il backup completo rifiuta documenti mancanti o causalmente obsoleti rispetto alla copia locale, o una barriera cloud ancora attiva. Resta disponibile l'esportazione limitata al dispositivo. **MUST:** se il recupero cloud fallisce e non esistono né un envelope locale leggibile né dati validi già presenti nello stato dell'owner corrente, la UI NON deve fabbricare un backup device-only usando valori predefiniti vuoti. Deve segnalare l'assenza di una fonte locale, mantenendo invece possibile l'esportazione rights/cloud riuscita anche in assenza dell'envelope locale.

La lettura di tutti i documenti non costituisce uno snapshot atomico fra dispositivi. Il file registra la propria copertura; con modifiche concorrenti può essere necessario ripetere l'esportazione. Un errore di rete non deve produrre un backup dichiarato completo se la copertura richiesta non è stata acquisita.

**MUST (CRITICAL, coerenza delle prove device in Backup JSON):** l'elenco fisico delle chiavi owner-scoped `workout`, `timer`, `history-editor-context`, `draft:*` e `workout-intent:<id>` va acquisito prima di leggere le copie. Un secondo elenco deve corrispondere all'insieme originale e ogni contenuto decifrato/validato deve risultare invariato a una seconda lettura. Una chiave scomparsa, aggiunta, ambigua o cambiata durante il backup invalida l'intera esportazione e richiede retry, senza generare un file apparentemente completo né modificare le copie.

La verifica preliminare che decide se esiste una fonte di recupero locale deve usare la stessa acquisizione stabile dell'elenco e dei valori: una chiave non rilevata per spostamento degli indici durante la scansione non può autorizzare una conclusione «nessuna copia disponibile». In caso di concorrenza osservabile, bloccare il tentativo e permettere di riprovare conservando gli originali. Questa verifica individua gare osservabili tra schede, **non** è una transazione atomica di `localStorage` e non prova assenza di interleaving invisibili (ABA). Non escludere mai prove indipendenti per mascherare i conflitti.

L'importazione JSON utilizza una lettura semplice fino a 64 MiB e un **parser JSON incrementale** sopra tale soglia: 64 MiB è la soglia di scelta del percorso, **non** un limite alla dimensione recuperabile. Il parser legge blocchi da 256 KiB e non materializza una seconda stringa con l'intero contenuto del file. Mantiene gli stessi controlli di schema, owner e validazione prima della conferma e del salvataggio. I dati decodificati, le normalizzazioni e la preparazione del merge richiedono ancora memoria proporzionale all'archivio: su dispositivi con poca RAM non è garantito il ripristino di qualunque dimensione.

Errori di lettura/parsing o cambio sessione non devono modificare i dati. Non cambia Backup Schema 3 e non tronca il backup. Il CSV è un export analitico, non un backup ripristinabile. La replica Firestore non è un backup versionato indipendente: cancellazione account, browser storage cancellato o chiave locale perduta possono rendere irrecuperabili le copie disponibili. Una copia JSON esplicita, protetta e verificata dall'utente può fornire recupero esterno; non è un'attività periodica obbligatoria per usare la PWA.

La baseline clean-cut corrente **non importa Backup Schema V1/V2**: `decodeImport()` li rifiuta tramite `LegacyVersionError`. Anche versioni future sconosciute falliscono chiuso e richiedono aggiornamento. Non esiste più un percorso prodotto che legga, preservi o esporti la vecchia cache locale non attribuita `logbook_cached_user_data`: il compatibility layer fu rimosso nella baseline pre-lancio. La baseline fresh start elimina il supporto di tali formati, non i controlli sulla sicurezza dei nuovi dati.

- **Importa JSON:** opera soltanto su formati supportati e applica l'unione prevista senza mutazioni in place. Un `activeWorkout` non nullo ma invalido nel backup blocca l'importazione con un errore esplicito, senza scartarlo in silenzio; il file sorgente resta invariato. Le collisioni e i ricalcoli seguono il contratto corrente dell'importer. Dopo l'importazione business, un consenso separato permette di recuperare solo bozze device presenti nel backup e ancora assenti sul dispositivo.

**MUST (CRITICAL, testimonianze non portabili):** `draft:buffered-intent:*`, `draft:dated-intent:*` e le altre testimonianze tecniche restano nella sezione grezza `recovery.device` del file esportato, ma NON sono bozze portabili: non vengono contate nel limite delle bozze ripristinabili, non sono ripristinate automaticamente o con il consenso generico alle bozze, e la funzione di restore deve rifiutarle anche se invocata direttamente. Mostrare nell'anteprima che tali prove restano soltanto nel file originale, senza promettere replay o conversione di owner/epoch.

Il recupero delle bozze vere continua a prevedere: il flush delle bozze correnti precede il controllo strict e le write cifrate owner-scoped, senza sovrascrivere copie locali. Il recupero opzionale ammette fino a 1.024 bozze, ciascuna non oltre 100.000 caratteri e massimo 1.000.000 di caratteri complessivi; il limite non è quello di 64 testimoni concorrenti per singolo campo.

Se la sezione opzionale supera tali limiti o contiene bozze malformate, l'anteprima avvisa chiaramente che **nessuna bozza** verrà ripristinata durante l'importazione, ma consente l'importazione separata dei dati business validi; il file originale deve essere conservato per recupero ulteriore. Nessuno scarto silenzioso o replay cross-epoch. Fallimenti parziali delle bozze sono segnalati e il backup originale rimane fonte di recovery. Un recupero separato e confermato dell'allenamento device-local può eseguire una nuova DomainOperation solo se non esiste una sessione locale, non è già nello storico e non sostituisce un diverso activeWorkout.

I vecchi intenti/generazioni e il journal NON vengono trapiantati: il commit locale crea il journal corrente. Solo dopo quel commit è ammesso ripristinare un timer mancante, convertendo lo stato running in paused all'istante dell'export.

Non promettere continuità temporale tra dispositivi e non sovrascrivere alcun record esistente.
- **Ripristina:** sostituisce i campi presenti nel formato supportato rispetto allo stato locale disponibile; non autorizza a trattare dati cloud mai caricati come assenti.
- L'anteprima/commit deve invalidarsi se cambia sessione o baseline rilevante durante l'operazione.
- La conferma segue la persistenza locale; offline non va presentata come conferma cloud.

**MUST:** l'importazione controlla l'esito tipizzato `SyncResult` di `saveUserData`: il solo completamento della Promise non è prova di commit; `failed`/`rejected` arrestano il flusso prima di recuperi device e conferme, mentre `local-pending` può essere dichiarato solo come dato salvato localmente e non cloud-acknowledged.

Il messaggio deve usare l'esito della specifica importazione, non uno stato di sync globale che può essere cambiato da altre operazioni.
- **MUST (CRITICAL, import senza perdita):** prima dell'anteprima e prima che collisioni o parsing dell'allenamento attivo nascondano valori originali, verificare che tutti i campi business selezionati del backup corrente sopravvivano al gateway Zod. Ripetere il confronto sul risultato di merge/restore prima dei ricalcoli derivati e del commit.

Chiavi scartate, record quarantinati e fallback che sostituiscono valori interrompono l'importazione senza salvataggio o recuperi device successivi; preservare file originale e dati locali. Restano ammesse conversioni scalari reversibili, default per campi assenti, la policy esplicita delle collisioni e il ricalcolo dei totali nutrizionali. Le esclusioni intenzionali share/consenso e le prove grezze opzionali di recovery non sono campi business da importare.

Anche il recupero opzionale del workout confronta lo snapshot business originale con quello validato prima della nuova Domain Operation: un fallback lossy blocca quel recupero, preserva il file e non avvia il ripristino del timer. Il formato e le versioni del backup restano invariati.
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
