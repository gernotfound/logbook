# Configurazione Firebase — LogBook

> Stato: normativo | Ultima verifica: 2026-09-30 | File verificati: `src/lib/firebase.ts`, `src/lib/appCheck.ts`, `server/accountDeletion/firebaseAdmin.ts`, `api/account-deletion-cron.ts`, `firestore.rules`, `firebase.json`, `.firebaserc`, `vercel.json`, `.env.example`

## Tre contratti di configurazione distinti

Non trattare tutte le variabili Firebase/App Check/Admin come un unico blocco obbligatorio. Esistono tre boundary differenti: client Firebase, App Check client e server trusted M7.

### Client Firebase — fail-fast

`src/lib/firebase.ts` controlla all'avvio sette variabili `VITE_FIREBASE_*`. Se una manca o è vuota, il client lancia `Error` prima di `initializeApp`.

| Variabile | Stato corrente | Note |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | MUST | Chiave API pubblica Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | MUST | Dominio Auth |
| `VITE_FIREBASE_DATABASE_URL` | MUST runtime / VERIFY necessità futura | Oggi è inclusa nel fail-fast/config; il progetto usa Firestore, non Realtime Database, quindi la necessità futura del campo va verificata prima di rimuoverlo dal contratto |
| `VITE_FIREBASE_PROJECT_ID` | MUST | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | MUST runtime / VERIFY necessità futura | Oggi è inclusa nel fail-fast/config; il runtime non importa Firebase Storage |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | MUST runtime / VERIFY necessità futura | Oggi è inclusa nel fail-fast/config; il runtime non importa Firebase Cloud Messaging |
| `VITE_FIREBASE_APP_ID` | MUST | Config Firebase Web |

**MUST:** l'accesso Vite alle env client resta statico (`import.meta.env.VITE_FIREBASE_API_KEY` ecc.). Non sostituirlo con `import.meta.env[key]`.

Le chiavi Firebase Web sono configurazione pubblica inclusa nel bundle client; la protezione dei dati dipende da Security Rules, autenticazione, App Check e configurazione backend. Non descrivere le env `VITE_*` come segreti server.

## App Check — reCAPTCHA Enterprise

Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio **Fraud Defense**. Nel contratto LogBook corrente non esiste una seconda integrazione applicativa Fraud Defense: il client usa esclusivamente `ReCaptchaEnterpriseProvider` tramite Firebase App Check. Non dichiarare attive funzioni Account/SMS/Transaction defense o API assessment dirette senza evidenza live e codice corrispondente.

- **Provider:** `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`).
- **Bootstrap provider:** `src/lib/firebase.ts` inizializza il provider App Check prima di inizializzare Firestore. L'acquisizione del token resta asincrona e distinta dal bootstrap del provider.
- **Stato:** `src/lib/appCheck.ts` distingue provider non inizializzato, disabled, unsupported, provider-ready, token-ready, token-error ed errore di inizializzazione. Un provider senza token non è considerato App Check attivo.
- **Support check:** manuale su runtime browser (`window.crypto`, `window.fetch`).
- **Site key canonica:** `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
- **Compatibilità:** il cutover Production alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` è stato completato e verificato il 2026-09-30; i precedenti alias `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` non fanno più parte del contratto runtime e non devono essere reintrodotti.
- **Semantica se manca la site key:** App Check entra in stato `disabled/fallback`; questa condizione **non** fa parte del fail-fast delle sette env Firebase client e non impedisce `initializeApp` né il funzionamento locale/offline.
- **Token iniziale:** un failure di acquisizione porta a `token-error/fallback` e non viene dichiarato healthy. Non trasformare genericamente ogni `permission-denied` Firestore in “normale bootstrap noise”.

**VERIFY:** registrazione della site key, enforcement App Check e stato della configurazione in Firebase/Google Cloud sono esterni al repository e devono essere verificati in console quando rilevanti.

**MUST:** nel percorso sync, un `permission-denied` osservato da `replicateJournal` resta `rejected` e non va mascherato. Retry bootstrap è accettabile solo quando la causa transitoria è identificata.

## Analytics non essenziali

