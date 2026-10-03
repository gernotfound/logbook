# Registro servizi esterni TheLogBook

> Stato: registro operativo stabile. Ultimo consolidamento: 2026-10-02.
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
| Firebase Realtime Database | NON USATO DAL RUNTIME | modulo RTDB e relativa env client ritirati dal contratto | codice |
| Firebase Storage | NON USATO DAL RUNTIME | modulo Storage e relativa env client ritirati dal contratto | codice |
| Firebase Cloud Messaging | NON USATO DAL RUNTIME | modulo Messaging e relativa env client ritirati dal contratto | codice |
| Firebase Hosting | ACTIVE | frontend/PWA Production su `thelogbook.web.app`, deploy exact-SHA da GitHub Actions | Firebase Hosting + workflow Production |
| Firebase Admin | ACTIVE | account deletion e manutenzione server trusted | Vercel env + Vercel Functions |
| Firebase App Check + reCAPTCHA Enterprise / Google Cloud Fraud Defense | ACTIVE | attestazione anti-abuse prima dell'accesso cloud | Firebase App Check + Google Cloud |
| Vercel Functions / Cron | ACTIVE | backend trusted account-deletion/recovery, cron e redirect del vecchio root verso Firebase | Vercel + `vercel.json` |
| Vercel Analytics / Speed Insights | RITIRATO | non fanno più parte del frontend Production | codice + cronologia cutover |
| Google Analytics / GA4 | OPTIONAL / ACTIVE ARCHITECTURE | analytics di utilizzo del frontend Firebase, default OFF e lazy dopo consenso provider-specific | Google Analytics + Firebase + codice consenso |
| Sentry | ACTIVE | error monitoring tecnico Production e source map del frontend Firebase Hosting | Sentry + build Firebase Hosting |
| GitHub Actions / CodeQL / ruleset | ACTIVE | repository pubblico, PR, CI e SAST canonico | GitHub |
| Snyk | OPTIONAL | controllo security supplementare | integrazione Snyk esterna |
| Google Search Console | EXTERNAL-ONLY | verifica proprietà, sitemap e indicizzazione | Search Console + asset SEO repo |

## Firebase Hosting

Firebase Hosting è il provider del frontend/PWA Production di TheLogBook dal cutover verificato del 2026-10-02. Vercel resta esclusivamente backend trusted/cron e redirect del vecchio root.

Preparazione live verificata il 2026-10-01:

- è stato creato e scelto come hostname target `thelogbook.web.app`;
- il nome pubblico scelto per il progetto/servizio è **TheLogBook**;
- il progetto Firebase deve restare sul piano **Spark**: non è autorizzato il passaggio a Blaze;
- di conseguenza il target futuro non deve dipendere da Cloud Functions for Firebase o Scheduled Functions che richiedano Blaze;
- Vercel può restare come boundary serverless gratuito per Functions/Cron mentre il frontend migra a Firebase Hosting.

Questa preparazione era il checkpoint pre-cutover; il passaggio a Firebase Hosting è stato poi completato e verificato il 2026-10-02 come registrato più avanti.

I domini Firebase predefiniti possono comunque essere presenti nelle configurazioni Auth/OAuth perché appartengono al flusso Firebase Authentication; la loro presenza non dimostra da sola che Firebase Hosting sia Production.

## Firebase Authentication e OAuth

Firebase Authentication è il provider identità del prodotto. TheLogBook supporta autenticazione Google e credenziali email/password.

Stato live verificato il 2026-10-02 dopo il cutover:

