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
| Firebase Realtime Database | NON USATO DAL RUNTIME | nessuna opzione RTDB nel contratto client | codice |
| Firebase Storage | NON USATO DAL RUNTIME | nessuna opzione Storage nel contratto client | codice |
| Firebase Cloud Messaging | NON USATO DAL RUNTIME | nessuna opzione Messaging nel contratto client | codice |
| Firebase Hosting | MIGRATION TARGET / VERIFY-LIVE | target del candidato; stato live da verificare prima del cutover | `firebase.json` + Firebase console |
| Firebase Admin | ACTIVE | account deletion e manutenzione server trusted | Cloud Functions ADC con service account runtime dedicato |
| Firebase App Check + reCAPTCHA Enterprise / Google Cloud Fraud Defense | ACTIVE | attestazione anti-abuse prima dell'accesso cloud | Firebase App Check + Google Cloud |
| Vercel Hosting | CURRENT LIVE UNTIL CUTOVER / RETIRED IN TARGET | provider precedente; nessuna dipendenza nel candidato | Vercel VERIFY-LIVE + `vercel.json` con deploy Git disabilitato |
| Vercel Analytics / Speed Insights | RETIRED IN CANDIDATE | rimossi dal runtime target | codice candidato + Vercel VERIFY-LIVE |
| Google Analytics for Firebase | OPTIONAL / VERIFY-LIVE | statistiche di utilizzo non essenziali dopo opt-in | codice candidato + Firebase/Google Analytics console |
| Sentry | ACTIVE | error monitoring tecnico Production | Sentry + build Production |
| GitHub Actions / CodeQL / ruleset | ACTIVE | repository pubblico, PR, CI e SAST canonico | GitHub |
| Snyk | OPTIONAL | controllo security supplementare | integrazione Snyk esterna |
| Google Search Console | EXTERNAL-ONLY | verifica proprietà, sitemap e indicizzazione | Search Console + asset SEO repo |

## Firebase Hosting

Nel candidato di migrazione Firebase Hosting è configurato per pubblicare `dist/`, mantenere gli header di sicurezza/PWA e usare una SPA fallback. Il site ID reale non è hardcoded: il deploy genera una configurazione temporanea da `FIREBASE_HOSTING_SITE`. Finché il cutover non è stato eseguito, Vercel può continuare a servire la Production corrente, ma il candidato non usa un bridge cross-origin e non richiede funzioni Vercel.

I domini Firebase predefiniti possono comunque essere presenti nelle configurazioni Auth/OAuth perché appartengono al flusso Firebase Authentication: la loro presenza non dimostra che Firebase Hosting sia attivo.

## Firebase Authentication e OAuth

Firebase Authentication è il provider identità del prodotto. LogBook supporta autenticazione Google e credenziali email/password. Nel target, `authDomain` coincide con l’hostname canonico Firebase Hosting.

In Firebase Authentication → Settings devono risultare autorizzati soltanto i domini realmente necessari: localhost per sviluppo e l’hostname canonico Firebase Hosting; eventuali domini provider precedenti vanno rimossi dopo il cutover.

Il precedente dominio GitHub Pages è **ritirato**. Il 2026-09-30 è stato rimosso da Firebase Authentication → Authorized domains; non deve essere reintrodotto salvo nuova dipendenza runtime esplicita.

Nel Google OAuth Web Client auto-creato, le origini localhost servono lo sviluppo locale, l'origine Firebase Auth serve il flusso gestito dal provider e il redirect Firebase `__/auth/handler` è il callback OAuth gestito.

## Google API Browser key

La Firebase Web API key è configurazione client pubblica, non una credenziale Admin. La sua sicurezza dipende anche dalle restrizioni lato Google Cloud.

Le restrizioni HTTP referrer devono seguire i soli frontend realmente autorizzati. Nel target l’origin canonico Firebase Hosting è l’unico frontend Production.

Il vecchio referrer GitHub Pages è **ritirato**. Il 2026-09-30 è stato rimosso dalle restrizioni della Browser API key. Al cutover anche il referrer Vercel va rimosso quando non serve più.

## Firestore

Firestore è la replica remota per account autenticati, non la persistenza locale primaria. IndexedDB resta il boundary offline-first canonico.

Il runtime non importa Firebase Realtime Database e `VITE_FIREBASE_DATABASE_URL` non fa più parte del contratto client.

Analogamente, il runtime non importa Firebase Storage né Firebase Cloud Messaging; `VITE_FIREBASE_STORAGE_BUCKET` e `VITE_FIREBASE_MESSAGING_SENDER_ID` sono stati rimossi dal contratto fail-fast.

