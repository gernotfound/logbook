# Registro servizi esterni LogBook

> Stato: registro operativo stabile. Ultimo consolidamento: 2026-09-30.
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
| Firebase Hosting | NON USATO DAL RUNTIME / VERIFY-LIVE | non è l'hosting Production corrente | `firebase.json` + Firebase console |
| Firebase Admin | ACTIVE | account deletion e manutenzione server trusted | Vercel env + Vercel Functions |
| Firebase App Check + reCAPTCHA Enterprise / Google Cloud Fraud Defense | ACTIVE | attestazione anti-abuse prima dell'accesso cloud | Firebase App Check + Google Cloud |
| Vercel Hosting / Functions / Cron | ACTIVE | Production PWA, API trusted e cron | Vercel + `vercel.json` |
| Vercel Analytics / Speed Insights | OPTIONAL | analytics/performance con opt-in | Vercel + consenso client |
| Sentry | ACTIVE | error monitoring tecnico Production | Sentry + build Vercel |
| GitHub Actions / CodeQL / ruleset | ACTIVE | repository pubblico, PR, CI e SAST canonico | GitHub |
| Snyk | OPTIONAL | controllo security supplementare | integrazione Snyk esterna |
| Google Search Console | EXTERNAL-ONLY | verifica proprietà, sitemap e indicizzazione | Search Console + asset SEO repo |

## Firebase Hosting

Firebase Hosting **non è il provider di hosting del runtime corrente di LogBook**. Nel repository `firebase.json` configura soltanto le Firestore Rules e non contiene una sezione `hosting`; la Production corrente è Vercel. Questo non prova che nella console Firebase non esista un sito Hosting storico: quello stato resta `VERIFY-LIVE` finché la console non viene controllata.

I domini Firebase predefiniti possono comunque essere presenti nelle configurazioni Auth/OAuth perché appartengono al flusso Firebase Authentication: la loro presenza non dimostra che Firebase Hosting sia attivo.

## Firebase Authentication e OAuth

Firebase Authentication è il provider identità del prodotto. LogBook supporta autenticazione Google e credenziali email/password. Il dominio di autenticazione Firebase resta parte del redirect OAuth, mentre l'applicazione Production è servita da Vercel.

In Firebase Authentication → Settings devono risultare autorizzati soltanto i domini realmente necessari: localhost per sviluppo, i domini Firebase predefiniti necessari al flusso Auth e il dominio canonico Production Vercel.

Un precedente dominio GitHub Pages è **ritirato e non deve restare autorizzato**. Al consolidamento del 2026-09-30 il product owner ha segnalato che era ancora presente nella console: rimuoverlo manualmente e poi verificare login Google/email in Production.

Nel Google OAuth Web Client auto-creato, le origini localhost servono lo sviluppo locale, l'origine Firebase Auth serve il flusso gestito dal provider e il redirect Firebase `__/auth/handler` è il callback OAuth gestito.

## Google API Browser key

La Firebase Web API key è configurazione client pubblica, non una credenziale Admin. La sua sicurezza dipende anche dalle restrizioni lato Google Cloud.

Le restrizioni HTTP referrer devono seguire i soli frontend realmente autorizzati. Il dominio Vercel Production e l'origine Firebase necessaria al flusso Auth sono intenzionali.

Il vecchio referrer GitHub Pages è **ritirato**. È stato segnalato ancora presente nella Browser key al 2026-09-30 e va rimosso dalla console Google Cloud. Non conservarlo “per sicurezza”: allarga inutilmente la superficie autorizzata.

## Firestore

Firestore è la replica remota per account autenticati, non la persistenza locale primaria. IndexedDB resta il boundary offline-first canonico.

Il runtime non importa Firebase Realtime Database. `VITE_FIREBASE_DATABASE_URL` resta ancora nel contratto Firebase Web fail-fast come configurazione legacy da rivalutare, ma non giustifica allowlist `firebaseio.com` nella CSP. La seconda passata del 2026-09-30 ha quindi rimosso tali origin dalla CSP senza rimuovere la variabile dal contratto runtime.