- Firebase Project e Web App hanno display name **TheLogBook**;
- Firebase Authentication → Authorized domains contiene `localhost`, i due domini Firebase predefiniti e `thelogbook.web.app`; il vecchio frontend `logbook-gnf.vercel.app` è stato rimosso;
- email/password è abilitato e Improved Email Privacy è attivo;
- la password policy server è in modalità **ENFORCE**: minimo 8 caratteri, almeno una maiuscola, una minuscola, un numero e un carattere non alfanumerico; `forceUpgradeOnSignin` resta disattivato per non bloccare credenziali preesistenti al solo accesso;
- il default locale Firebase Auth è stato impostato su `it` e il client imposta esplicitamente `auth.languageCode = 'it'` per mantenere coerenti le azioni email avviate dalla PWA;
- il callback delle email action gestite dal template Firebase resta sul dominio Firebase predefinito `firebaseapp.com`: il tentativo di migrazione al site `thelogbook.web.app` è stato rifiutato dal provider con `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`. Per questo il dominio Firebase predefinito resta una dipendenza Auth legittima e non va rimosso dalle allowlist;
- il Web OAuth client era già stato predisposto con origine `https://thelogbook.web.app` e redirect `https://thelogbook.web.app/__/auth/handler`; la rimozione di eventuali valori OAuth Vercel residui resta **VERIFY-LIVE** finché non viene osservata direttamente nel relativo client Google Cloud.

Il precedente dominio GitHub Pages è **ritirato** dal 2026-09-30 e non deve essere reintrodotto salvo nuova dipendenza runtime esplicita.

## Google API Browser key

La Firebase Web API key è configurazione client pubblica, non una credenziale Admin. La sua sicurezza dipende anche dalle restrizioni lato Google Cloud.

Stato live verificato il 2026-10-02:

- la chiave browser auto-creata da Firebase è limitata a **Siti web**;
- i referrer correnti sono il dominio Firebase predefinito necessario alle email action Auth e `https://thelogbook.web.app/*`; il vecchio referrer Vercel è stato rimosso;
- le restrizioni API restano l'allowlist Firebase auto-gestita già presente. Non è stata ristretta artificialmente: Firebase documenta la Web API key come configurazione client pubblica e la protezione applicativa resta affidata a Rules, Auth e App Check;
- l'API Keys API di Google Cloud è stata abilitata come control plane per applicare e verificare questa pulizia; non introduce un nuovo servizio runtime della PWA.

Il vecchio referrer GitHub Pages è **ritirato** dal 2026-09-30.

## Firestore

Firestore è la replica remota per account autenticati, non la persistenza locale primaria. IndexedDB resta il boundary offline-first canonico.

Il runtime non importa Firebase Realtime Database e `VITE_FIREBASE_DATABASE_URL` è stato ritirato dal contratto client; non esistono quindi motivi runtime per allowlist `firebaseio.com` nella CSP.

Analogamente, il runtime non importa Firebase Storage né Firebase Cloud Messaging e le vecchie env `VITE_FIREBASE_STORAGE_BUCKET` / `VITE_FIREBASE_MESSAGING_SENDER_ID` sono state ritirate dal contratto client.

