# Cutover Firebase Hosting Spark + Vercel backend

Stato: procedura operativa. Non prova lo stato live: ogni voce esterna va verificata nel provider competente durante il cutover.

## Target

- Frontend/PWA: Firebase Hosting, site `thelogbook`, Firebase Spark.
- Firestore, Authentication e App Check/reCAPTCHA Enterprise restano Firebase.
- GA4 è analytics opzionale con nuovo opt-in; Sentry resta Error Monitoring.
- Trusted backend e cron giornaliero: Vercel Hobby.
- Production deriva esclusivamente da `main`.

## Prima del merge

1. PR DRAFT sul vero `main`, nessun thread review aperto, exact-SHA candidato congelato.
2. `Canonical Verification` verde sullo stesso SHA.
3. Firebase: confermare Spark, project ID e site ID `thelogbook`.
4. Firestore: deployare `firestore.indexes.json` e attendere che gli indici risultino pronti prima di attivare il nuovo backend. Checkpoint 2026-10-02: entrambi gli indici compositi richiesti da `account_deletions` risultano Abilitati.
5. Vercel Production: verificare che il deployment applichi `framework: null` (preset Other/backend-only) e `fluid: true` dal `vercel.json`, evitando una build frontend Vite su Vercel e preservando il runtime delle funzioni; verificare inoltre il permesso effettivo `firebaseappcheck.appCheckTokens.verify` sul service account Firebase Admin usato dal backend, necessario alla consumazione dei token limited-use; mantenere `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `CRON_SECRET`; impostare `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` e, solo nella finestra di cutover/rollback, `PUBLIC_APP_LEGACY_ORIGIN=https://logbook-gnf.vercel.app`. Checkpoint 2026-10-02: il permesso App Check è presente tramite Firebase App Check Admin e le due env origin sono configurate in Production senza redeploy manuale. Non sostituire queste credenziali runtime con la WIF del deploy Hosting.
6. GitHub Actions: configurare Workload Identity Federation verso un service account dedicato al deploy. Mappare `google.subject=assertion.sub`, `attribute.repository_id=assertion.repository_id` e `attribute.repository_owner_id=assertion.repository_owner_id`; applicare al provider una condition sugli ID immutabili del repository e dell'owner di `gernotfound/logbook`, quindi autorizzare all'impersonation (`roles/iam.workloadIdentityUser` sul service account) soltanto il principal del repository, non il pool intero. Sul progetto Firebase assegnare al deployer soltanto `roles/firebasehosting.admin` e `roles/serviceusage.apiKeysViewer`, necessari al deploy Hosting via Firebase CLI. Non assegnare ruoli Functions/Cloud Run/Firestore a questa identità Hosting. Checkpoint 2026-10-02: pool/provider/deployer e binding risultano configurati senza chiavi private JSON.
7. Repository variables richieste: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN` (esattamente `thelogbook.web.app` in Production), `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_ACCOUNT_DELETION_API_ORIGIN`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, `VITE_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Secret: `SENTRY_AUTH_TOKEN`.
8. Verificare Auth Authorized domains, OAuth origin/redirect, App Check/reCAPTCHA Enterprise e GA4 per `https://thelogbook.web.app`.
9. Non rimuovere ancora il vecchio origin Vercel dalle allowlist esterne.

### Checkpoint preparazione live — 2026-10-02

Completato e verificato prima del merge:

- Firebase Hosting `thelogbook` su Spark, ancora senza release;
- due indici Firestore `account_deletions` Abilitati;
- Auth domains, OAuth origin/redirect, Browser API key e reCAPTCHA Enterprise predisposti per `thelogbook.web.app`, mantenendo temporaneamente Vercel per rollback;
- App Check in monitoraggio; Firestore e Authentication osservati 100% verificati;
- WIF GitHub Actions + deployer Hosting least-privilege configurati; repository variables e secret del workflow provisionati;
- preflight read-only WIF riuscito: GitHub Actions ha impersonato il deployer e letto il sito Hosting `thelogbook` senza creare versioni, release o canali; il workflow diagnostico temporaneo è rimosso dall'HEAD candidato;
- Vercel Production env per origin nuovo + legacy configurate senza redeploy manuale;
- GA4 privacy-minimal verificato e privo di collegamenti Ads/AdMob;
- Sentry CI token configurato, Allowed Domains ristretto ai due frontend del cutover e Project Security Token ruotato dopo esposizione durante la configurazione.

Restano deliberatamente da fare **solo nella fase autorizzata di merge/cutover**: exact-SHA CI finale dopo questo aggiornamento documentale, review finale, eventuale merge, CI su `main`, deploy Vercel backend dallo stesso stato, prima release Firebase Hosting e smoke runtime completi. Nessuno di questi passaggi è autorizzato implicitamente da questo checkpoint.

## Merge e deploy

1. Squash merge soltanto con exact-SHA verde.
2. Leggere lo SHA reale di `main`.
3. Attendere `Milestone Verification` / `Canonical Verification` verde sullo SHA di `main`.
4. Verificare che il deployment Vercel dello stesso stato sia READY e che branch/PR non abbiano generato Preview Deployment.
5. `Firebase Hosting Production` parte soltanto dopo la verifica riuscita su push a `main`, ricontrolla che `origin/main` non sia avanzato, costruisce lo stesso SHA e usa Workload Identity Federation.
6. Il workflow usa `firebase deploy --only hosting`: non deploya implicitamente Functions, Rules o indici.

## Smoke obbligatori

- `https://thelogbook.web.app/`: 200, canonical/asset corretti, `Cache-Control: no-cache, no-store, must-revalidate` sull'app shell, nessun errore console bloccante; la CSP non deve generare violazioni per Firestore, Auth, App Check, Firebase Installations/GA4, Sentry o backend Vercel.
- `sw.js`: no-cache/no-store/must-revalidate; PWA installabile e avvio offline.
- Google popup + redirect `/__/auth/handler`; email/password.
- Firestore read/write e sync local-first con App Check.
- CORS Vercel dal nuovo origin, mai wildcard.
- Account deletion con autenticazione recente, polling, recovery device, offline/multi-device; ripetere intenzionalmente una richiesta con lo stesso token App Check deve essere rifiutato come replay.
- GA4: zero richieste prima del consenso; page view dopo opt-in senza query/hash; revoca cross-tab.
- Sentry: solo Error Monitoring e release uguale allo SHA di `main`.
- robots, sitemap, Open Graph, favicon.
- Runtime Vercel senza nuovi errori; verificare inoltre che le funzioni account-deletion e cron risultino configurate con durata massima 300s sotto Fluid Compute.

## Chiusura

Dopo smoke verdi: rimuovere `PUBLIC_APP_LEGACY_ORIGIN`, togliere il vecchio origin dalle allowlist dove non serve più, aggiornare Search Console/sitemap e registrare nel service register solo gli stati realmente verificati.

## GO / NO-GO

GO solo con exact-SHA CI verde, indici pronti, env/identity di deploy verificate, Vercel backend READY, Hosting/Auth/App Check/sync/account deletion smoke verdi e nessun blocker runtime.

NO-GO se manca una credenziale, un indice è in build, CORS/App Check/Auth falliscono, lo SHA della build diverge, la cache policy SW è errata o emerge rischio di perdita/corruzione dati.

## Rollback

Ripristinare la release Hosting precedente se necessario. Se torna temporaneamente il frontend Vercel, mantenere il legacy origin nel CORS durante la finestra di rollback. Rollback Vercel backend solo se il backend è la causa. Nessun rollback deve cancellare o mutare dati utente. Ripetere sempre gli smoke Auth/sync/account deletion.
