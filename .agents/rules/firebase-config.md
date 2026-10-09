# Configurazione Firebase — LogBook

> Stato: normativo | Ultima verifica: 2026-09-30 | File verificati: `src/lib/firebase.ts`, `src/lib/appCheck.ts`, `server/accountDeletion/firebaseAdmin.ts`, `api/account-deletion-cron.ts`, `firestore.rules`, `firebase.json`, `.firebaserc`, `vercel.json`, `.env.example`

## Tre contratti di configurazione distinti

Non trattare tutte le variabili Firebase/App Check/Admin come un unico blocco obbligatorio. Esistono tre boundary differenti: client Firebase, App Check client e server trusted M7.

### Client Firebase — fail-fast minimo

`src/lib/firebase.ts` controlla all'avvio quattro variabili Firebase Web obbligatorie. Se una manca o è vuota, il client lancia `Error` prima di `initializeApp`.

| Variabile | Stato corrente | Note |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | MUST | Chiave API pubblica Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | MUST | Dominio Auth; in Production Firebase Hosting deve essere `thelogbook.web.app` così popup/redirect usano lo stesso origin del frontend |
| `VITE_FIREBASE_PROJECT_ID` | MUST | Project ID |
| `VITE_FIREBASE_APP_ID` | MUST | Config Firebase Web |
| `VITE_FIREBASE_MEASUREMENT_ID` | OPTIONAL core / REQUIRED per GA4 Production | Letta esclusivamente dal modulo Analytics dopo consenso |

Realtime Database, Firebase Storage e Cloud Messaging non sono importati dal runtime: `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_STORAGE_BUCKET` e `VITE_FIREBASE_MESSAGING_SENDER_ID` sono ritirati dal contratto client.

`VITE_ACCOUNT_DELETION_API_ORIGIN` è configurazione pubblica per raggiungere il backend trusted Vercel; non è una credenziale Firebase.

**MUST:** l'accesso Vite alle env client resta statico (`import.meta.env.VITE_FIREBASE_API_KEY` ecc.). Non sostituirlo con `import.meta.env[key]`.

Le chiavi Firebase Web sono configurazione pubblica inclusa nel bundle client; la protezione dei dati dipende da Security Rules, autenticazione, App Check e configurazione backend.

## App Check — reCAPTCHA Enterprise

Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio **Fraud Defense**. Nel contratto LogBook corrente non esiste una seconda integrazione applicativa Fraud Defense: il client usa esclusivamente `ReCaptchaEnterpriseProvider` tramite Firebase App Check. Non dichiarare attive funzioni Account/SMS/Transaction defense o API assessment dirette senza evidenza live e codice corrispondente.

- **Provider:** `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`).
- **Bootstrap provider:** `src/lib/firebase.ts` inizializza il provider App Check prima di inizializzare Firestore. L'acquisizione del token resta asincrona e distinta dal bootstrap del provider.
- **Stato:** `src/lib/appCheck.ts` distingue provider non inizializzato, disabled, unsupported, provider-ready, token-ready, token-error ed errore di inizializzazione. Un provider senza token non è considerato App Check attivo.
- **Support check:** manuale su runtime browser (`window.crypto`, `window.fetch`).
- **Site key canonica:** `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
- **Compatibilità:** il cutover Production alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` è stato completato e verificato il 2026-09-30; i precedenti alias `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` non fanno più parte del contratto runtime e non devono essere reintrodotti.
- **Semantica se manca la site key:** App Check entra in stato `disabled/fallback`; questa condizione **non** fa parte del fail-fast delle quattro env Firebase core e non impedisce `initializeApp` né il funzionamento locale/offline.
- **Token iniziale:** un failure di acquisizione porta a `token-error/fallback` e non viene dichiarato healthy. Non trasformare genericamente ogni `permission-denied` Firestore in “normale bootstrap noise”.

**MUST:** le richieste sensibili al backend custom Vercel (`account-deletion` e recovery device/status) usano token App Check limited-use; il server li verifica con `consume: true` e rifiuta token già consumati. I token standard restano appropriati per i servizi Firebase gestiti.

**VERIFY:** registrazione della site key, enforcement App Check e stato della configurazione in Firebase/Google Cloud sono esterni al repository e devono essere verificati in console quando rilevanti. Il service account Firebase Admin usato da Vercel deve avere l'autorizzazione necessaria a consumare token App Check; verificare IAM live prima del cutover.