Le vecchie collection Firestore `telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono `LEGACY`: il client corrente invia errori/anomalie a Sentry, ma Rules, account deletion e retention cron restano finché i client vecchi e i documenti residui non sono definitivamente smaltiti.

Verifica live 2026-10-02 del database `(default)`: Firestore Native Standard in regione `europe-west12`, free tier attivo, PITR disabilitato e **delete protection abilitata** per impedire la cancellazione accidentale del database. PITR/backup gestiti non vengono attivati sul piano Spark perché richiedono fatturazione.

## Firebase Admin e account deletion

Le Vercel Functions di account deletion richiedono per contratto:

- `FIREBASE_ADMIN_PROJECT_ID`;
- `FIREBASE_ADMIN_CLIENT_EMAIL`;
- `FIREBASE_ADMIN_PRIVATE_KEY`;
- `CRON_SECRET`.

Tutte sono server-only e nessuna deve avere prefisso `VITE_`.

Verifica live del 2026-09-30: in Vercel Production risultano presenti `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` e `CRON_SECRET`. I valori non sono registrati qui. Una chiave Admin generata accidentalmente durante la verifica è stata eliminata subito senza essere usata o installata.

## App Check, reCAPTCHA Enterprise e Fraud Defense

TheLogBook usa `ReCaptchaEnterpriseProvider` tramite Firebase App Check per rendere più difficile l'accesso abusivo alle risorse Firebase.

Nella terminologia Google Cloud corrente, reCAPTCHA Enterprise è presentato come funzionalità della piattaforma Google Cloud Fraud Defense. Per TheLogBook questi nomi non indicano due integrazioni applicative separate: il codice usa **App Check + provider reCAPTCHA Enterprise**.

Verifica live aggiornata il 2026-10-02:

- la Web App TheLogBook è registrata in Firebase App Check con provider Fraud Defense/reCAPTCHA Enterprise;
- provider Enterprise configurato con TTL token **3600 s** e soglia score **0,5**;
- enforcement **ENFORCED** su Cloud Firestore, Firebase Authentication/Identity Toolkit e Realtime Database;
- la replay protection dei servizi Firebase gestiti resta OFF; è distinta dal backend custom Vercel, che continua a consumare token App Check limited-use e a rifiutarne il replay;
- la chiave Web **TheLogBook Web** mantiene la verifica dominio attiva, `allowAllDomains=false`, AMP disabilitato e autorizza soltanto `thelogbook.web.app`; il vecchio dominio Vercel è stato rimosso.

Bot/Fraud Defense resta il boundary App Check osservato; Account defense, SMS defense e Transaction defense non fanno parte del runtime TheLogBook salvo futura decisione esplicita e verifica live.

L'ID/site key è configurazione client pubblica e non viene duplicato in questo registro; la Secret key reCAPTCHA non deve entrare nel browser né in env `VITE_*`.

Il cutover Vercel alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` è stato completato il 2026-09-30. Dopo un redeploy Production è stata rimossa `VITE_RECAPTCHA_V3_SITE_KEY`; un secondo redeploy sullo stesso SHA ha risposto HTTP 200, ha incorporato la site key Enterprise nel bundle e non ha mostrato runtime error. I fallback `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` sono quindi ritirati dal contratto applicativo.

## Vercel backend

Vercel è il boundary **backend trusted Production** di TheLogBook. Il frontend/PWA Production è Firebase Hosting; Vercel mantiene soltanto le Functions native di account deletion/recovery, il cron giornaliero e il redirect del vecchio hostname verso `https://thelogbook.web.app/`.

Il redirect del root legacy deve usare **HTTP 301** esplicito: `vercel.json` usa `statusCode: 301`, così il pre-check dello strumento Search Console **Cambio di indirizzo** vede il codice richiesto da Google. Un redirect temporaneo 307 o il generico `permanent: true` di Vercel, che produce 308, non soddisfano questo contratto operativo specifico. Gli endpoint `/api/*` restano esclusi da questo redirect e continuano a servire il backend trusted.

Il repository abilita l'integrazione Git Vercel soltanto da `main` e impone `framework: null` / Fluid Compute tramite `vercel.json`. I branch di sviluppo non generano Preview Deployment. Dal 2026-10-02 un `ignoreCommand` selettivo evita nuovi deployment Production quando un commit modifica soltanto il frontend Firebase o documentazione non rilevante per il backend; modifiche a `api/`, `server/`, `vercel.json`, dipendenze/runtime o configurazione TypeScript server continuano invece a produrre automaticamente il deployment Vercel. Se il confronto con l'ultimo deployment riuscito non è disponibile o fallisce, il selettore consente il deployment per non lasciare indietro il backend.

Le configurazioni server-only che appartengono al runtime Vercel sono:

- `FIREBASE_ADMIN_PROJECT_ID`;
- `FIREBASE_ADMIN_CLIENT_EMAIL`;
- `FIREBASE_ADMIN_PRIVATE_KEY`;
- `CRON_SECRET`;
- `PUBLIC_APP_ORIGIN=https://thelogbook.web.app`.

`PUBLIC_APP_LEGACY_ORIGIN` è ritirata dal contratto applicativo post-cutover e non deve essere reintrodotta.

## Firebase Hosting build configuration

La configurazione pubblica del frontend Production viene fornita al workflow GitHub Actions che costruisce e distribuisce Firebase Hosting, non al runtime Vercel:

- quattro env Firebase Web core: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`;
- `VITE_FIREBASE_MEASUREMENT_ID`, usata soltanto da GA4 dopo consenso;
- `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`;
- `VITE_ACCOUNT_DELETION_API_ORIGIN`, che punta al backend trusted Vercel;
- `VITE_SENTRY_DSN`.

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` sono build-only nel workflow Firebase Hosting Production per release/source map. Il token non entra nel bundle client.

Realtime Database, Firebase Storage e Cloud Messaging non fanno parte del runtime corrente; le relative vecchie env client sono ritirate. La configurazione Production non viene duplicata in un file `.env.production` versionato; `.env.example` documenta solo il contratto e CI/E2E usa valori sintetici.

## Google Analytics / GA4

Dal cutover del 2026-10-02 GA4 fa parte dell'architettura Production del frontend Firebase Hosting, ma resta disabilitato per default e viene caricato soltanto dopo il nuovo consenso provider-specific `logbook_ga4_consent_v1`.

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

Questa configurazione è deliberatamente privacy-minimal. Il passaggio applicativo a GA4 è stato completato nel cutover; il precedente consenso Vercel non abilita GA4 e la raccolta resta subordinata al nuovo opt-in.

## Vercel Analytics / Speed Insights

Sono ritirati dal frontend Production dopo il cutover Firebase Hosting. Il nuovo consenso GA4 è provider-specific e non riattiva Vercel Analytics/Speed Insights.

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

La precedente proprietà Search Console corrisponde al vecchio frontend Vercel. Il canonical Production è `https://thelogbook.web.app/` e la relativa proprietà URL-prefix è stata verificata il 2026-10-02 con lo stesso account Google usato per la proprietà legacy.

Il repository mantiene deliberatamente:

- meta tag di verifica Google in `index.html`;
- file statico di verifica Google sotto `public/`;
- `public/robots.txt` con crawling consentito e riferimento alla sitemap;
- `public/sitemap.xml` con URL canonico Production.

Verifica live 2026-10-02: homepage, `robots.txt` e `sitemap.xml` rispondono HTTP 200; la homepage espone canonical autoreferenziale `https://thelogbook.web.app/`; la sitemap `https://thelogbook.web.app/sitemap.xml` è stata inviata tramite Search Console API con 0 warning e 0 errori iniziali ed è in attesa del primo download di Google. La prima URL Inspection della homepage riporta ancora `URL is unknown to Google`, stato atteso per una proprietà appena creata e non ancora scansionata.

Non rimuovere i meccanismi di verifica solo perché la proprietà è già stata accettata. Durante la migrazione mantenere inoltre il redirect HTTP 301 dal vecchio root Vercel al nuovo canonical; dopo la verifica live del 301 eseguire il pre-check e la richiesta **Cambio di indirizzo** dalla vecchia proprietà, quindi monitorare l'indicizzazione finché Google non ha elaborato il nuovo URL.

## GitHub Pages — hosting ritirato

GitHub Pages non è più un hosting TheLogBook.

Audit repository 2026-09-30:

- nessun hostname GitHub Pages è referenziato dal runtime/config corrente;
- non esiste workflow `gh-pages`/Pages né branch `gh-pages`;
- GitHub API riporta `has_pages: false`;
- GitHub Pages non partecipa alla Production; il frontend Production corrente è Firebase Hosting;
- il vecchio test auto-contenuto di base path dinamico `/logbook/` è stato rimosso perché non esercitava la configurazione reale; il contratto PWA corrente verifica `start_url` e `scope` alla radice `/`.

Pulizia esterna completata/verificata il 2026-09-30:
- il vecchio dominio GitHub Pages è stato rimosso da Firebase Authentication → Authorized domains;
- il vecchio referrer GitHub Pages è stato rimosso dalla Browser API key;
- il Web OAuth client descritto non riportava GitHub Pages;
- la Web key reCAPTCHA Enterprise/Fraud Defense manteneva attiva la verifica dominio; dal 2026-10-01 autorizzava il vecchio frontend Vercel e `thelogbook.web.app` in preparazione al cutover. Il vecchio dominio resta una pulizia esterna post-cutover.

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


