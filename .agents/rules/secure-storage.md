# Archivio locale e cifratura cloud — TheLogBook

**Quando leggere:** vault device, provisioning, chiavi, envelope AEAD e disponibilità cloud.
**Non inferire:** cifratura locale e cloud hanno chiavi e failure path distinti; non sono E2EE né un backup indipendente.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Boundary e fonti

| Boundary | Chiave e custodia | Fonte |
|---|---|---|
| Archivio device per owner | DEK casuale wrappata con CryptoKey AES-GCM non esportabile in IndexedDB | `secureArchiveKeys.ts`, `secureArchiveSession.ts`, `secureArchiveControlRecovery.ts` |
| Local Envelope e record device | XChaCha20-Poly1305 sincrono, chiave device sbloccata | `secureArchiveCipher.ts`, `secureArchiveRepository.ts`, `deviceStorage.ts` |
| Documenti business cloud per account | ADK casuale per UID, acquisita online e non persistita nel browser | `cloudAccountKeyAccess.ts`, `cloudDocumentCipher.ts` |
| Custodia ADK trusted attiva (Firebase/Vercel) | AES-256-GCM Node con KEK server-only v1 | `server/cloudKeys/accountKeyEnvelope.ts`, `accountDataKey.ts` |
| Custodia ADK candidata Workers/D1 (CF-05, non attiva) | AES-256-GCM WebCrypto su ADK casuale e KEK secret v1 dedicata; registro D1 immutabile per consenso | `cloudflare/api/cloud-key-crypto.mjs`, `cloud-key-store.mjs`, migration `0007_cloud_key_custody.sql` |

I moduli client della tabella sono in `src/lib/sync/`. Nessuna passphrase, PIN o recovery code aggiuntivo nella UX ordinaria; identità Firebase/guest e consenso restano gate, non materiale crittografico.

## Recuperabilità per scenario

| Scenario | Copia eventualmente disponibile | Comportamento richiesto |
|---|---|---|
| Rete/Vercel assenti, vault device già attivo | Envelope e journal cifrati dello stesso profilo | Lavoro locale senza ACK cloud o downgrade plaintext |
| Profilo browser perso, cloud integro e ADK recuperabile dal backend trusted | Solo dati business già sincronizzati | Nuovo accesso con i gate account; bozze e pending esclusivamente locali non recuperabili |
| KEK globale `CLOUD_ACCOUNT_KEK_V1` persa o cambiata | Ciphertext cloud presente, ADK non recuperabile | Fail-closed; soltanto una copia indipendente verificata della **stessa** KEK può ripristinare la decifratura |
| Vault device illeggibile o ciphertext alterato | Byte locali esistenti, recuperabilità incerta | Preservare originali; bloccare provisioning, letture e purge non autorizzati |
| Consenso revocato | Dati cifrati non ancora cancellati | Niente fitness cloud; soltanto rights-only autorizzato per ADK già esistente |

La tabella non dimostra che esistano una copia indipendente della KEK o collaudi di ripristino realmente riusciti.

## Vault locale e provisioning

**MUST:** il vault `logbook:v2:${owner}:secure-vault-control` esiste in tre stati distinti: assente, `migrating`, `active`. Controlli corrotti/versioni future, una chiave IndexedDB persa o un record non autenticato **non sono** assenza dati. Nessun nuovo provisioning sopra ciphertext preesistente.

**MUST:** il controllo DEK wrappato in `localStorage` possiede un mirror owner-scoped in IndexedDB.
Il bootstrap, sotto lo stesso Web Lock di provisioning/purge, verifica entrambe le copie e può recuperare un controllo solo realmente mancante previa decifratura autenticata con la KEK non esportabile.
Corruzione, versione futura e divergenza di epoch/DEK sono fail-closed.
Le fasi `migrating` → `active` vanno pubblicate nel mirror e poi nel controllo sincrono, con verifica e recovery a crash; durante il purge il mirror è eliminato solo dopo tutte le copie cifrate, prima della KEK.
La seconda copia del wrapped control NON è backup indipendente da IndexedDB/KEK.

**MUST:** una DEK per owner/device è wrappata con AES-GCM mediante `CryptoKey` non esportabile persistito in IndexedDB, dopo aver verificato proprietario Firebase o guest generation. Il contenitore cifrato locale non deve essere associato a password, token o UID usati come chiavi. Alla ripresa offline, il runtime riapre automaticamente il vault *dello stesso browser/profilo*.

**MUST:** `localRepository` conserva la singola transazione `idb-keyval.update`, con cifratura e decifratura **sincrone**; `deviceStorage` conserva salvataggi sincroni e namespace `sealed:` separato dai vecchi writer. Ogni ciphertext usa AAD owner/key/version e nonce distinto.