**MUST:** nel percorso sync, un `permission-denied` osservato da `replicateJournal` resta `rejected` e non va mascherato. Retry bootstrap è accettabile solo quando la causa transitoria è identificata.

## Analytics di utilizzo — GA4 opt-in

Google/Firebase Analytics fa parte dell'architettura target soltanto come analytics opzionale dopo consenso esplicito.

- `src/lib/firebase.ts` non importa `firebase/analytics`; il Firebase core resta indipendente da Analytics.
- `src/lib/googleAnalytics.ts` esegue import dinamico solo dopo `logbook_ga4_consent_v1=true` e presenza di `VITE_FIREBASE_MEASUREMENT_ID`.
- Il precedente consenso `logbook_analytics_consent` usato da Vercel Analytics/Speed Insights non abilita GA4.
- La revoca disabilita la raccolta e viene propagata fra tab.
- Il page view manuale usa `origin + pathname`, senza query/hash; niente User-ID, user property o eventi custom workout/nutrizione/misure/salute.
- Un'inizializzazione fallita resta ritentabile.

**MUST:** nessuna richiesta GA4 prima del consenso. Configurazione GA4 live, Signals, Ads, retention e Measurement ID sono stato esterno da verificare nel provider.

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

**VERIFY:** il repository prova i nomi richiesti dal codice, non che i valori siano effettivamente provisionati in ogni environment Vercel né quali ruoli IAM siano assegnati al service account. In particolare, la replay protection App Check del backend richiede il permesso `firebaseappcheck.appCheckTokens.verify` sull'identità Admin usata da Vercel; `roles/firebaseappcheck.tokenVerifier` è il ruolo minimo da preferire se quel permesso deve essere aggiunto, ma un ruolo già assegnato che lo includa è sufficiente. Verificarlo direttamente in Google Cloud/Firebase.

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

### Revoca consenso dati salute — contratto della PR candidata

La soluzione A usa `health_consent_revocations/{uid}` come marker server-autorevole: il client owner può leggerlo, ma nessun client può crearlo, aggiornarlo o rimuoverlo. La scrittura avviene via `POST /api/health-consent-revocation`, con token Auth valido/non revocato, controllo origin esatto, token App Check limited-use consumato e transazione idempotente che rifiuta account in cancellazione. Il marker impone `isWritableOwner` per root, shard mensili, sync_control e write di telemetria legacy; resta `isActiveOwner` per le letture dei dati già registrati. Il job di account deletion elimina e verifica anche il marker prima di rimuovere Firebase Auth.

La richiesta locale è memorizzata prima del roundtrip HTTP: uno stato `pending` blocca le mutazioni in questo dispositivo senza essere presentato come conferma cloud. La stessa sospensione viene rilevata da altre tab mediante storage events e da altri device online tramite listener del marker. **VERIFY prima del rilascio:** consenso e basi giuridiche Art. 6/9, tempi/destino dei dati residui, interoperabilità con client vecchi, account deletion, test E2E e provider Production. Un device rimasto offline non può apprendere immediatamente una revoca da un altro dispositivo; il server protegge il primo successivo tentativo di scrittura.

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
- `LOGBOOK_BUILD_SHA`: SHA exact-main passato dal workflow Firebase Hosting Production; `EXPECTED_SHA`/`GITHUB_SHA` restano fallback verificabili.

**MUST:** `SENTRY_AUTH_TOKEN` resta server/build-only, senza prefisso `VITE_`, e non deve comparire in bundle, log, Markdown o fixture. Le source map Production vengono caricate a Sentry e rimosse dagli asset pubblici dopo l'upload.