Le vecchie collection Firestore `telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono `LEGACY`: il client corrente invia errori/anomalie a Sentry, ma Rules, account deletion e retention cron restano finché i client vecchi e i documenti residui non sono definitivamente smaltiti.

## Firebase Admin e account deletion

Le Vercel Functions di account deletion richiedono per contratto:

- `FIREBASE_ADMIN_PROJECT_ID`;
- `FIREBASE_ADMIN_CLIENT_EMAIL`;
- `FIREBASE_ADMIN_PRIVATE_KEY`;
- `CRON_SECRET`.

Tutte sono server-only e nessuna deve avere prefisso `VITE_`.

Nell'inventario Vercel fornito dal product owner il 2026-09-30 erano visibili `FIREBASE_ADMIN_PROJECT_ID` e `CRON_SECRET`; il repository richiede anche client email e private key. **VERIFY-LIVE:** prima di modificare il workflow account deletion, controllare direttamente in Vercel che tutte le env richieste dal codice siano presenti. Non commettere né copiare i valori nel repository.

## App Check, reCAPTCHA Enterprise e Fraud Defense

LogBook usa `ReCaptchaEnterpriseProvider` tramite Firebase App Check per rendere più difficile l'accesso abusivo alle risorse Firebase.

Nella terminologia Google Cloud corrente, reCAPTCHA Enterprise è presentato come funzionalità della piattaforma Google Cloud Fraud Defense. Per LogBook questi nomi non indicano due integrazioni applicative separate: il codice usa **App Check + provider reCAPTCHA Enterprise**.

Il repository non contiene integrazioni dirette per Account defense, SMS defense, transaction defense o chiamate autonome alle API Fraud Defense. **VERIFY-LIVE:** il product owner ricorda di avere attivato Fraud Defense nella console Google Cloud, ma non ricorda se abbia abilitato ulteriori funzioni oltre alla chiave reCAPTCHA Enterprise usata da App Check. Finché la console non viene riletta, il repository prova soltanto App Check + reCAPTCHA Enterprise e non autorizza ad assumere attive altre difese. Se emergono funzioni aggiuntive già abilitate, registrarle qui con scopo e motivo.

Esiste una Web key dedicata a LogBook nella console Google Cloud. Il suo ID/valore non viene registrato nel repository.

La variabile canonica applicativa è `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Il codice mantiene temporaneamente i fallback `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY`.

**Debito configurativo noto:** l'inventario Vercel del 2026-09-30 riportava ancora `VITE_RECAPTCHA_V3_SITE_KEY`. Non rimuovere il fallback dal codice finché Vercel Production non è stato migrato e verificato sulla variabile canonica Enterprise.

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

`VITE_FIREBASE_MEASUREMENT_ID` è stata segnalata ancora presente in Vercel, ma **non è usata dal codice corrente**: Firebase Analytics non fa parte del prodotto e il repository ne vieta l'inizializzazione. La variabile può essere rimossa da Vercel dopo una normale verifica di build; non deve essere reintrodotta come dipendenza.

Production usa inoltre `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT`; il token è build-only e non deve entrare nel bundle o nel repository.

La configurazione Production non viene più duplicata in un file `.env.production` versionato. La seconda passata del 2026-09-30 ha rimosso quel file: conteneva soltanto configurazione Firebase Web pubblica, non segreti Admin, ma duplicava identificatori/endpoints reali senza necessità. Il contratto resta in `.env.example`; i valori Production vivono in Vercel. CI/E2E usa valori sintetici espliciti.

### Scope Vercel registrati

Inventario fornito dal product owner il 2026-09-30, da verificare live prima di modifiche:

| Famiglia env | Scope riportato | Nota |
|---|---|---|
| sette `VITE_FIREBASE_*` usate dal client | Production + Preview | configurazione Firebase Web |
| `VITE_FIREBASE_MEASUREMENT_ID` | Production + Preview | legacy/non usata; candidata alla rimozione |
| `VITE_RECAPTCHA_V3_SITE_KEY` | Production + Preview | alias legacy ancora necessario finché non viene migrato il nome canonico |
| `FIREBASE_ADMIN_PROJECT_ID`, `CRON_SECRET` | Production | server-only |
| `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | VERIFY-LIVE | richieste dal codice server; assenti dall'inventario fornito |
| env Sentry (`VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) | Production | aggiunte per Error Monitoring/source map |


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

Pulizia esterna ancora richiesta: rimuovere il vecchio origin/referrer GitHub Pages dalle allowlist Google/Firebase segnalate sopra.

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
10. rimuovere origin, chiavi e integrazioni legacy non più necessarie.