**MUST:** il fresh start non converte più le copie **device-critical plaintext pre-lancio** (`workout`, `timer`, `draft:*`, `workout-intent:*`, ecc.) durante il provisioning: una copia non cifrata sospende l'attivazione senza cancellarla o creare una nuova DEK. Le copie `sealed:` autentiche, il mirror della DEK e lo stato `migrating` rimangono protetti e riprendibili dopo crash. Il provisioning non converte più envelope IndexedDB plaintext pre-lancio: se trova un record senza vault, non lo adotta, non lo modifica e non crea una nuova chiave.

Il gateway IndexedDB ordinario `secureArchiveRepository` richiede il controllo vault `active` e la DEK sbloccata per leggere o aggiornare un envelope: senza vault non restituisce plaintext né avvia scritture, preservando gli eventuali byte preesistenti. Il gateway sincrono `deviceStorage` richiede anch'esso un controllo vault `active` e la DEK sbloccata, sia per letture sia per scritture/cancellazioni; il controllo mancante non autorizza mai una scrittura o lettura plaintext. Una copia preesistente non autenticata o cifrata orfana resta invariata e blocca la lettura/scrittura ordinaria.

Un controllo sconosciuto/versione futura, AEAD invalida, conflitto fra schede o Web Lock mancante blocca la transizione. Logout e account deletion rimuovono la chiave **dopo** la prova di pulizia dei ciphertext; server deletion richiede prova `complete`.

**MUST (CRITICAL, inventario vault):** la scansione delle chiavi `localStorage` che autorizza un nuovo provisioning quando manca il controllo cifrato, o il completamento dell'attivazione corrente dopo un crash, deve rilevare modifiche osservabili fra due inventari completi (anche chiavi non dell'owner) e indici mancanti/duplicati. In caso di instabilità bloccare la transizione, non generare una nuova KEK e mantenere i record originali per il retry/recupero. Il doppio inventario rileva corse osservabili ma non è uno snapshot atomico cross-tab; una chiave cifrata orfana senza controllo non autorizza il provisioning automatico.

**VERIFY:** l'assenza di passphrase aggiuntiva limita la confidenzialità contro furto integrale del profilo browser o codice malevolo same-origin, che può raggiungere anche la wrapping key. Non è E2EE; dati solo offline possono andare persi se si perde il device/key. Non promettere recupero senza replica cloud.

## Disponibilità e formato cloud

**MUST:** il frontend ottiene una ADK casuale per-account soltanto online, da un endpoint Vercel che richiede Firebase Auth, email verificata, App Check limited-use e consenso trusted attivo. L'ADK viene wrappata dal server con AES-256-GCM usando `CLOUD_ACCOUNT_KEK_V1` in env protetto, mai derivata dall'identità utente o dalla DEK locale. Il record `user_data_keys/{uid}` è server-only; la ADK nel browser non è persistita. Il vault IndexedDB e il journal offline restano cifrati con la DEK device indipendente, utilizzabili senza Vercel.

**MUST:** i documenti `users/{uid}`, `history_months/{monthId}` e `nutrition_months/{monthId}` nel formato corrente contengono soltanto `_schemaVersion`, `_sync` pubblico (Protocol 3 / clock / writer, con `fields: {}`) e `_sealed` con nonce e payload XChaCha20-Poly1305. Sono cifrati **insieme** business e `_sync.fields` privato, autenticati anche UID, percorso, schema e coordinate causali esterne; qualunque versione ignota, ciphertext invalido, ADK sbagliata o tentativo di leggere plaintext è fail-closed senza alterare il journal. Firestore Rules **possono verificare struttura, controllo replica, owner/consenso ma non il contenuto cifrato**: Zod/integrità e merge semantico devono avvenire dopo la decifratura autentica sul client.

**MUST:** ottenere ADK prima del primissimo `sync_control/state`; `DB.loadCloudPayload` e `readAccountCloudDocument` rifiutano anche documenti root o shard apparentemente vuoti senza una ADK valida. Un documento business in chiaro non è mai una lettura cloud attendibile, nemmeno in test: le fixture di lettura devono riprodurre l'envelope `_sealed` reale. Il backend rifiuta nuove chiavi sopra root/shard/control preesistenti. Replica cloud, backup normale e rights-only richiedono la ADK. Assenza rete, Vercel non disponibile, quota o secret perduto non autorizzano downgrade plaintext né ack: la PWA conserva l'ultima copia e operazioni pendenti nel vault locale. La cancellazione sanitaria può distruggere la ADK solo nella transazione terminale verificata, mai prima dei dati cifrati; il segreto globale v1 richiede copia di sicurezza esterna indipendente e ripristino testato; non presumere che queste prove esistano perché la variabile è configurata nel provider.