## Preparazione live cutover — 2026-10-02 (storico)

Questa sezione conserva le operazioni e verifiche esterne eseguite **prima** della PR #191. Le frasi al presente descrivono esclusivamente quel checkpoint storico; lo stato corrente è quello delle sezioni Production e `Cutover Production verificato`.

### Firebase / Google Cloud

- Firebase Hosting: site ID `thelogbook`, dominio target `https://thelogbook.web.app`, progetto ancora su piano **Spark** e nessuna release Hosting presente al momento della verifica.
- Firestore: creati e portati a stato **Abilitato** i due indici compositi di `account_deletions` richiesti dal candidato: `status ASC + retryable ASC` e `status ASC + purgeAfter ASC`.
- Firebase Authentication: `thelogbook.web.app` è presente negli Authorized domains; il dominio Vercel corrente resta temporaneamente autorizzato per cutover/rollback.
- OAuth Web client: verificati origine JavaScript `https://thelogbook.web.app` e redirect `https://thelogbook.web.app/__/auth/handler`; mantenuti i valori Firebase preesistenti.
- Browser API key Firebase: restrizione applicazione su **Siti web**; referrer verificati per Vercel corrente, `thelogbook.web.app` e dominio Firebase necessario al flusso Auth. Le restrizioni API restano esplicite e non sono state ristrette durante il cutover.
- App Check / reCAPTCHA Enterprise: chiave **TheLogBook Web**, verifica dominio attiva, AMP disabilitato, domini autorizzati Vercel + `thelogbook.web.app`. Firestore e Authentication risultavano 100% verificati / 0% non verificati in modalità monitoraggio; enforcement non attivato.
- Il service account Firebase Admin usato dal backend Vercel dispone già del permesso effettivo `firebaseappcheck.appCheckTokens.verify` tramite il ruolo Firebase App Check Admin; non è stato aggiunto un ruolo ridondante durante questa preparazione.

### GitHub Actions / Workload Identity Federation

- Creato Workload Identity Pool `github-logbook` e provider OIDC `github-actions` con issuer GitHub Actions.
- Mapping provider: `google.subject <- assertion.sub`, `attribute.repository_id <- assertion.repository_id`, `attribute.repository_owner_id <- assertion.repository_owner_id`.
- La condition del provider vincola gli ID immutabili del repository e dell'owner di `gernotfound/logbook`; l'impersonation dei deployer è concessa tramite `roles/iam.workloadIdentityUser` al principal del repository, non al pool intero.
- Il deploy Firebase Hosting usa un service account dedicato, senza chiavi private JSON, referenziato dalla repository variable `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`; i privilegi progetto restano limitati a Firebase Hosting Admin e API Keys Viewer. Il workflow `Firebase Hosting Production` usa questa identità solo per `firebase deploy --only hosting`.
- Il deploy Firestore Production usa un secondo service account dedicato e separato, anch'esso senza chiavi private JSON, referenziato dalla repository variable `GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT`; i privilegi progetto sono limitati a Firebase Rules Admin, Cloud Datastore Index Admin, API Keys Viewer e Service Usage Viewer. Il workflow `Firebase Firestore Production` usa questa identità solo per Rules e indici Firestore.
- Entrambi i workflow condividono soltanto il riferimento al provider OIDC tramite `GCP_WORKLOAD_IDENTITY_PROVIDER`; le due variabili service-account non sono duplicati e non sono intercambiabili.
- Configurate le repository variables richieste dal workflow Firebase Hosting: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_ACCOUNT_DELETION_API_ORIGIN`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, `VITE_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
- Configurata inoltre la repository variable `GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT` per il workflow Firestore Production.
- Configurato il repository secret `SENTRY_AUTH_TOKEN`. Nessun valore segreto viene registrato nel repository.
- Preflight read-only Hosting eseguito da GitHub Actions il 2026-10-02: autenticazione OIDC/WIF riuscita con il service account dedicato e lettura del sito Hosting `thelogbook` riuscita tramite Firebase CLI.
- Verifica live Firestore Production del 2026-10-03: l'impersonation WIF del deployer Firestore è riuscita; il preflight ha letto Rules e indici, Firebase CLI ha verificato l'API Firestore tramite Service Usage Viewer, ha applicato `firestore.rules` e `firestore.indexes.json`, e il read-back finale ha confermato Rules live allineate alla sorgente e i 2 indici compositi `account_deletions` in stato `READY`.

