# Configurazione Firebase e backend trusted — TheLogBook

**Quando leggere:** env client/server, App Check, Firestore Rules/indici, WIF, CSP, domini e deployment.
**Non inferire:** permission-denied non discrimina Auth, Rules o App Check; Emulator, provider live e Production sono prove distinte.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Tre contratti di configurazione distinti

Non trattare tutte le variabili Firebase/App Check/Admin come un unico blocco obbligatorio. Esistono tre boundary differenti: client Firebase, App Check client e server trusted.

### Client Firebase — fail-fast minimo

`src/lib/firebase.ts` controlla all'avvio quattro variabili Firebase Web obbligatorie. Se una manca o è vuota, il client lancia `Error` prima di `initializeApp`.

| Variabile | Stato corrente | Note |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | MUST | Chiave API pubblica Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | MUST | Dominio Auth; in Production Firebase Hosting deve essere `thelogbook.web.app` così popup/redirect usano lo stesso origin del frontend |
| `VITE_FIREBASE_PROJECT_ID` | MUST | Project ID |
| `VITE_FIREBASE_APP_ID` | MUST | Config Firebase Web |

Realtime Database, Firebase Storage e Cloud Messaging non sono importati dal runtime: `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_STORAGE_BUCKET` e `VITE_FIREBASE_MESSAGING_SENDER_ID` sono ritirati dal contratto client.

`VITE_ACCOUNT_DELETION_API_ORIGIN` è configurazione pubblica per raggiungere il backend trusted Vercel; non è una credenziale Firebase. Il build Firebase Hosting Production la richiede e ne controlla l'origin atteso. Il client **MUST NOT** ripiegare su un host hardcoded quando è assente: i chiamanti HTTP falliscono prima del fetch se la variabile non è configurata; i flussi che controllano la disponibilità del backend restano inerti.

**MUST:** l'accesso Vite alle env client resta statico (`import.meta.env.VITE_FIREBASE_API_KEY` ecc.). Non sostituirlo con `import.meta.env[key]`.

Le chiavi Firebase Web sono configurazione pubblica inclusa nel bundle client; la protezione dei dati dipende da Security Rules, autenticazione, App Check e configurazione backend.

## App Check — reCAPTCHA Enterprise

Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio **Fraud Defense**. Nel contratto TheLogBook corrente non esiste una seconda integrazione applicativa Fraud Defense: il client usa esclusivamente `ReCaptchaEnterpriseProvider` tramite Firebase App Check. Non dichiarare attive funzioni Account/SMS/Transaction defense o API assessment dirette senza evidenza live e codice corrispondente.

- **Provider:** `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`).
- **Bootstrap provider:** `src/lib/firebase.ts` inizializza il provider App Check prima di inizializzare Firestore. L'acquisizione del token resta asincrona e distinta dal bootstrap del provider.
- **Stato:** `src/lib/appCheck.ts` distingue provider non inizializzato, disabled, unsupported, provider-ready, token-ready, token-error ed errore di inizializzazione.

Un provider senza token non è considerato App Check attivo.
- **Support check:** manuale su runtime browser (`window.crypto`, `window.fetch`).
- **Site key canonica:** `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
- **Compatibilità storica:** il cutover Production alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` risultava verificato il 2026-09-30; lo stato odierno va controllato nel provider.

I precedenti alias `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` non fanno più parte del contratto runtime e non devono essere reintrodotti.
- **Semantica se manca la site key:** App Check entra in stato `disabled/fallback`; questa condizione **non** fa parte del fail-fast delle quattro env Firebase core e non impedisce `initializeApp` né il funzionamento locale/offline.
- **Token iniziale:** un failure di acquisizione porta a `token-error/fallback` e non viene dichiarato healthy. Non trasformare genericamente ogni `permission-denied` Firestore in “normale bootstrap noise”.

**MUST:** le richieste sensibili al backend custom Vercel (cancellazione/recovery, consenso/diritti, revoca sessioni e chiave cloud) usano token App Check limited-use; il server li verifica con `consume: true` e rifiuta token già consumati. I token standard restano appropriati per i servizi Firebase gestiti.

**VERIFY:** registrazione della site key, enforcement App Check e stato della configurazione in Firebase/Google Cloud sono esterni al repository e devono essere verificati in console quando rilevanti. Il service account Firebase Admin usato da Vercel deve avere l'autorizzazione necessaria a consumare token App Check; verificare IAM live prima del cutover.