## Custodia e lifecycle della chiave cloud

**Decisione di prodotto 24/10/2026:** nessun servizio a pagamento, nuova billing account o upgrade Firebase Spark→Blaze. La proposta Cloud KMS e il progetto GCP separato sono ritirati. Il modello resta Firebase Spark + backend Vercel nei limiti gratuiti consentiti. **VERIFY:** piano, quote e termini correnti del provider prima di nuovi utilizzi, soprattutto commerciali; non presumere idoneità o disponibilità illimitata a €0.

L'Account Data Key (ADK) resta una chiave casuale distinta per UID; `server/cloudKeys/accountKeyEnvelope.ts` usa AES-256-GCM di Node.js per cifrare **soltanto la ADK**, con nonce casuale, AAD legato all'UID e envelope stretto/versionato in `user_data_keys/{uid}`. La chiave globale wrapping `CLOUD_ACCOUNT_KEK_V1` è un secret server-only Vercel di **32 byte casuali in base64 canonico**. Non è derivata da UID, password, token Firebase o chiave Firebase Admin; nessuna chiave business/ADK è committata. Il backend è trusted e può materialmente recuperare la ADK: **non è zero-knowledge E2EE**.

**MUST operativo continuo:** il segreto deve essere generato e provisionato senza inserirlo in repository, CI, issue, chat, log o bundle browser; custodire una copia identica indipendente da Vercel, verificarne il ripristino in ambiente isolato, proteggere l'accesso alle variabili e assicurare che una modifica/redeploy non lo rigeneri. La perdita del segreto senza copia rende irrecuperabili tutti i documenti cloud cifrati dagli account protetti. `CLOUD_ACCOUNT_KEK_V1` mancante, malformato o diverso deve causare **fail-closed** senza creare un'altra ADK sopra documenti esistenti. Mai ruotare questa chiave senza un processo versionato che riavvolga e verifichi **tutti** gli envelope account prima di dismettere la vecchia. Il nome della variabile contiene `V1` proprio per impedire sostituzioni silenziose.

Il browser acquisisce la ADK per una singola operazione **online** autenticata da Firebase ID token + App Check limited-use; non la persiste in IndexedDB. Offline funziona il vault locale indipendente già esistente. **Nel percorso cloud supportato** la ADK è richiesta prima dei caricamenti root/mensili autenticati, della migrazione guest→account, del drain del journal e del backup normale/rights-only; il writer transazionale cifra business e metadati causali riservati, e le Rules cloud rifiutano documenti business in chiaro. Gli esiti storici di CI/deploy, registrati nel [registro esterno](../../docs/operations/external-services-register.md), sono distinti dal collaudo autenticato multi-dispositivo e dalla prova di custodia/ripristino indipendente della KEK. Non dedurre queste prove dalla presenza della variabile server.

La richiesta normale `POST /api/cloud-key` richiede Firebase ID token verificato e non revocato, claim email verificata, App Check limited-use consumabile, origin HTTPS allowlisted, consenso trusted `active` e assenza di deletion/erasure in corso. Il solo `POST /api/cloud-key?purpose=rights-export` recupera una **chiave già esistente** durante consenso `withdrawn`, senza abilitarne la creazione o la sincronizzazione; l'esportazione trusted verifica la generazione prima e dopo le pagine e il browser decifra il documento autenticato prima di creare il backup.

L'identità arriva **esclusivamente** dal token Firebase; le chiavi sono server-only in `user_data_keys/{uid}` e non accessibili alle Security Rules client; il vecchio formato cloud non deve essere convertito o sovrascritto dalla sola presenza di una nuova chiave. La cancellazione account ora cancella e verifica il record della chiave nel job trusted. La cancellazione dei soli dati sanitari conserva la chiave durante retry e pagine non ancora verificate; la rimuove atomicamente nel commit finale della cancellazione completa e controlla che manchi prima di autorizzare il purge locale.

**MUST per ogni modifica futura al contratto cifrato:** verificare insieme lettura/scrittura root e shard, backup/esportazione diritti dopo revoca, Firestore Rules restrittive, recovery PWA, `verify:m8`/CI equivalente exact-SHA, review e deploy/smoke pertinenti. Merge e CI non dimostrano da soli recuperabilità indipendente delle chiavi, assenza di errori nei flussi autenticati reali o garanzie di riservatezza ulteriori rispetto al modello di minaccia documentato.

### Candidato CF-05 — custodia ADK Workers/D1, NON pubblicata