### Vercel backend

- La Production Vercel verificata resta READY sullo SHA corrente di `main`; non è stato effettuato alcun redeploy per la sola modifica delle env e non risultavano runtime error nelle 24 ore osservate.
- Confermata la presenza delle env server-only Firebase Admin e `CRON_SECRET` senza esporne i valori.
- Durante la finestra di cutover erano state configurate `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` e la temporanea `PUBLIC_APP_LEGACY_ORIGIN=https://logbook-gnf.vercel.app`. Il supporto applicativo al legacy origin è stato poi ritirato dopo gli smoke verdi.

### Google Analytics / GA4

- Stream Web **TheLogBook** verificato su `https://thelogbook.web.app`; Measurement ID coerente con la repository variable configurata per il build.
- Misurazione avanzata OFF, Google Signals OFF, raccolta dati forniti dagli utenti OFF, dati granulari posizione/dispositivo OFF e personalizzazione annunci consentita in 0 regioni.
- Retention eventi e utenti: 2 mesi; reset retention su nuova attività OFF.
- Filtro `Internal Traffic`: stato Test.
- Collegamento Firebase presente con integrazione segmenti di pubblico migliorata OFF; Google Ads e AdMob: 0 collegamenti.

### Sentry

- Creata integrazione interna dedicata al build GitHub/Firebase Hosting con solo capacità **Continuous Integration (CI)**; il token generato è conservato esclusivamente come GitHub Secret `SENTRY_AUTH_TOKEN`.
- `Allowed Domains` del progetto è stato ristretto ai due frontend ammessi durante il cutover: `https://thelogbook.web.app` e `https://logbook-gnf.vercel.app`.
- Un Project Security Token visualizzato durante la configurazione è stato ruotato; il nuovo valore non è registrato né usato come `SENTRY_AUTH_TOKEN`.

## Cutover Production verificato — 2026-10-02

- PR #191 squash-merged; `main` reale dopo il merge: `edf164e3e410a650d1390b9cbe92344fa1fb9501`.
- `Milestone Verification` post-merge #1123 / run `36992742404`: success; `Canonical Verification`, CodeQL, Rules, E2E, build/M7-M8, hardening/stress e unit/integration verdi sullo SHA di `main`.
- Workflow `Firebase Hosting Production` run `36992998590`: success sullo stesso SHA, WIF riuscita, build Production completata e deploy limitato a Hosting.
- Firebase Hosting ha rilasciato il site `thelogbook`; smoke automatico HTTP verde su app shell e `sw.js`, entrambi con cache policy no-cache/no-store/must-revalidate, e canonical `https://thelogbook.web.app/`.
- Sentry ha creato la release sullo SHA di `main` e l'upload source-map del build Firebase Hosting è riuscito.
- Vercel Production deployment `dpl_GBkkFGbvLczGmBjVe7MV9A4ssKTu` è READY sullo stesso SHA. Il root Vercel reindirizza al nuovo frontend Firebase; gli endpoint account-deletion restano serverless Vercel.
- Smoke browser reale eseguito dal product owner: il popup Google mostra `thelogbook.web.app` e il login completa correttamente entrando nell'account.
- Nei log Vercel successivi allo smoke, `/api/account-deletion-device` ha risposto con 200 alle richieste applicative e 204 ai preflight; le sonde senza origin autorizzata hanno prodotto 403. Questo verifica il boundary CORS del nuovo origin e il percorso di registrazione recovery autenticato/App Check limited-use.
- Nessun runtime error Vercel è emerso nella finestra post-cutover osservata.
- Le segnalazioni Chrome `runtime.lastError` / `background.js` osservate durante il login non corrispondono a file del repository TheLogBook e sono compatibili con messaggistica di estensioni browser. Gli avvisi Firebase Auth `Cross-Origin-Opener-Policy ... window.closed` sono stati osservati con login riuscito; il frontend non configura un header COOP globale e non viene introdotto un workaround che potrebbe alterare il popup OAuth.
- Pulizia Firebase/Google Cloud del 2026-10-02: vecchio origin Vercel rimosso da Firebase Auth Authorized domains, Browser API key e reCAPTCHA Enterprise; App Check portato in enforcement. Restano **VERIFY-LIVE** l'eventuale origin/redirect Vercel nel Web OAuth client, la rimozione Vercel dalla allowlist Sentry e la proprietà Search Console del nuovo origin. Il callback email Auth resta deliberatamente sul dominio Firebase predefinito finché il provider rifiuta il cambio con `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`.

