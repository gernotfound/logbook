# Firebase Hosting cutover — runbook LogBook

> Stato: guida operativa del candidato di migrazione. Lo stato live dei provider resta da verificare prima del cutover.

## Obiettivo

Portare la PWA da Vercel a Firebase Hosting senza cambiare il progetto Firestore/Auth e senza perdere dati locali a causa del cambio di origin.

Il codice separa tre responsabilità:

- **Firebase Hosting:** asset PWA e security headers;
- **Firebase Cloud Functions v2:** HTTPS `accountDeletion` e scheduled `accountDeletionMaintenance`;
- **GitHub Actions:** build/deploy Production soltanto dopo il gate canonico verde sullo stesso SHA di `main`.

Vercel resta temporaneamente disponibile come origin precedente per la migrazione dati e per client già installati. Il suo ritiro è un task successivo al periodo di transizione.

## Perché serve il bridge di origin

IndexedDB, localStorage, Firebase Auth browser persistence e service worker sono origin-scoped. Passare da un hostname Vercel a un hostname Firebase non trasferisce automaticamente:

- modalità guest/local-only;
- Local Envelope e journal non ancora replicato;
- active workout/device state owner-scoped;
- receipt/marker di account deletion;
- altri valori owner-scoped usati per recovery.

Il target mostra quindi una scelta una tantum prima dell'uso normale. Su richiesta esplicita apre il vecchio origin in una finestra top-level e usa `postMessage` soltanto fra `VITE_ORIGIN_MIGRATION_SOURCE` e `VITE_ORIGIN_MIGRATION_TARGET`, con nonce casuale.

Il target conserva l'intero Local Envelope V4, inclusi actor, clock, pending journal e sync metadata. Un target con archivio divergente non viene sovrascritto automaticamente. Per account autenticati, dopo il trasferimento l'utente deve accedere con lo stesso Firebase UID; la normale hydration Firestore riconcilia quindi cloud + journal locale. Per guest viene ripristinato il flag locale.

## Configurazione GitHub richiesta

Repository variables Production:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_HOSTING_SITE`
- `FIREBASE_FUNCTION_REGION`
- `LOGBOOK_ALLOWED_ORIGINS`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `VITE_PUBLIC_ORIGIN`
- `VITE_ORIGIN_MIGRATION_SOURCE`
- `VITE_ORIGIN_MIGRATION_TARGET`
- `VITE_ACCOUNT_DELETION_API_URL`
- le sette `VITE_FIREBASE_*` usate dal client
- `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`
- `VITE_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Repository secret:

- `SENTRY_AUTH_TOKEN`

Il deploy Google Cloud usa Workload Identity Federation/OIDC; non è richiesto un service-account key JSON persistente nel repository o in GitHub Secrets.

## Configurazione Vercel temporanea

Finché il vecchio origin serve da bridge:

- mantenere deploy da `main` soltanto;
- impostare source/target migration env sul vecchio build;
- impostare preferibilmente anche `VITE_PUBLIC_ORIGIN` sul vecchio origin; se manca, i metadati SEO del bridge usano il `VERCEL_PROJECT_PRODUCTION_URL` fornito da Vercel invece di generare URL non validi;
- mantenere le vecchie credenziali Admin/cron server-only finché gli adapter Vercel sono necessari;
- non riattivare Analytics/Speed Insights;
- mantenere CSP compatibile con Firebase/Cloud Functions/Sentry.

## Verifiche esterne prima del primo deploy Firebase

Verificare direttamente nelle console competenti:

1. Firebase Hosting site realmente esistente e corretto;
2. Firebase Auth Authorized domains per il nuovo hostname;
3. Google OAuth origin/redirect necessari;
4. Browser API key referrer allowlist;
5. App Check / reCAPTCHA Enterprise domain allowlist per nuovo e vecchio origin durante la transizione;
6. IAM del principal GitHub WIF e service account deploy;
7. API/servizi richiesti da Cloud Functions v2, Cloud Build, Artifact Registry e Cloud Scheduler;
8. billing/quota necessari per Functions v2/Scheduler;
9. Search Console property/sitemap per il nuovo origin;
10. Sentry release/source-map upload dal nuovo workflow.

## Sequenza di cutover

1. Congelare lo SHA candidato e ottenere `Canonical Verification` verde.
2. Eseguire gli audit indipendenti sullo stesso SHA.
3. Solo dopo approvazione, squash merge in `main`.
4. Attendere CI `main` verde sullo SHA risultante.
5. Il workflow `Firebase Production` ricontrolla che quello SHA sia ancora l'HEAD di `main`; se è stale rifiuta il deploy.
6. Verificare Hosting, Functions, scheduled maintenance, App Check, Auth e Sentry.
7. Verificare che il vecchio origin Vercel abbia ricevuto la build bridge da `main` e che i branch non abbiano Preview Deployment.
8. Eseguire smoke cross-origin con account e guest reali di test, inclusi pending journal/account deletion recovery.
9. Aggiornare Search Console/canonical indexing.
10. Solo dopo una finestra di transizione adeguata, ritirare Vercel e rimuovere origin/credenziali/allowlist legacy con un task separato.

## Failure policy

- Nessun dato locale target divergente viene sovrascritto automaticamente.
- Nessun account trasferito viene associato a un UID differente.
- Se il bridge non risponde o lo storage è illeggibile, il target conserva lo stato e invita a riprovare; non dichiara successo.
- Se il vecchio origin non è più disponibile, usare il backup JSON/manual recovery anziché inventare una migrazione.
- Un deploy Firebase verde non sostituisce la CI e non prova da solo il runtime end-to-end.