Le vecchie collection Firestore `telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono `LEGACY`: il client corrente invia errori/anomalie a Sentry, ma Rules, account deletion e retention cron restano finché i client vecchi e i documenti residui non sono definitivamente smaltiti.

## Firebase Admin e account deletion

Le Cloud Functions Firebase usano Application Default Credentials del runtime e non richiedono una private key Admin esportata. `LOGBOOK_FUNCTION_REGION`, `LOGBOOK_FUNCTION_SERVICE_ACCOUNT` e `LOGBOOK_ALLOWED_ORIGINS` sono parametri non segreti del deploy.

Il candidato non contiene Functions/cron Vercel e non usa `FIREBASE_ADMIN_*` o `CRON_SECRET`. Le eventuali credenziali/env rimaste nel provider precedente sono configurazione esterna da revocare dopo il cutover.

## App Check, reCAPTCHA Enterprise e Fraud Defense

LogBook usa `ReCaptchaEnterpriseProvider` tramite Firebase App Check per rendere più difficile l'accesso abusivo alle risorse Firebase.

Nella terminologia Google Cloud corrente, reCAPTCHA Enterprise è presentato come funzionalità della piattaforma Google Cloud Fraud Defense. Per LogBook questi nomi non indicano due integrazioni applicative separate: il codice usa **App Check + provider reCAPTCHA Enterprise**.

Verifica live del 2026-09-30: la Web App LogBook è registrata in Firebase App Check e la console la presenta con provider Fraud Defense/reCAPTCHA Enterprise. Cloud Firestore e Authentication mostravano 100% richieste verificate e 0% non verificate in modalità monitoraggio; l'enforcement non è stato attivato in questo task.

Nella chiave Google Cloud "Logbook Vercel":
- la verifica dominio è attiva;
- l'unico dominio configurato osservato è il dominio Production Vercel;
- Bot/Fraud Defense è attivo con soglia di rischio 0,5;
- Account defense non è configurato;
- SMS defense non è configurato;
- Transaction defense non è usato dal runtime LogBook e mostrava zero assessment;
- gli assessment log risultavano disabilitati.

L'ID/site key è configurazione client pubblica e non viene duplicato in questo registro; la Secret key reCAPTCHA non deve entrare nel browser né in env `VITE_*`.

Il cutover Vercel alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` è stato completato il 2026-09-30. Dopo un redeploy Production è stata rimossa `VITE_RECAPTCHA_V3_SITE_KEY`; un secondo redeploy sullo stesso SHA ha risposto HTTP 200, ha incorporato la site key Enterprise nel bundle e non ha mostrato runtime error. I fallback `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` sono quindi ritirati dal contratto applicativo.

## Vercel

Vercel è il provider Production di LogBook.

Nel candidato `vercel.json` imposta `deploymentEnabled: false`: nessun branch, incluso `main`, deve generare nuovi deployment Git Vercel dopo l’adozione del candidato.

La CSP segue il principio di allowlist minima. LogBook usa font di sistema e non carica Google Fonts: gli origin `fonts.googleapis.com`/`fonts.gstatic.com` sono stati rimossi nella seconda passata del 2026-09-30 insieme agli origin Realtime Database non usati.

Il codice target richiede sei variabili pubbliche Firebase/deployment lato client:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_FUNCTION_REGION`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

Nel workflow Production `VITE_FIREBASE_FUNCTION_REGION` deriva dalla singola repository variable `FIREBASE_FUNCTION_REGION`; il preflight rifiuta configurazioni in cui regione client e regione deploy divergono.

Il `measurementId` GA4 era stato rimosso dal vecchio deployment Vercel il 2026-09-30 quando Firebase Analytics non faceva parte del prodotto. La decisione di prodotto del 2026-10-01 introduce invece Google Analytics nel **nuovo target Firebase**: il valore Production deve vivere nella configurazione GitHub/Firebase del nuovo delivery, non essere reintrodotto come dipendenza Vercel.

Production usa inoltre `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT`; il token è build-only e non deve entrare nel bundle o nel repository.

La configurazione Production non viene più duplicata in un file `.env.production` versionato. La seconda passata del 2026-09-30 ha rimosso quel file: conteneva soltanto configurazione Firebase Web pubblica, non segreti Admin, ma duplicava identificatori/endpoints reali senza necessità. Il contratto resta in `.env.example`; i valori target Production vivono in GitHub/Firebase/Google Cloud. CI/E2E usa valori sintetici espliciti.

### Scope Vercel registrati

Inventario fornito dal product owner il 2026-09-30, da verificare live prima di modifiche:

| Famiglia env | Scope riportato | Nota |
|---|---|---|
| quattro `VITE_FIREBASE_*` storiche usate dal client Vercel | Production corrente | configurazione Firebase Web della vecchia Production |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Production | site key pubblica canonica App Check |
| env Sentry (`VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) | Production | Error Monitoring/source map |
| `VITE_FIREBASE_MEASUREMENT_ID` | RIMOSSA DALLA PRODUCTION VERCEL | verrà configurata nel target Firebase/GitHub, non nel provider ritirato |
| `VITE_RECAPTCHA_V3_SITE_KEY` | RIMOSSA | alias legacy ritirato dopo cutover Enterprise |


