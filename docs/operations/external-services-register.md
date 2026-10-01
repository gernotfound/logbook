# Registro servizi esterni LogBook

> Stato: registro operativo stabile. Ultimo consolidamento: 2026-10-01.
>
> Questo file documenta **perché** esistono le integrazioni e quali impostazioni devono essere preservate. Non è un inventario di segreti e non sostituisce la verifica live nelle console dei provider.

## Regole di lettura

- `ACTIVE`: usato dal runtime o dal processo di delivery corrente.
- `LEGACY`: mantenuto temporaneamente per compatibilità/cleanup.
- `OPTIONAL`: funzione non essenziale, tipicamente subordinata a consenso o quota.
- `EXTERNAL-ONLY`: configurazione rilevante che vive nella console del provider.
- `VERIFY-LIVE`: il repository non può dimostrarne lo stato attuale.

Il repository è pubblico. Questo registro non contiene token, private key, email personali, ID di credenziali, dati di fatturazione o path locali del maintainer.

## Mappa sintetica

| Sistema | Stato | Perché esiste | Fonte operativa |
|---|---|---|---|
| Firebase Authentication | ACTIVE | account email/Google e sessione autenticata | Firebase console + codice Auth |
| Cloud Firestore | ACTIVE | replica/sincronizzazione cloud dei dati account | Firestore/Rules + codice sync |
| Firebase Realtime Database | NON USATO DAL RUNTIME | `databaseURL` resta nel config Firebase Web, ma il modulo RTDB non è importato | codice + console VERIFY-LIVE |
| Firebase Storage | NON USATO DAL RUNTIME | `storageBucket` resta nel config Firebase Web, ma il modulo Storage non è importato | codice + console VERIFY-LIVE |
| Firebase Cloud Messaging | NON USATO DAL RUNTIME | `messagingSenderId` resta nel config Firebase Web, ma il modulo Messaging non è importato | codice + console VERIFY-LIVE |
| Firebase Hosting | EXTERNAL-ONLY / PREPARED TARGET | sito `thelogbook.web.app` preparato; non è ancora la Production corrente | Firebase console + futuro config Hosting |
| Firebase Admin | ACTIVE | account deletion e manutenzione server trusted | Vercel env + Vercel Functions |
| Firebase App Check + reCAPTCHA Enterprise / Google Cloud Fraud Defense | ACTIVE | attestazione anti-abuse prima dell'accesso cloud | Firebase App Check + Google Cloud |
| Vercel Hosting / Functions / Cron | ACTIVE | Production PWA, API trusted e cron | Vercel + `vercel.json` |
| Vercel Analytics / Speed Insights | OPTIONAL / CURRENT | analytics/performance con opt-in nel runtime `main` corrente | Vercel + consenso client |
| Google Analytics / GA4 | EXTERNAL-ONLY / PREPARED TARGET | stream Web preparato per `thelogbook.web.app`; non è inizializzato dal runtime `main` corrente | Google Analytics + Firebase |
| Sentry | ACTIVE | error monitoring tecnico Production | Sentry + build Vercel |
| GitHub Actions / CodeQL / ruleset | ACTIVE | repository pubblico, PR, CI e SAST canonico | GitHub |
| Snyk | OPTIONAL | controllo security supplementare | integrazione Snyk esterna |
| Google Search Console | EXTERNAL-ONLY | verifica proprietà, sitemap e indicizzazione | Search Console + asset SEO repo |

## Firebase Hosting

Firebase Hosting **non è ancora il provider di hosting del runtime corrente di LogBook**: la Production corrente resta Vercel finché non avviene un cutover esplicito e verificato.

Preparazione live verificata il 2026-10-01:

- è stato creato e scelto come hostname target `thelogbook.web.app`;
- il nome pubblico scelto per il progetto/servizio è **TheLogBook**;
- il progetto Firebase deve restare sul piano **Spark**: non è autorizzato il passaggio a Blaze;
- di conseguenza il target futuro non deve dipendere da Cloud Functions for Firebase o Scheduled Functions che richiedano Blaze;
- Vercel può restare come boundary serverless gratuito per Functions/Cron mentre il frontend migra a Firebase Hosting.

Questa preparazione esterna non equivale a un deploy: `main` continua a descrivere e servire la Production Vercel corrente finché codice, CI e cutover non vengono aggiornati con un task dedicato.

I domini Firebase predefiniti possono comunque essere presenti nelle configurazioni Auth/OAuth perché appartengono al flusso Firebase Authentication; la loro presenza non dimostra da sola che Firebase Hosting sia Production.