Google/Firebase Analytics non fa parte del prodotto e `src/lib/firebase.ts` non deve importare `firebase/analytics`, configurare `measurementId` o richiedere `VITE_FIREBASE_MEASUREMENT_ID`.

Vercel Analytics e Speed Insights sono ritirati nel target Firebase; `src/lib/analyticsConsent.ts` non fa più parte del runtime.

**MUST:** non reintrodurre Google/Firebase Analytics, Vercel Analytics o altri analytics comportamentali senza una nuova decisione di prodotto e una rivalutazione privacy esplicita.

## Server trusted M7 — Firebase Admin

`server/accountDeletion/firebaseAdmin.ts` richiede queste tre env quando inizializza Firebase Admin:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

La private key supporta newline escaped (`\\n`) e viene normalizzata server-side.

`api/account-deletion-cron.ts` usa inoltre:

- `CRON_SECRET`

`CRON_SECRET` è un requisito specifico del cron: se assente, `/api/account-deletion-cron` risponde 503. Non è una variabile necessaria al bootstrap del client Vite.

**MUST:** tutte queste credenziali/config server restano server-only, senza prefisso `VITE_`, e non devono essere inserite nel bundle client o committate con valori reali.

**VERIFY:** il repository prova i nomi richiesti dal codice, non che i valori siano effettivamente provisionati in ogni environment Vercel né quali ruoli IAM siano assegnati al service account.

## Contratto `.env.example`

`.env.example` documenta entrambi i boundary usando **solo placeholder non sensibili**:

- configurazione client Firebase/App Check (`VITE_*`);
- nomi delle env server trusted (`FIREBASE_ADMIN_*`, `CRON_SECRET`).

**MUST:** il template non contiene chiavi private, token, email reali, project identifier privati o altri valori di produzione. La presenza dei nomi server nel template serve soltanto a rendere esplicito il contratto runtime; i valori reali restano in Vercel/secret storage.

**MUST:** non copiare una private key reale in `.env.example`, Markdown, issue, PR, fixture o codice client.

**MUST:** `.env.production` non è un file di configurazione versionato. Production riceve i valori dal provider di deployment; CI/E2E usa valori sintetici espliciti quando necessari.

## Firestore Security Rules

### Test e deploy sono operazioni diverse

Il gate repository corrente testa `firestore.rules` tramite Firebase Emulator (`npm run test:rules`, transitivamente incluso in `verify:m8`). Questo **non** deploya le Rules sul progetto Firebase.

**MUST:** una modifica a `firestore.rules` richiede test pertinenti e il gate canonico.

Il deploy reale è un'operazione distinta, da eseguire soltanto quando il task operativo lo richiede e dopo aver verificato il target:

```bash
npx firebase-tools deploy --only firestore:rules
```

Non trasformare il deploy Rules in un side effect automatico di un test, di una modifica documentale o di una PR. L'autenticazione/credential path usato per il deploy dipende dall'ambiente operativo; non documentare un particolare ruolo IAM o service account come requisito corrente senza evidenza verificata.

I file `firebase.json` e `.firebaserc` definiscono la configurazione repository usata dagli strumenti Firebase; leggere entrambi prima di cambiare target o Rules. Eventuali indici o policy esterne vanno verificate direttamente sul progetto reale.

### Account deletion

- **MUST:** il client non può eliminare direttamente `/users/{uid}`. Il root utente viene eliminato dal backend trusted del job account-deletion dopo la bonifica delle raccolte private e prima della cancellazione finale di Firebase Auth.
- Le sottocollezioni private mantengono `delete` owner-scoped per le normali operazioni di dominio dove previste; questa capacità non autorizza il client a bypassare il workflow di cancellazione account.
- `account_deletions/{uid}` resta server-only e costituisce la barriera cross-device durante una cancellazione in corso.

### Telemetria tecnica — Sentry e legacy Firestore

Il client corrente usa **Sentry Error Monitoring** come destinazione esterna per errori e anomalie tecniche in Production. Il Firebase UID può essere usato localmente per stabilire l'eleggibilità all'invio, ma non viene deliberatamente inserito nel payload Sentry. Prima del boundary esterno, messaggi e stack attraversano i sanitizzatori LogBook; il client non abilita l'invio PII di default, disattiva le integrazioni automatiche e il `beforeSend` elimina `user`, `request`, breadcrumb, transaction ed extra. Replay, tracing, logging e metriche non sono abilitati.

