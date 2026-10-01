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
4. Firestore: deployare `firestore.indexes.json` e attendere che gli indici risultino pronti prima di attivare il nuovo backend.
5. Vercel Production: verificare che il deployment applichi `framework: null` (preset Other/backend-only) e `fluid: true` dal `vercel.json`, evitando una build frontend Vite su Vercel e preservando il runtime delle funzioni; mantenere `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `CRON_SECRET`; impostare `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` e, solo nella finestra di cutover/rollback, `PUBLIC_APP_LEGACY_ORIGIN=https://logbook-gnf.vercel.app`. Verificare in Google Cloud/Firebase che il service account Admin usato da Vercel possa verificare e consumare i token App Check limited-use; non sostituire queste credenziali runtime con la WIF del deploy Hosting.
6. GitHub Actions: configurare Workload Identity Federation verso un service account dedicato al deploy. Il principal GitHub deve poter impersonare il service account; i ruoli effettivi del deployer vanno verificati live e mantenuti al minimo necessario.
7. Repository variables richieste: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_ACCOUNT_DELETION_API_ORIGIN`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, `VITE_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Secret: `SENTRY_AUTH_TOKEN`.
8. Verificare Auth Authorized domains, OAuth origin/redirect, App Check/reCAPTCHA Enterprise e GA4 per `https://thelogbook.web.app`.
9. Non rimuovere ancora il vecchio origin Vercel dalle allowlist esterne.

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