## Vercel Analytics / Speed Insights

Il candidato Firebase li rimuove dal bundle e dalla UI. La decisione di prodotto del 2026-10-01 introduce Google Analytics for Firebase come sostituzione, ma **non eredita il consenso Vercel**: `logbook_analytics_consent` viene ritirata e il nuovo opt-in usa `logbook_google_analytics_consent_v1`, default OFF.

## Google Analytics for Firebase

Il runtime target carica `firebase/analytics` soltanto in Production e dopo consenso esplicito. Consent Mode concede soltanto `analytics_storage` dopo opt-in e mantiene negati `ad_storage`, `ad_user_data`, `ad_personalization`, `functionality_storage`, `personalization_storage` e `security_storage`; inoltre il codice disabilita Google Signals e advertising personalization. Non vengono definiti eventi custom workout/nutrizione/misure, né vengono deliberatamente inviati UID Firebase o email.

**VERIFY-LIVE prima del cutover:** Firebase deve essere collegato alla proprietà Google Analytics corretta e alla Web data stream corretta; measurement ID, retention, data sharing, Google Signals, Ads personalization/links e impostazioni territoriali devono essere verificati direttamente in console. Nel target iniziale la **Misurazione avanzata** resta disabilitata per evitare raccolta automatica di scroll, outbound click, ricerca sito, download, interazioni form e video; resta la misurazione standard pagina/sessione dopo opt-in. Il repository dimostra il comportamento client, non lo stato della proprietà GA.

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

Al consolidamento del 2026-10-01 il ruleset `protect main branch` è attivo sulla default branch e richiede `Canonical Verification`, status check strict, pull request, risoluzione delle review conversation, cronologia lineare e squash merge; non risultano bypass configurati. Non risulta una regola separata di code scanning nel ruleset osservato.

CodeQL è parte del gate canonico perché `Canonical Verification` dipende dal job `Security / CodeQL`. Il job fallisce se l'analisi non viene eseguita/caricata correttamente; un alert CodeQL, invece, non va assunto automaticamente bloccante senza una regola di code scanning nel ruleset. Le review conversation generate da CodeQL restano soggette al requisito di risoluzione del ruleset. Il nome `Canonical Verification` non deve essere cambiato senza verificare il ruleset GitHub.

Dependabot è configurato nel repository per controlli settimanali sia delle dipendenze npm sia delle GitHub Actions, con massimo 10 PR aperte per ciascun ecosistema. È automazione di manutenzione, non un bypass: le sue PR devono attraversare gli stessi guardrail di `main`.

## Snyk

Snyk è un controllo security **supplementare**, non la fonte canonica della decisione di merge.

Il repository contiene `.snyk`, che esclude test/test files dalla relativa analisi. Non esiste un workflow Snyk nel repository corrente: l'eventuale check deriva dall'integrazione esterna.

Limiti quota o indisponibilità Snyk non devono eliminare l'analisi SAST canonica: l'esecuzione CodeQL resta una dipendenza bloccante di `Canonical Verification`, mentre gli alert prodotti vanno verificati e risolti secondo l'enforcement GitHub realmente configurato.

## Google Search Console e indicizzazione

La proprietà Search Console corrente può ancora corrispondere al sito Production Vercel fino al cutover; il nuovo origin Firebase richiede verifica/sitemap dedicata. L'integrazione serve a dimostrare il controllo del sito, presentare/controllare la sitemap, consentire crawling/indicizzazione e osservare lo stato degli URL.

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
- la Web key reCAPTCHA Enterprise/Fraud Defense osservata autorizza il solo dominio Production Vercel e mantiene attiva la verifica dominio.

## Checklist annuale

1. verificare domini Firebase Auth;
2. verificare restrizioni Browser API key e OAuth origins/redirect;
3. verificare App Check e dominio/key reCAPTCHA Enterprise;
4. dopo il cutover revocare env/credenziali e integrazioni Vercel residue;
5. verificare cron e Functions;
6. verificare GitHub ruleset/required check;
7. verificare Google Analytics: data stream, consent, retention/data sharing e assenza di funzionalità Ads non deliberate;
8. verificare Sentry privacy, Spike Protection e feature non richieste ancora disattivate;
9. verificare Snyk come supplementare e CodeQL come gate;
10. verificare Search Console, sitemap, robots e canonical Production URL;
11. rimuovere origin, chiavi e integrazioni legacy non più necessarie.