**MUST:** nel percorso sync, un `permission-denied` osservato da `replicateJournal` resta `rejected` e non va mascherato. Retry bootstrap è accettabile solo quando la causa transitoria è identificata.

## Cifratura, consenso e privacy tecnica

Leggere [Archivio e cifratura](secure-storage.md) per ADK, `CLOUD_ACCOUNT_KEK_V1`, envelope cloud e limiti della custodia; [Consenso salute](health-consent.md) per registro trusted, diritti e generazioni; [Telemetria e privacy](telemetry-and-privacy.md) per assenza di monitoraggio esterno degli errori client. Analytics non fa parte del runtime.

## Server trusted — Firebase Admin

`server/accountDeletion/firebaseAdmin.ts` richiede queste tre env quando inizializza Firebase Admin:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

La private key supporta newline escaped (`\\n`) e viene normalizzata server-side.

`api/account-deletion-cron.ts` usa inoltre:

- `CRON_SECRET`

`CRON_SECRET` è un requisito specifico del cron: se assente, `/api/account-deletion-cron` risponde 503. Non è una variabile necessaria al bootstrap del client Vite.

**MUST:** tutte queste credenziali/config server restano server-only, senza prefisso `VITE_`, e non devono essere inserite nel bundle client o committate con valori reali.

**VERIFY:** il repository prova i nomi richiesti dal codice, non che i valori siano effettivamente provisionati in ogni environment Vercel né quali ruoli IAM siano assegnati al service account. In particolare, la replay protection App Check del backend richiede il permesso `firebaseappcheck.appCheckTokens.verify` sull'identità Admin usata da Vercel; `roles/firebaseappcheck.tokenVerifier` è il ruolo minimo da preferire se quel permesso deve essere aggiunto, ma un ruolo già assegnato che lo includa è sufficiente. Verificarlo direttamente in Google Cloud/Firebase.

## Contratto `.env.example`

`.env.example` documenta i boundary usando **solo placeholder non sensibili**:

- configurazione client Firebase/App Check (`VITE_*`);
- nomi delle env server trusted (`FIREBASE_ADMIN_*`, `CRON_SECRET`, `PUBLIC_APP_ORIGIN`, `CLOUD_ACCOUNT_KEK_V1`);

La KEK è obbligatoria per il boundary cloud cifrato corrente, non per l'avvio locale del client. Un commento template non certifica provisioning o recuperabilità del secret.

**MUST:** il template non contiene chiavi private, token, email reali, project identifier privati o altri valori di produzione. La presenza dei nomi server nel template serve soltanto a rendere esplicito il contratto runtime; i valori reali restano in Vercel/secret storage.

**MUST:** non copiare una private key reale in `.env.example`, Markdown, issue, PR, fixture o codice client.

**MUST:** `.env.production` non è un file di configurazione versionato. Production riceve i valori dal provider di deployment; CI/E2E usa valori sintetici espliciti quando necessari.

## Firestore Security Rules

Le regole private di `/users/{uid}` e delle sottocollezioni richiedono sia la proprietà dell'UID sia il claim Firebase `email_verified == true` prima di verificare gli altri invarianti, inclusa l'assenza di una cancellazione account in corso. Un accesso privo del claim o con `false` viene negato; `global_catalog` continua a essere pubblico. I test dell'emulatore devono dichiarare esplicitamente `email_verified: true` per gli owner autorizzati e coprire il rifiuto delle sessioni non verificate.

### Test e deploy sono operazioni diverse

Il gate repository corrente testa `firestore.rules` tramite Firebase Emulator (`npm run test:rules`, transitivamente incluso in `verify:m8`). Questo **non** deploya le Rules sul progetto Firebase.

**MUST:** una modifica a `firestore.rules` richiede test pertinenti e il gate canonico.

