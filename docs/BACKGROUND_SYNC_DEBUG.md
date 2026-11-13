# Debug ripresa sincronizzazione — runtime Firebase transitorio

## Ambito e precondizioni

Questa guida riguarda il **runtime ancora collegato a Firebase/Firestore**, non il candidato Cloudflare D1 isolato (PR #1070 su main, API AuthGate non distribuita). I medesimi invarianti di journal e recovery devono sopravvivere nella nuova architettura, ma timer/eventi/retry qui descritti non sono prove del suo comportamento. La guida riguarda la replica cloud di un account autenticato con sessione corrente, consenso salute verificato per il cloud e archivio locale accessibile. La modalità guest conserva i dati sul dispositivo, ma non effettua replica Firestore. Per una ripresa dopo un periodo offline devono già esistere le autorizzazioni e il checkpoint replica necessari: tornare online non li crea automaticamente.

`local-pending` è uno **stato del client** (`syncHealth`), non il formato del journal e, da solo, **non prova** che un batch sia presente e durevole in IndexedDB. Una barriera preliminare può segnalare `local-pending` prima della lettura dell'envelope; dopo un errore di trasporto, la classificazione richiede invece la prova del batch riproducibile. Non usare un indicatore UI come attestazione di persistenza o consegna.

## Comportamento corrente

Il journal owner-scoped rimane persistito nell'archivio locale cifrato e il client gestisce i tentativi di replica. Il Service Worker non legge credenziali, stato utente o journal e non invia comandi di replay.

La ripresa viene tentata al ritorno della rete (`online`) e quando la pagina torna visibile (`visibilitychange`); all'accesso autenticato esiste anche il percorso di caricamento/checkpoint e successivo drenaggio delle pending. I tentativi restano soggetti ai controlli correnti di sessione, ownership, consenso, integrità e autorizzazione: un evento browser non equivale a un permesso di scrivere nel cloud.

Quando `syncHealth` è `local-pending`, il client può pianificare retry con backoff da **20 secondi a 5 minuti**, soltanto se la sessione account è autorizzata, online e in primo piano, senza cancellazione account pendente, sync già attiva, blocco locale o aggiornamento obbligatorio. Il timer non ritenta stati `rejected` o `failed`; i browser possono sospendere o ritardare i timer, quindi l'intervallo non è una garanzia di consegna in background.

I dati locali non vengono scartati a seguito di un errore remoto. Un timeout può verificarsi **dopo** il commit Firestore: occorre preservare il journal e non inventare un ACK. Solo una consegna confermata con ACK locale verificato autorizza a dichiarare completata la replica del batch. Tornare online o vedere sparire un messaggio non è una prova sufficiente.

Safari/iOS non deve supportare la Background Sync API per consentire la ripresa **quando la PWA è in esecuzione**; non è garantita una replica mentre l'app è sospesa o chiusa. Non è registrato alcun evento Background Sync `logbook-sync`: il precedente handler, destinato a installazioni pre-lancio, è stato rimosso.

## Verifica non distruttiva

1. **Preparazione:** in ambiente di test con fixture/emulatori, usa un account autenticato con consenso cloud già confermato e replica inizializzata. Non usare la modalità guest né dati Production per provocare errori o revoche.
2. **Durabilità offline:** disattiva la rete, effettua una modifica e attendi la conferma di persistenza locale; chiudi e riapri la pagina **ancora offline** per verificare che la modifica sopravviva. Nei test, controlla direttamente l'envelope cifrato e le pending in IndexedDB: la sola visualizzazione React non dimostra che il journal sia durevole.
3. **Ripresa:** torna online o riporta la pagina in primo piano. Verifica che il replay interessi soltanto l'owner/sessione corrente e che la pending venga rimossa **solo dopo** l'ACK effettivo. In caso di errore remoto, controlla che il batch resti recuperabile, senza dichiarare un successo cloud.
4. **Barriere e recovery:** copri rete assente, risposta remota persa dopo commit, rifiuto permanente, revoca del consenso, logout, cambio di sessione anche verso lo stesso UID e `update-required`. Nessun timer deve aggirare questi blocchi; il journal altrui non va adottato né cancellato.

I test di riferimento sono `tests/isolated/sync/journalRetry.test.ts` (timer e gate), `tests/isolated/sync/cloudKeyJournalRecovery.test.ts` (ciphertext, retry, ACK e risposta perduta), oltre ai test di sessione e recovery collegati. Sono prove eseguibili con collaboratori controllati, **non** uno smoke autenticato della Production. Il contratto normativo resta in [Storage e sincronizzazione](../.agents/rules/storage-and-sync.md) e [Crash consistency](../.agents/rules/crash-consistency.md).