**MUST (chiavi Cloudflare):** la ADK cloud per account è generata casualmente nel Worker, senza derivarla da Kinde, token, password, KEK o DEK device. Il codec WebCrypto `cloud-key-crypto.mjs` usa AES-256-GCM con nonce 96-bit casuale, tag 128-bit, AAD UID/versione, encoding base64 canonico e formato stretto v1. La KEK `CLOUD_ACCOUNT_KEK_V1` da 32 byte deve essere un **secret binding Workers distinto dal valore live Vercel**, non una variabile Vite; nessun secret è creato o pubblicato da questo incremento. Perdita/rotazione arbitraria della KEK impedisce il recupero dei ciphertext: una copia indipendente sicura e un restore verificato sono obbligatori prima del GO.

**MUST (provisioning):** `cloud-key-store.mjs` accetta soltanto claims provenienti dal vero AuthGate privato, con CSRF verificato; tutte le operazioni rileggono sessione, principal, email verified, consenso/epoch e stato cancellazione dalla D1 primaria **nella SELECT/INSERT**, e ripetono il controllo dopo la decifratura. La creazione è una singola INSERT condizionale che richiede il primo consenso attivo, revisione replica 0, assenza totale di ciphertext/repliche/ricevute/job non conclusi e di precedente issuance per la stessa generazione. Il trigger SQL registra nello stesso commit `cloud_key_issuance(uid, consent_revision)` in forma permanente. Un account senza chiave ma già emesso, o con dati cloud presenti, è **corrotto/incompleto, non vuoto**: non creare una nuova ADK. Concorrenza o ACK ambiguo richiedono lettura primaria del winner, mai restituzione del candidato non provato.

**MUST (rights-only e revoca):** la lettura `rights-export` dopo `withdrawn` usa esclusivamente ADK esistente e sessione ancora valida, con job di erasure per la generazione corrente. Non crea chiavi; nessun recupero ADK per principal disabilitato, sessione revocata o identità cancellata. La chiave è immutabile nella baseline e la sua cancellazione SQL è consentita soltanto con lease valido di erasure nello stato `awaiting-keys`; il registro issuance non viene cancellato. Rewrap/versione successiva, finalizzazione di CF-06, backup/restore anti-resurrection, nuova accettazione del consenso e integrazione UI richiedono gate separati: non trattare `awaiting-keys` come `complete`.

**CF-05 — HTTP candidato non distribuito (14/11/2026):** l'entrypoint
`cloudflare/api/worker.mjs` inoltra `POST /v1/cloud-key/sync`
e `POST /v1/cloud-key/rights-export` al modulo
`cloud-key-worker.mjs`. Entrambi richiedono origin HTTPS esatto,
corpo assente, cookie host-only e CSRF verificato dal service binding privato
`AUTH_GATE`; il recupero rights-only usa il percorso identity-only
ma è ancora soggetto al vincolo dell'ADK esistente e al job di erasure
attivo verificato sulla D1 primaria. Il Worker non prende UID o chiavi
dal chiamante. La risposta positiva espone **solo al browser autenticato**
la ADK in base64, indispensabile alla cifratura lato client, con cache
disabilitata; il buffer server viene azzerato. Test HTTP Node/SQLite
attraversano gli handler reali. Non equivale a endpoint pubblico,
custodia KEK provisionata né recovery remoto dimostrato.


**NON-GO:** schema 0007, modulo store e test Node/SQLite sono solo codice candidato; non esiste ancora route ADK pubblicata, autenticazione Kinde/ADK integrata nel runtime PWA, KEK Cloudflare configurata o prova della stessa semantica su D1 remota/Workers. Non dichiarare E2EE né ritorno sicuro di dati locali dopo perdita del profilo device.

## Integrazioni da preservare

- Il journal offline usa esclusivamente la chiave device; un errore ADK non può trasformare un commit locale durevole in un ACK cloud.
- Ripresa dopo crash e fase persistita `migrating` riguardano l'attivazione del vault corrente, non una conversione di plaintext pre-lancio.
- Bozze e testimoni seguono [Bozze e stato device](device-drafts.md); purge e chiavi seguono [Ciclo account](account-lifecycle.md).
- Backup JSON/CSV volontari sono file in chiaro secondo [Portabilità](backup-and-portability.md); non confonderli con il ciphertext at-rest.
- App Check, env, Rules e deploy seguono [Configurazione Firebase](firebase-config.md). Per il modello di minaccia e le prove richieste: [specifica archivio locale](../../docs/architecture/secure-local-archive-design.md).
- Gate canonico e verifiche su candidato esatto seguono [Verifica CI](ci-verification.md); collaudi autenticati, recupero indipendente KEK e quote live sono evidenze separate.
