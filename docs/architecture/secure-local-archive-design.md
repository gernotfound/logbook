# TheLogBook — protezione automatica dei dati locali (CRITICAL)

> **Specifiche di prodotto approvate il 12 ottobre 2026.** Nessuna passphrase locale, PIN aggiuntivo, recovery code da annotare o popup ordinario di sblocco. La presente specifica sostituisce integralmente il precedente progetto con passphrase. **Rilasciato:** PR #369 integrata in `main` con squash commit `5d21dc0b32a12676e1a08cc35611d96e5b18c3f3`; CI canonica, CI post-merge e Firebase Hosting Production verificati il 12 ottobre 2026. Lo smoke autenticato multi-dispositivo, le verifiche visive manuali e la validazione giuridica pre-pilot restano attività distinte.

## 1. Requisito e limiti reali

L'accesso dell'utente autenticato rimane quello **Firebase Auth già esistente**. Dopo la conferma dell'UID ed i gate legali/consenso, la PWA prepara e apre **automaticamente** il proprio archivio locale; la sessione guest resta confinata alla generazione guest corrente. Su browser già inizializzato, la chiave protetta del dispositivo deve funzionare offline, senza chiedere un secondo segreto.

Non è tecnicamente corretto usare UID, ID token Firebase, password Firebase non accessibile al client, API key o informazioni pubbliche dell'account per derivare la chiave di cifratura. Firebase Auth autorizza l'identità; una chiave **casuale del dispositivo** svolge la cifratura. L'owner ID compare nei metadati autenticati, separa i contenitori e vincola ogni ciphertext, ma non è un segreto crittografico.

**Threat model esplicito:** la cifratura protegge copie isolate di LocalEnvelope, journal, localStorage e snapshot dall'analisi accidentale in chiaro; una **copia integrale del profilo browser** può includere anche la chiave non esportabile conservata in IndexedDB e può quindi consentire la decifratura. Inoltre XSS, estensioni malevole, browser/OS compromessi e codice eseguito nell'origine TheLogBook possono usare la chiave, anche se `extractable: false`. Non chiamare questo sistema E2EE, né protezione equivalente a una passphrase indipendente o a un HSM. Firestore non diventa end-to-end encrypted.

## 2. Chiavi e formato

- Per ciascun owner/device, generare una **DEK casuale da 256 bit** per i record. Non persisterla come bytes in chiaro.
- Generare tramite Web Crypto una wrapping key **AES-GCM-256, `extractable: false`**, con sole usage `encrypt`/`decrypt`. Salvare il `CryptoKey` mediante structured clone in IndexedDB in `logbook:v2:${owner}:device-vault-key`.
- Wrappare la DEK con AES-GCM, nonce random a 96 bit, additional authenticated data che incorpora applicazione, owner, scopo, formato e versione. Memorizzare nell'owner `secure-vault-control` soltanto DEK wrappata, nonce, fase e epoch. Versionare e validare rigorosamente metadati e chiavi.
- I record del LocalEnvelope e dei device snapshot sono cifrati con XChaCha20-Poly1305 **sincrono**, AAD owner/key/path/version, nonce random 192 bit diverso per scrittura, parsing/limiti dimensionali fail-closed. La chiave raw è in RAM nella sola sessione sbloccata; logout, cambio owner e revoca guest invalidano il relativo handle.
- Il key material resta **locale al profilo browser**. La stessa identità Firebase su altro device ottiene un'altra chiave e ricostruisce i dati già sincronizzati dal cloud, senza condividere la chiave.
- La chiave persa/corrotta NON va ricreata se esiste ciphertext: bloccare, preservare byte originali e offrire il normale percorso di supporto/recupero dal cloud senza cancellare automaticamente le operazioni rimaste soltanto offline.

## 3. Persistenza e migrazione

IndexedDB `logbook:v2:${owner}` contiene LocalEnvelope V5, dati, causal state, pending journal, workout ledger e consent epochs. I commit mantengono una sola transazione `idb-keyval.update` con decrypt/mutate/encrypt **sincroni** dentro la callback; non introdurre Promise né `get` → `set` separati. L'ack del journal e i merge rispettano causalità/atomicità esistente.

`deviceStorage` protegge i salvataggi **sincroni** di workout, timer, bozze datate, editor e recovery. Usare namespace `sealed:` per separare i nuovi payload dai writer PWA legacy e riconoscere eventuali dati old-tab riapparsi in chiaro. Marker di cancellazione, consenso, epoche e necessità di update possono rimanere fuori dal ciphertext nella misura strettamente necessaria ai gate pre-bootstrap; nessun payload salute deve restare in chiaro.