## Firebase Authentication e OAuth

Firebase Authentication è il provider identità del prodotto. LogBook supporta autenticazione Google e credenziali email/password.

Stato live verificato il 2026-10-01 durante la preparazione del futuro origin Firebase Hosting:

- Firebase Authentication → Authorized domains contiene `localhost`, i domini Firebase predefiniti, il dominio Production Vercel corrente e il nuovo `thelogbook.web.app`;
- il Web OAuth client auto-creato mantiene le origini localhost e Firebase già necessarie;
- è stata aggiunta l'origine JavaScript `https://thelogbook.web.app`;
- è stato aggiunto il redirect `https://thelogbook.web.app/__/auth/handler`;
- i valori esistenti necessari alla Production Vercel/Firebase non sono stati rimossi.

Il precedente dominio GitHub Pages è **ritirato** dal 2026-09-30 e non deve essere reintrodotto salvo nuova dipendenza runtime esplicita.

Il vecchio origin Vercel dovrà essere rimosso dalle allowlist soltanto dopo un cutover Firebase verificato e solo se non resta necessario per il backend/serverless.

## Google API Browser key

La Firebase Web API key è configurazione client pubblica, non una credenziale Admin. La sua sicurezza dipende anche dalle restrizioni lato Google Cloud.

Stato live verificato il 2026-10-01:

- la chiave browser auto-creata da Firebase è limitata a **Siti web**;
- i referrer osservati includono la Production Vercel corrente, l'origine Firebase necessaria al flusso Auth e `https://thelogbook.web.app/*`;
- il nuovo origin Firebase Hosting è quindi già autorizzato senza aprire la chiave a qualunque sito;
- le restrizioni API risultano già abilitate con un insieme esplicito di API; l'elenco non è stato ristretto ulteriormente durante questa preparazione per evitare di rimuovere dipendenze Firebase necessarie senza test runtime dedicati.

Il vecchio referrer GitHub Pages è **ritirato** dal 2026-09-30.

Il referrer Vercel deve restare autorizzato finché la Production corrente o il futuro backend serverless lo richiedono; un'eventuale rimozione va fatta solo dopo verifica live del nuovo assetto.

## Firestore

Firestore è la replica remota per account autenticati, non la persistenza locale primaria. IndexedDB resta il boundary offline-first canonico.

Il runtime non importa Firebase Realtime Database. `VITE_FIREBASE_DATABASE_URL` resta ancora nel contratto Firebase Web fail-fast come configurazione legacy da rivalutare, ma non giustifica allowlist `firebaseio.com` nella CSP. La seconda passata del 2026-09-30 ha quindi rimosso tali origin dalla CSP senza rimuovere la variabile dal contratto runtime.

Analogamente, il runtime non importa Firebase Storage né Firebase Cloud Messaging. `VITE_FIREBASE_STORAGE_BUCKET` e `VITE_FIREBASE_MESSAGING_SENDER_ID` restano oggi nel fail-fast/config Firebase Web per compatibilità del contratto esistente, ma la loro presenza non va interpretata come prova che quei servizi siano usati. Un'eventuale semplificazione delle sette env richiede modifica separata con test.