Il deploy Production non è un comando manuale successivo ai test. Dopo `Milestone Verification` riuscita su push a `main` (**Main Release Gate**: attestazione dell'albero del merge e della CI già superata dalla PR, più CodeQL sul branch predefinito), il workflow `.github/workflows/firebase-firestore-production.yml` riconcilia Rules e indici desiderati con lo stato live: applica soltanto le differenze necessarie tramite `--only firestore:rules,firestore:indexes` (senza `--force`) e verifica la convergenza. Usa un'identità Workload Identity Federation dedicata, distinta dal deployer Hosting. Se lo stato live non è determinabile, fallisce chiuso.

**MUST:** test emulator, modifiche documentali e PR non eseguono direttamente deploy Firestore. Il rilascio Production compete al workflow privilegiato, ammesso solo dopo il gate canonico riuscito sullo stesso SHA ancora corrente di `main`. `Firebase Hosting Production` attende il completamento verde della riconciliazione Firestore, per non pubblicare il client prima delle Rules e degli indici approvati.

**MUST:** non eseguire un deploy manuale parallelo per aggirare un workflow fallito, né dedurre lo stato Production dal gate emulator. Gli interventi straordinari richiedono diagnosi e procedura deliberata nel provider competente, non il vecchio comando isolato `firebase-tools deploy --only firestore:rules`.

I file `firebase.json`, `.firebaserc` e `firestore.indexes.json` definiscono il target dichiarato nel repository. I dettagli su riconciliazione, readiness degli indici e read-back live sono normati in `.agents/rules/ci-verification.md` e nella sezione Hosting/deploy qui sotto.

### Account deletion

- **MUST:** il client non può eliminare direttamente `/users/{uid}`. Il root utente viene eliminato dal backend trusted del job account-deletion dopo la bonifica delle raccolte private e prima della cancellazione finale di Firebase Auth.
- **MUST:** il client non elimina fisicamente root, shard mensili o `sync_control/state`; le cancellazioni business usano tombstone e, dopo GC, empty shell cifrati/fenced. Le raccolte sconosciute restano negate ai client per default. Il cleanup fisico delle raccolte supportate è riservato ai job trusted Admin.
- `account_deletions/{uid}` resta server-only e costituisce la barriera cross-device durante una cancellazione in corso.

### Primo consenso sanitario trusted

Le Rules negano l'accesso business senza il record server-only attivo e la revisione corrente. Il contratto completo e la distinzione fra validazione Rules e GET trusted sono in [Consenso salute](health-consent.md); non attribuire alle Rules la validazione del business cifrato.

### Metadati `_sync`

Gli shard mensili correnti contengono il business dentro `_sealed`: le Firestore Rules verificano envelope, owner, consenso e protocollo pubblico, ma non possono contare le sessioni o le giornate cifrate. Non attribuire al formato corrente i vecchi limiti Rules di 256 sessioni/31 giornate plaintext. Dopo la decifratura, `monthlyIntegrity.ts` verifica identità, date e appartenenza al mese; i boundary autorevoli aggiungono i controlli di completezza e conservazione business. La validità delle date limita naturalmente le chiavi nutrizione alle giornate del mese. Prima della write, `sealCloudDocument` applica `checkDocSize` all'envelope cifrato serializzato con soglia prudenziale di 950.000 byte; è un guard client, distinto dal limite del provider.

Il Protocol 3 ammette nei causal clock cloud solo le 16 chiavi di slot replica `s00`–`s15`; le Rules rifiutano actor ID arbitrari e validano anche la coordinata dell'attuale writer come intero non negativo entro il safe integer. Il limite di 1000 espressioni delle Rules impedisce di validare nello stesso boundary tutte e 16 le coordinate senza bloccare write lecite: la validazione completa resta obbligatoria nel parser TypeScript prima di hydration e replay. Questa protezione riguarda i **metadati causali**; non verifica i valori di ogni stamp né gli identificativi business dinamici dei documenti mensili, che restano gestiti dai gateway applicativi.

Le Rules verificano gli invarianti top-level del protocollo che appartengono al boundary di autorizzazione. Sync Protocol 3 è la baseline del primo account reale: Protocol 1/2 non sono più accettati né migrati. Non esiste un percorso bootstrap Firestore business privo di causal metadata: prima di qualsiasi write business il client crea `users/{uid}/sync_control/state`; ogni documento root/mensile deve contenere `_schemaVersion: 1`, `_sync` Protocol 3 e `_sync.writer` (`slot`, `replicaId`, `generation`, `seq`) coerente con la replica attiva e con l'avanzamento atomico di `lastSeq`.

Ogni transazione business aggiorna anche `sync_control/state` con un `mutation.batchId` distinto per ogni `advance`, verificato da Rules tramite `get()`/`getAfter()`: il replay idempotente può ripetere `lastSeq` ma non riutilizzare `batchId`. Un documento persistito privo dei marker correnti è incompatibile e viene rifiutato fail-closed, mentre un documento realmente assente è una normale baseline vuota.

Le delete fisiche client-side dei documenti mensili sono sempre negate; la cancellazione fisica resta nel backend trusted di account deletion. `request.time` è la prova autorevole della lease; la validazione completa di Vector Clock/`FieldStamp` e la completezza del full checkpoint restano nel protocollo TypeScript e nei relativi test.

### Sintomo di Rules/Auth/App Check

`FirebaseError: Missing or insufficient permissions` / `permission-denied` può avere più cause (Rules, Auth, App Check, dominio/configurazione). Non classificare automaticamente l'errore come “Rules non deployate” o “App Check transitorio” senza discriminare la causa.

## Firebase Authentication — password policy e cutover

**Contratto applicativo (candidato PR G-, non ancora Production):** `src/lib/auth/passwordPolicy.ts` richiede almeno **15 code point Unicode** per la creazione, il cambio o il collegamento di una password. Non esistono regole statiche di composizione (maiuscole/minuscole/cifre/simboli). L'app non applica `trim()`, non normalizza né tronca la credenziale: il login e la reautenticazione devono continuare ad accettare la password esistente senza applicare a posteriori i nuovi requisiti di creazione.

**Contratto provider:** ogni nuova password che supera il minimo applicativo deve superare anche `validatePassword(auth, password)` sul server Firebase, **prima** della mutazione; il submit resta rifiutato se la policy remota non è verificabile. La risposta Firebase (e non una regex hardcoded) è fonte dei requisiti transitori di composizione e dei limiti massimi. I suggerimenti asincroni non autorizzano mai la mutazione e possono essere indisponibili; i rifiuti all'atto della write, anche se la policy è mutata dopo il controllo, restano autorevoli.

**Stato esterno:** le impostazioni Firebase Production riportate dal product owner il 10/11/2026 sono ancora min 8, max 4096, quattro categorie obbligatorie, enforcement *Richiedi applicazione*, upgrade all'accesso disabilitato. Non considerarle cambiate dall'esistenza del branch o della PR; riconfermarle in console prima di un futuro cutover. Il piano operativo sequenziale e i controlli per registrazione, login, recupero, cambio credenziale e collegamento sono nel [registro servizi esterni](../../docs/operations/external-services-register.md). Il cambio console è **escluso** dal mandato di questa PR.

## Sicurezza domini

Se si cambia o si aggiunge un dominio di hosting:

1. verificare Firebase Auth → Authorized domains;
2. per Firebase Hosting su `web.app`, usare l'origin pubblico anche come `authDomain` Production e autorizzare `https://<origin>/__/auth/handler` nel client OAuth;
3. verificare le restrizioni applicabili della Browser API Key in Google Cloud.

Questi stati console sono **VERIFY**, non facts dimostrati dal repository.

## Hosting, CSP e deploy frontend

La CSP e gli header del frontend Firebase Hosting sono configurati in `firebase.json`. Vercel non è più il provider degli header/browser asset del frontend target.

Prima di modificarli:
1. leggere `firebase.json`;
2. **MUST:** mantenere l'allowlist minima necessaria a Firebase/Auth/App Check, Firebase Installations e backend Vercel; le API Google usate dal runtime sono elencate esplicitamente, senza `*.googleapis.com`;
3. **MUST:** non introdurre wildcard `script-src`, `connect-src` Google API o CORS `*`;
4. verificare login popup/redirect, sync, App Check, assenza di richieste GA4, account deletion e PWA.

Il workflow `.github/workflows/firebase-hosting-production.yml` deploya Hosting soltanto dopo che `Firebase Firestore Production` ha completato con successo la riconciliazione dello stesso exact SHA di `main`; questo serializza i cutover che cambiano contemporaneamente client e Rules. Ricontrolla l'exact SHA e usa Workload Identity Federation. Il deploy resta limitato a `--only hosting`.

Il workflow separato `.github/workflows/firebase-firestore-production.yml` gestisce esclusivamente Firestore Rules/indici. Dopo ogni gate canonico verde sul push a `main`, ricontrolla l'exact SHA e riconcilia lo stato desiderato di quello SHA con il provider live: se le Rules differiscono o manca un indice desiderato esegue il deploy, se gli indici desiderati o le exemption single-field sono già in una Long Running Operation coerente col target attende e verifica senza rilanciare mutazioni ridondanti, se Rules e indici sono già allineati termina senza mutazioni.

Il read-back delle exemption esplicite usa la lista database-wide `collectionGroups/-/fields` con il filtro canonico `indexConfig.usesAncestorConfig=false OR ttlConfig:*`, perché le wildcard collection-level `*` non vanno inferite da una scansione per singolo collection group. Poiché il JSON protobuf può omettere i booleani output-only quando valgono `false`, un override esatto con `indexes: []` è considerato esplicito se `usesAncestorConfig` non è `true`; richiedere che il campo `false` sia materialmente presente nel JSON produrrebbe un falso drift permanente.

Le operation di rimozione degli indici single-field vengono riconosciute solo quando il provider espone una `FieldOperationMetadata` attiva sul campo esatto con soli delta `REMOVE`; uno stato diverso resta drift e fallisce chiuso. Il confronto con il solo commit padre non è una baseline valida perché può perdere una modifica approvata ma non ancora distribuita. Il workflow usa una identità WIF dedicata, non usa `--force` e fallisce chiuso se non riesce a determinare lo stato live.

La verifica finale legge nuovamente Rules, indici e operation dal provider; le Rules devono coincidere con la sorgente dell'exact SHA, gli indici compositi desiderati devono essere `READY` e identici anche nella direzione del campo implicito/esplicito `__name__` e nei metadati di indice (`apiScope`, densità e `multikey`, con i default di Firestore Standard), quelli aggiuntivi non dichiarati devono risultare assenti e le exemption devono essere effettivamente applicate. Indici compositi inattesi bloccano il workflow prima del deploy: nessuna rimozione automatica è autorizzata, anche se esistono altre differenze. La finestra di convergenza del job è bounded a 35 minuti dentro il timeout complessivo di 45 minuti.

Root app shell, `index.html`, manifest, service worker e Workbox devono essere esplicitamente revalidati/no-store; soltanto gli asset fingerprinted sotto `/assets/` sono immutable.

**VERIFY (configurazione backend effettiva):** distinguere il framework configurato nel progetto Vercel dall'output effettivo del deployment. Il `framework: null` dichiarato in `vercel.json` non prova da solo l'output Production, così come un'impostazione Vite nel dashboard non dimostra che il frontend sia stato pubblicato. Per modifiche al backend o al selettore deploy confrontare configurazione risolta, artefatti effettivamente serviti e comportamento HTTP autorizzato; non cambiare impostazioni sulla sola differenza nominale.

## Vercel branch deployment policy

`vercel.json` contiene il contratto repository corrente per Git deployment, imposta `framework: null` per il preset **Other** (backend-only, senza dipendere dal preset Vite del progetto) e `fluid: true` per rendere esplicito Fluid Compute:

- `main`: integrazione Git abilitata, ma `ignoreCommand` salta i commit che non modificano il boundary backend;
- altri branch: deployment disabilitato;
- modifiche a `api/`, `server/`, `vercel.json`, dipendenze/runtime o configurazione TypeScript server continuano a produrre il deployment Production necessario.

**MUST:** i branch di sviluppo non generano Preview Deployment. Non allargare `git.deploymentEnabled` per usare Vercel Preview come sostituto della CI. Il selettore dei deploy deve confrontare il commit corrente con l'ultimo deployment Vercel riuscito e, se non può determinare con sicurezza il diff, deve consentire il deployment invece di saltarlo. Il deployment di produzione Vercel, quando richiesto, deriva da `main`.

## Sicurezza HTTP

Gli header browser del frontend sono configurati in `firebase.json`; `vercel.json` disciplina invece routing/runtime del backend Vercel. Leggere entrambi i file prima di descrivere il contratto HTTP corrente.

## File di credenziali

**MUST:** `service-account.json` resta nel `.gitignore` e non va mai committato.

**MUST:** nessuna credenziale Firebase Admin privata deve essere copiata in Markdown, `.env.example`, codice client o test fixture committate.

## Riferimenti operativi

- [Registro dei servizi esterni](../../docs/operations/external-services-register.md): decisioni e configurazioni esterne da verificare direttamente nei provider.
- [Cutover Firebase Hosting](../../docs/operations/firebase-hosting-cutover.md): documento **storico completato**, non usare come procedura di deploy corrente senza rivalidare workflow e provider.