La coda diagnostica tecnica usa lo stesso vault owner-scoped per cifrare i report con AEAD nel namespace `sealed:telemetry_queue`, ma resta best-effort e distinta dai dati business: prima dello sblocco può trattenere i report soltanto nella RAM della scheda. Con vault disponibile, le vecchie code plaintext sono cifrate e verificate prima del cleanup; con vault bloccato, i report validi passano in RAM e il vecchio plaintext diagnostico viene rimosso, quindi una chiusura della scheda può perderli. Il ciphertext illeggibile non viene eliminato per forzare una nuova coda. Retention logica: sette giorni per report, massimo 50, con pruning del disco al successivo accesso.

Migrazione crash-safe: `none → migrating → active` con durable metadata scritto PRIMA di toccare i dati, lock multi-tab, convert/read-back verificati, idempotenza se un record è già cifrato e cleanup delle copie precedenti solo dopo verifica. Un errore di storage, versione futura, owner incongruente, AEAD, schema o conflitto con tab legacy BLOCCA la conversione senza cancellazione. La stessa chiave di dispositivo va riaperta dopo un crash: non generare nuove chiavi per un vault incompleto.

## 4. Auth, guest, recovery e lifecycle

- Non caricare dati sanitari di un UID suggerito dall'owner hint **prima** della conferma Firebase Auth dell'UID. Guest ha own generation fence; guest→account mantiene i due owner separati e migra i dati attraverso il percorso già attestato in memoria.
- Offline-first non equivale a login remoto: ripresa dei dati account offline solo quando Firebase Auth dispone di una sessione locale legittima e il dispositivo possiede già la chiave. Il device può usare localmente l'ultimo **consenso attivo confermato dal server** e la stessa generazione, ma non un consenso mai verificato, una revoca/intento locale, un nuovo epoch o un marker illeggibile. Il cache marker owner-scoped è un gate di disponibilità offline, **non un'autorizzazione per il cloud**.
- Alla riconnessione (`online`) e al ritorno in primo piano si rilegge lo stato autorevole tramite backend con App Check **prima** di hydration e di qualsiasi replica journal; il passaggio offline invalida l'autorizzazione cloud in memoria ma non blocca le modifiche locali autorizzate. Se il server ha revocato il consenso, tutte le modifiche fitness cessano e il journal accumulato viene preservato localmente senza trasmissione/cancellazione automatica. Se la verifica online fallisce, il cloud rimane bloccato; la ripresa offline richiede una precedente verifica positiva e una sessione Auth valida.
- Una revoca remota non può tecnicamente essere percepita mentre il dispositivo è disconnesso: rischio/privacy da valutare prima del pilot con utenti reali. Le Security Rules Firestore restano il gate server-side per impedire le write dopo revoca, indipendentemente dal timing del client.
- Dopo logout non eliminare i dati fino al completamento del protocollo di purge richiesto; un errore o un pending journal impediscono di affermare una pulizia riuscita. In un purge riuscito, rimuovere DEK/ciphertext e **solo dopo** la chiave di dispositivo; fallimenti intermedi devono lasciare dati recuperabili e un percorso idempotente di retry.
- Se un account è già stato cancellato lato server, la receipt e il recovery non devono richiedere lo sblocco per completare la pulizia **dopo verifica server `complete`**.
- Backup JSON esplicito di dati già autorizzati e sbloccati può contenere plaintext dichiarato come tale; preservare separazione fra dati cloud, pending journal e snapshot device. Il logout o una cancellazione non autorizzano implicitamente perdita di modifiche offline.
- Quando il dispositivo perde chiave e ciphertext o perde solo la chiave, dati **già sincronizzati** sono recuperabili da Firestore previo login; modifiche **solo offline** non sono ricostruibili crittograficamente. Non promettere il contrario.

## 5. Criteri di rilascio

Test obbligatori: KAT/roundtrip AEAD, integrità AAD, owner mistmatch, nonce, versioni future, wrapped key danneggiata, key missing, autenticazione account guest, offline cold start, quota/IndexedDB denied, migrazione crash per ogni fase, Web Locks iOS/WebKit, multi-tab e vecchie PWA, pending journal/ack/replay, guest→account, revoca consenso, import/export, account deletion/recovery, logout parziale, reload e theme/layout mobile. Scansione **bytes at rest** di LocalEnvelope, device snapshot e pending journal per contenuti sanitari noti. Non testare la promessa di protezione contro furto integrale profilo: è fuori dal modello.

Gate: `verify:m8` o CI canonica equivalente sullo SHA esatto, CodeQL, review, controlli statici, Firestore Rules, Playwright mobile, visivi dark/light, nessun blocker. Poi squash merge, main CI post-merge, Firebase Hosting Production e smoke (Vercel solo se diff backend). Non rilasciare una PR draft incompleta.