Le vecchie collection Firestore `telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono `LEGACY`: il client corrente invia errori/anomalie a Sentry, ma Rules, account deletion e retention cron restano finché i client vecchi e i documenti residui non sono definitivamente smaltiti.

## Firebase Admin e account deletion

Le Vercel Functions di account deletion richiedono per contratto:

- `FIREBASE_ADMIN_PROJECT_ID`;
- `FIREBASE_ADMIN_CLIENT_EMAIL`;
- `FIREBASE_ADMIN_PRIVATE_KEY`;
- `CRON_SECRET`.

Tutte sono server-only e nessuna deve avere prefisso `VITE_`.

Verifica live del 2026-09-30: in Vercel Production risultano presenti `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` e `CRON_SECRET`. I valori non sono registrati qui. Una chiave Admin generata accidentalmente durante la verifica è stata eliminata subito senza essere usata o installata.

## App Check, reCAPTCHA Enterprise e Fraud Defense

LogBook usa `ReCaptchaEnterpriseProvider` tramite Firebase App Check per rendere più difficile l'accesso abusivo alle risorse Firebase.

Nella terminologia Google Cloud corrente, reCAPTCHA Enterprise è presentato come funzionalità della piattaforma Google Cloud Fraud Defense. Per LogBook questi nomi non indicano due integrazioni applicative separate: il codice usa **App Check + provider reCAPTCHA Enterprise**.

Verifica live aggiornata il 2026-10-01:

- la Web App LogBook è registrata in Firebase App Check con provider Fraud Defense/reCAPTCHA Enterprise;
- Cloud Firestore e Authentication mostravano 100% richieste verificate e 0% non verificate in modalità monitoraggio;
- l'enforcement non è stato attivato durante questa preparazione;
- la chiave Web è stata rinominata da `Logbook Vercel` a **TheLogBook Web** senza cambiare l'identità/site key;
- la verifica dominio resta attiva;
- i domini autorizzati osservati sono `logbook-gnf.vercel.app` e `thelogbook.web.app`;
- AMP resta disabilitato;
- il dominio Vercel è mantenuto finché è necessario al runtime corrente e verrà rivalutato dopo il cutover.

Bot/Fraud Defense resta il boundary App Check osservato; Account defense, SMS defense e Transaction defense non fanno parte del runtime LogBook salvo futura decisione esplicita e verifica live.

L'ID/site key è configurazione client pubblica e non viene duplicato in questo registro; la Secret key reCAPTCHA non deve entrare nel browser né in env `VITE_*`.

Il cutover Vercel alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` è stato completato il 2026-09-30. Dopo un redeploy Production è stata rimossa `VITE_RECAPTCHA_V3_SITE_KEY`; un secondo redeploy sullo stesso SHA ha risposto HTTP 200, ha incorporato la site key Enterprise nel bundle e non ha mostrato runtime error. I fallback `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` sono quindi ritirati dal contratto applicativo.

## Vercel

Vercel è il provider Production di LogBook.

Il repository impone deploy abilitato soltanto da `main`, Functions native per account deletion/maintenance, cron in `vercel.json` e security headers/CSP versionati. I branch di sviluppo non devono generare Preview Deployment.

La CSP segue il principio di allowlist minima. LogBook usa font di sistema e non carica Google Fonts: gli origin `fonts.googleapis.com`/`fonts.gstatic.com` sono stati rimossi nella seconda passata del 2026-09-30 insieme agli origin Realtime Database non usati.

Il codice corrente legge sette variabili Firebase Web:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

`VITE_FIREBASE_MEASUREMENT_ID` non è usata dal codice corrente e il 2026-09-30 è stata rimossa da Vercel. Firebase Analytics non fa parte del prodotto e la variabile non deve essere reintrodotta come dipendenza.

Production usa inoltre `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT`; il token è build-only e non deve entrare nel bundle o nel repository.

La configurazione Production non viene più duplicata in un file `.env.production` versionato. La seconda passata del 2026-09-30 ha rimosso quel file: conteneva soltanto configurazione Firebase Web pubblica, non segreti Admin, ma duplicava identificatori/endpoints reali senza necessità. Il contratto resta in `.env.example`; i valori Production vivono in Vercel. CI/E2E usa valori sintetici espliciti.

### Scope Vercel registrati

Inventario fornito dal product owner il 2026-09-30, da verificare live prima di modifiche:

| Famiglia env | Scope riportato | Nota |
|---|---|---|
| sette `VITE_FIREBASE_*` usate dal client | Production + Preview | configurazione Firebase Web |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Production | site key pubblica canonica App Check |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `CRON_SECRET` | Production | server-only; presenza verificata, valori non registrati |
| env Sentry (`VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) | Production | Error Monitoring/source map |
| `VITE_FIREBASE_MEASUREMENT_ID` | RIMOSSA | Firebase Analytics non usato |
| `VITE_RECAPTCHA_V3_SITE_KEY` | RIMOSSA | alias legacy ritirato dopo cutover Enterprise |



## Google Analytics / GA4 — preparazione target Firebase Hosting

Il runtime `main` corrente non inizializza Firebase Analytics e continua a usare Vercel Analytics/Speed Insights secondo il consenso client esistente. Il 2026-10-01 è stata però preparata la configurazione esterna GA4 destinata al futuro frontend Firebase Hosting.

Stato live verificato:

- proprietà/account e Web data stream rinominati **TheLogBook**;
- URL del Web data stream impostato su `https://thelogbook.web.app`;
- esiste un Measurement ID GA4 `G-...`, ma il valore non viene duplicato in questo registro;
- **Misurazione avanzata: OFF**;
- **Google Signals: OFF**;
- raccolta dati granulari di posizione/dispositivo: **OFF**;
- personalizzazione annunci: **OFF**;
- raccolta dati forniti dagli utenti / User-ID: non attivata;
- integrazione dei segmenti di pubblico migliorata Firebase: **OFF**;
- collegamenti prodotto: soltanto Firebase; nessun collegamento Ads osservato;
- conservazione dati: **2 mesi**;
- reset della retention in caso di nuova attività: **OFF**;
- condivisione dati account: Prodotti e servizi Google **OFF**, modellazione/insight **OFF**, Assistenza tecnica **OFF**, Consigli per l'attività **OFF**;
- paese dell'attività: **Italia**;
- fuso orario report: **Europe/Rome / Italia**;
- valuta: **EUR**;
- filtro `Internal Traffic`: stato **Test**; nessuna regola di traffico interno/IP è stata configurata.

Questa configurazione è deliberatamente privacy-minimal e non autorizza da sola la raccolta nel runtime corrente. L'eventuale passaggio da Vercel Analytics a GA4 richiede ancora modifica applicativa, consenso provider-specific, documentazione privacy coerente, test e cutover verificato.

## Vercel Analytics / Speed Insights

Sono servizi separati dalla telemetria tecnica Sentry. Restano disabilitati per default e vengono montati soltanto dopo opt-in Analytics dell'utente. La revoca deve propagarsi anche tra tab.

## Sentry

Sentry sostituisce Firestore come destinazione corrente per errori/anomalie tecniche.

Configurazione deliberata:

- Error Monitoring: **ON**;
- Data Scrubbing: **ON**;
- Default Scrubbers: **ON**;
- IP scrubbing: **ON**;
- Spike Protection: **ON**;
- Session Replay: **OFF**;
- Tracing: **OFF**;
- Logging: **OFF**;
- Application Metrics: **OFF**.

Motivo: ottenere stack trace/release utili agli aggiornamenti frequenti senza consumare la quota Firestore e senza raccogliere telemetria comportamentale non necessaria.

La scelta iniziale è stata fatta per restare sul piano gratuito: Spike Protection e deduplica client di 15 minuti per fingerprint riducono il rischio che un errore in loop consumi rapidamente il volume disponibile. **VERIFY-LIVE:** limiti, pricing e retention del piano Sentry sono configurazione commerciale esterna e possono cambiare; verificarli prima di aumentare volume, sampling o funzionalità.

Il primo errore controllato è stato ricevuto correttamente da Sentry il 2026-09-30 con environment Production e release Git SHA. La verifica di simbolicazione source-map può avvenire sul primo errore naturale originato dal codice applicativo.

## GitHub, Actions e CodeQL

Il repository è pubblico: questo è un vincolo di sicurezza e privacy, non solo una scelta di collaborazione.

Al consolidamento del 2026-09-30 il ruleset `protect main branch` è attivo sulla default branch e richiede `Canonical Verification`, status check strict, pull request, risoluzione delle review conversation, cronologia lineare e squash merge; non risultano bypass configurati.

CodeQL è parte del gate canonico. Il nome `Canonical Verification` non deve essere cambiato senza verificare ruleset e integrazioni Vercel collegate.

Dependabot è configurato nel repository per controlli settimanali sia delle dipendenze npm sia delle GitHub Actions, con massimo 10 PR aperte per ciascun ecosistema. È automazione di manutenzione, non un bypass: le sue PR devono attraversare gli stessi guardrail di `main`.

## Snyk

Snyk è un controllo security **supplementare**, non la fonte canonica della decisione di merge.

Il repository contiene `.snyk`, che esclude test/test files dalla relativa analisi. Non esiste un workflow Snyk nel repository corrente: l'eventuale check deriva dall'integrazione esterna.

Limiti quota o indisponibilità Snyk non devono eliminare la copertura SAST bloccante, che resta affidata a CodeQL nel `Canonical Verification`.

## Google Search Console e indicizzazione

La proprietà Search Console corrisponde al sito Production Vercel. L'integrazione serve a dimostrare il controllo del sito, presentare/controllare la sitemap, consentire crawling/indicizzazione e osservare lo stato degli URL.

Il repository mantiene deliberatamente:

- meta tag di verifica Google in `index.html`;
- file statico di verifica Google sotto `public/`;
- `public/robots.txt` con crawling consentito e riferimento alla sitemap;
- `public/sitemap.xml` con URL canonico Production.

Al 2026-09-30 `robots.txt`, `sitemap.xml` e il file di verifica rispondono HTTP 200 in Production. Il product owner riferisce inoltre di avere configurato sitemap e indicizzazione in Search Console; **VERIFY-LIVE:** il repository non dimostra che la sitemap risulti attualmente inviata/accettata né lo stato di indicizzazione mostrato dalla console.

Non rimuovere i meccanismi di verifica solo perché la proprietà è già stata accettata.

## GitHub Pages — hosting ritirato

GitHub Pages non è più un hosting LogBook.

Audit repository 2026-09-30:

- nessun hostname GitHub Pages è referenziato dal runtime/config corrente;
- non esiste workflow `gh-pages`/Pages né branch `gh-pages`;
- GitHub API riporta `has_pages: false` e la homepage repository punta al dominio Vercel;
- Vercel è il solo hosting Production;
- il vecchio test auto-contenuto di base path dinamico `/logbook/` è stato rimosso perché non esercitava la configurazione reale; il contratto PWA corrente verifica `start_url` e `scope` alla radice `/`.

Pulizia esterna completata/verificata il 2026-09-30:
- il vecchio dominio GitHub Pages è stato rimosso da Firebase Authentication → Authorized domains;
- il vecchio referrer GitHub Pages è stato rimosso dalla Browser API key;
- il Web OAuth client descritto non riportava GitHub Pages;
- la Web key reCAPTCHA Enterprise/Fraud Defense mantiene attiva la verifica dominio; dal 2026-10-01 autorizza sia il dominio Production Vercel corrente sia `thelogbook.web.app` in preparazione al cutover.

## Checklist annuale

1. verificare domini Firebase Auth;
2. verificare restrizioni Browser API key e OAuth origins/redirect;
3. verificare App Check e dominio/key reCAPTCHA Enterprise;
4. verificare env Vercel per nome/scope senza esportarne i valori;
5. verificare cron e Functions;
6. verificare GitHub ruleset/required check;
7. verificare Sentry privacy, Spike Protection e feature non richieste ancora disattivate;
8. verificare Snyk come supplementare e CodeQL come gate;
9. verificare Search Console, sitemap, robots e canonical Production URL;
10. verificare GA4/Google Analytics se preparato o attivo: stream, Enhanced Measurement, Signals, Ads, retention e condivisione dati;
11. rimuovere origin, chiavi e integrazioni legacy non più necessarie.


## Candidato migrazione Firebase Hosting Spark (PR #191, non live)

Il candidato `migrazione-firebase-hosting-spark` prepara il frontend/PWA per `https://thelogbook.web.app` mantenendo Firebase sul piano Spark. Firebase Hosting serve esclusivamente asset statici; nessuna Cloud Function, Scheduled Function, Cloud Scheduler o Cloud Run è richiesta dal runtime.

Vercel resta il boundary trusted server-only: `/api/account-deletion`, `/api/account-deletion-device` e il cron giornaliero `/api/account-deletion-cron`. Il frontend usa un origin Vercel esplicito e il backend accetta CORS soltanto dall'origin pubblico configurato (`PUBLIC_APP_ORIGIN`, fallback `https://thelogbook.web.app`), con App Check e autenticazione/credential specifica per il flusso.

GA4 sostituisce Vercel Analytics/Speed Insights nel candidato. Il consenso usa una nuova chiave provider-specific, quindi il precedente opt-in Vercel non abilita GA4. Il modulo Analytics è caricato dinamicamente solo dopo opt-in e una inizializzazione fallita non viene memorizzata come Promise rejected permanente.

### VERIFY-LIVE prima del cutover

- confermare che Firebase resti Spark e che il site ID `thelogbook` punti al progetto atteso;
- configurare sul build frontend le env pubbliche necessarie, incluso Measurement ID GA4 e origin backend Vercel;
- configurare su Vercel `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` senza esporre secret al client;
- predisporre credenziali di deploy Firebase Hosting con minimo privilegio; nessun deploy da PR/branch;
- eseguire il deploy Hosting soltanto dallo SHA `main` già passato da Canonical Verification e soltanto dopo autorizzazione al cutover;
- verificare Auth popup/redirect, App Check, CORS, GA4 opt-in/revoca, PWA/offline e account deletion multi-device sul runtime reale;
- aggiornare Search Console per il nuovo origin senza rimuovere prematuramente la verifica della Production precedente.

Nessuna delle voci sopra è dichiarata live dal solo merge del codice.