Configurazione client/build:

- `VITE_SENTRY_DSN`: DSN pubblico del progetto Sentry, incluso nel bundle Production;
- `SENTRY_AUTH_TOKEN`: segreto build-only con scope CI per upload source map/release;
- `SENTRY_ORG` e `SENTRY_PROJECT`: identificatori build-time;
- `VERCEL_GIT_COMMIT_SHA`: release Sentry e SHA canonico della build Production.

**MUST:** `SENTRY_AUTH_TOKEN` resta server/build-only, senza prefisso `VITE_`, e non deve comparire in bundle, log, Markdown o fixture. Le source map Production vengono caricate a Sentry e rimosse dagli asset pubblici dopo l'upload.

Le collection `users/{uid}/telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono **legacy**: il client corrente non vi scrive nuova telemetria, ma Security Rules, account deletion e maintenance cron restano operativi per client PWA precedenti e documenti già esistenti. Le Rules continuano a richiedere ownership, payload bounded e `expireAt`; la retention legacy nominale resta 30 giorni. Ritirare questi boundary richiede prima evidenza che i client vecchi non possano più produrre dati e che il dataset residuo sia stato smaltito.

### Metadati `_sync`

Le Rules verificano gli invarianti top-level del protocollo che appartengono al boundary di autorizzazione: chiavi ammesse (`protocolVersion`, `clock`, `fields`), versione corrente e tipo map per clock/fields. La validazione completa di Vector Clock e `FieldStamp` resta nel parser TypeScript; non duplicare l'intero parser nelle Security Rules.

### Sintomo di Rules/Auth/App Check

`FirebaseError: Missing or insufficient permissions` / `permission-denied` può avere più cause (Rules, Auth, App Check, dominio/configurazione). Non classificare automaticamente l'errore come “Rules non deployate” o “App Check transitorio” senza discriminare la causa.

## Sicurezza domini

Se si cambia o si aggiunge un dominio di hosting:

1. verificare Firebase Auth → Authorized domains;
2. verificare le restrizioni applicabili della Browser API Key in Google Cloud.

Questi stati console sono **VERIFY**, non facts dimostrati dal repository.

## CSP (Content Security Policy)

La CSP canonica del target è configurata in `firebase.json`; `vercel.json` mantiene una CSP compatibile soltanto finché il vecchio origin Vercel resta attivo come bridge. Prima di modificarla:

1. leggere `vercel.json` e identificare la direttiva interessata;
2. **MUST:** non rimuovere domini Firebase/Sentry o il direct endpoint Functions necessari al comportamento corrente senza una sostituzione verificata;
3. verificare login, sync, App Check, API account deletion, bridge di migrazione origine e PWA dopo il cambiamento pertinente.

## Deployment e origin migration

`vercel.json` mantiene durante la migrazione il vecchio origin aggiornato soltanto da `main`; i branch restano disabilitati. Il target Firebase viene deployato dal workflow `.github/workflows/firebase-production.yml` soltanto dopo `Milestone Verification` verde su un push a `main`, sullo stesso SHA ancora presente come HEAD di `main`.

**MUST:** i branch di sviluppo non generano Preview Deployment Vercel né deploy Firebase.
**MUST:** il bridge cross-origin trasferisce un Local Envelope soltanto verso l'origin target configurato, conserva causal metadata/pending journal e rifiuta overwrite divergenti.
**MUST:** il vecchio origin non viene ritirato prima che la finestra di migrazione dati sia conclusa e che le allowlist esterne siano aggiornate.

## Sicurezza HTTP

Gli header HTTP sono configurati in `vercel.json`; leggere la configurazione corrente prima di descriverne l'elenco come normativo, perché può cambiare indipendentemente da questa regola.

## File di credenziali

**MUST:** `service-account.json` resta nel `.gitignore` e non va mai committato.

**MUST:** nessuna credenziale Firebase Admin privata deve essere copiata in Markdown, `.env.example`, codice client o test fixture committate.