Le collection `users/{uid}/telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono **legacy**: il client corrente non vi scrive nuova telemetria, ma Security Rules, account deletion e maintenance cron restano operativi per client PWA precedenti e documenti già esistenti. Le Rules continuano a richiedere ownership, payload bounded e `expireAt`; la retention legacy nominale resta 30 giorni. Ritirare questi boundary richiede prima evidenza che i client vecchi non possano più produrre dati e che il dataset residuo sia stato smaltito.

### Metadati `_sync`

Le Rules verificano gli invarianti top-level del protocollo che appartengono al boundary di autorizzazione. Sync Protocol 3 è la baseline del primo account reale: Protocol 1/2 non sono più accettati né migrati. Non esiste un percorso bootstrap Firestore business privo di causal metadata: prima di qualsiasi write business il client crea `users/{uid}/sync_control/state`; ogni documento root/mensile deve contenere `_schemaVersion: 1`, `_sync` Protocol 3 e `_sync.writer` (`slot`, `replicaId`, `generation`, `seq`) coerente con la replica attiva e con l'avanzamento atomico di `lastSeq`. Un documento persistito privo dei marker correnti è incompatibile e viene rifiutato fail-closed, mentre un documento realmente assente è una normale baseline vuota. Le delete fisiche client-side dei documenti mensili sono sempre negate; la cancellazione fisica resta nel backend trusted di account deletion. `request.time` è la prova autorevole della lease; la validazione completa di Vector Clock/`FieldStamp` e la completezza del full checkpoint restano nel protocollo TypeScript e nei relativi test.

### Sintomo di Rules/Auth/App Check

`FirebaseError: Missing or insufficient permissions` / `permission-denied` può avere più cause (Rules, Auth, App Check, dominio/configurazione). Non classificare automaticamente l'errore come “Rules non deployate” o “App Check transitorio” senza discriminare la causa.

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
2. **MUST:** mantenere l'allowlist minima necessaria a Firebase/Auth/App Check, Firebase Installations/Analytics, Sentry e backend Vercel; le API Google usate dal runtime sono elencate esplicitamente, senza `*.googleapis.com`;
3. **MUST:** non introdurre wildcard `script-src`, `connect-src` Google API o CORS `*`;
4. verificare login popup/redirect, sync, App Check, GA4, account deletion e PWA.

Il workflow `.github/workflows/firebase-hosting-production.yml` deploya Hosting soltanto dopo che `Firebase Firestore Production` ha completato con successo la riconciliazione dello stesso exact SHA di `main`; questo serializza i cutover che cambiano contemporaneamente client e Rules. Ricontrolla l'exact SHA e usa Workload Identity Federation. Il deploy resta limitato a `--only hosting`.

Il workflow separato `.github/workflows/firebase-firestore-production.yml` gestisce esclusivamente Firestore Rules/indici. Dopo ogni gate canonico verde sul push a `main`, ricontrolla l'exact SHA e riconcilia lo stato desiderato di quello SHA con il provider live: se le Rules differiscono o manca un indice desiderato esegue il deploy, se gli indici desiderati o le exemption single-field sono già in una Long Running Operation coerente col target attende e verifica senza rilanciare mutazioni ridondanti, se Rules e indici sono già allineati termina senza mutazioni. Il read-back delle exemption esplicite usa la lista database-wide `collectionGroups/-/fields` con il filtro canonico `indexConfig.usesAncestorConfig=false OR ttlConfig:*`, perché le wildcard collection-level `*` non vanno inferite da una scansione per singolo collection group. Poiché il JSON protobuf può omettere i booleani output-only quando valgono `false`, un override esatto con `indexes: []` è considerato esplicito se `usesAncestorConfig` non è `true`; richiedere che il campo `false` sia materialmente presente nel JSON produrrebbe un falso drift permanente. Le operation di rimozione degli indici single-field vengono riconosciute solo quando il provider espone una `FieldOperationMetadata` attiva sul campo esatto con soli delta `REMOVE`; uno stato diverso resta drift e fallisce chiuso. Il confronto con il solo commit padre non è una baseline valida perché può perdere una modifica approvata ma non ancora distribuita. Il workflow usa una identità WIF dedicata, non usa `--force` e fallisce chiuso se non riesce a determinare lo stato live. La verifica finale legge nuovamente Rules, indici e operation dal provider; le Rules devono coincidere con la sorgente dell'exact SHA, gli indici compositi desiderati devono essere `READY` e le exemption devono essere effettivamente applicate. La finestra di convergenza del job è bounded a 35 minuti dentro il timeout complessivo di 45 minuti.

Root app shell, `index.html`, manifest, service worker e Workbox devono essere esplicitamente revalidati/no-store; soltanto gli asset fingerprinted sotto `/assets/` sono immutable.

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