## Archivio decisionale — candidato PR #191

Questa sezione conserva il razionale del candidato PR #191 ormai mergiato. Il frontend/PWA Production è `https://thelogbook.web.app`, Firebase resta Spark e Hosting serve esclusivamente asset statici; nessuna Cloud Function, Scheduled Function, Cloud Scheduler o Cloud Run è richiesta dal runtime.

Vercel resta il boundary trusted server-only: `/api/account-deletion`, `/api/account-deletion-device` e il cron giornaliero `/api/account-deletion-cron`. Il frontend usa un origin Vercel esplicito e il backend accetta CORS soltanto dall'origin pubblico configurato (`PUBLIC_APP_ORIGIN`, fallback `https://thelogbook.web.app`), con App Check e autenticazione/credential specifica per il flusso.

GA4 ha sostituito Vercel Analytics/Speed Insights. Il consenso usa una nuova chiave provider-specific, quindi il precedente opt-in Vercel non abilita GA4. Il modulo Analytics è caricato dinamicamente solo dopo opt-in e una inizializzazione fallita resta ritentabile.

### Checklist pre-cutover storica

- confermare che Firebase resti Spark e che il site ID `thelogbook` punti al progetto atteso;
- configurare sul build frontend le env pubbliche necessarie, incluso `VITE_FIREBASE_AUTH_DOMAIN=thelogbook.web.app`, Measurement ID GA4 e origin backend Vercel;
- verificare che Vercel applichi `framework: null` (preset Other/backend-only) e `fluid: true` dal repository, così non resta dipendente dal preset Vite del frontend e le Functions conservano il runtime atteso; configurare su Vercel `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` senza esporre secret al client; durante la sola finestra di cutover/rollback usare anche `PUBLIC_APP_LEGACY_ORIGIN=https://logbook-gnf.vercel.app`, da rimuovere dopo smoke verdi;
- predisporre Workload Identity Federation per il workflow `Firebase Hosting Production`, vincolando l'impersonation al repository `gernotfound/logbook`; al deployer Hosting servono `roles/firebasehosting.admin` e `roles/serviceusage.apiKeysViewer`, senza ruoli Functions/Cloud Run/Firestore; nessun deploy da PR/branch e nessuna nuova chiave privata JSON se WIF è disponibile;
- eseguire il deploy Hosting soltanto dallo SHA `main` già passato da Canonical Verification; il workflow post-gate ricontrolla che lo SHA sia ancora l'attuale `origin/main` e deploya esclusivamente Hosting;
- verificare `roles/firebaseappcheck.tokenVerifier` sul service account Firebase Admin di Vercel, quindi verificare che possa consumare token App Check limited-use e che un token già consumato venga rifiutato; quindi verificare Auth popup/redirect, App Check, CORS, GA4 opt-in/revoca, PWA/offline e account deletion multi-device sul runtime reale;
- aggiornare Search Console per il nuovo origin senza rimuovere prematuramente la verifica della Production precedente.

Le voci effettivamente concluse sono registrate nella sezione `Cutover Production verificato — 2026-10-02`; le configurazioni esterne non ancora riesaminate dopo il cutover restano esplicitamente indicate come cleanup pendente.
