# Firebase Hosting cutover — runbook LogBook

> Stato: guida operativa del candidato di migrazione. Nessun deploy Firebase Production o merge in `main` è autorizzato in questa fase.

## Decisione di prodotto: clean cut

Il product owner ha scelto di azzerare l’unico account esistente e creare un nuovo account dopo il passaggio a Firebase Hosting.

Di conseguenza il candidato **non** contiene un bridge cross-origin fra Vercel e Firebase. IndexedDB, localStorage, Cache Storage, Firebase Auth persistence, Service Worker e installazione PWA restano origin-scoped e non vengono trasferiti automaticamente.

Prima del cutover definitivo l’account/dati che si desidera abbandonare devono essere cancellati o esportati deliberatamente. Se esistono dati locali da conservare, usare il backup JSON prima del cambio di origin.

## Architettura target

- **Firebase Hosting** serve la build Vite da `dist/`.
- **Cloud Functions for Firebase v2** espone `accountDeletion` e la scheduled function `accountDeletionMaintenance`.
- **Firestore/Auth/App Check** restano nello stesso progetto Firebase.
- **Sentry** resta il solo error monitoring applicativo.
- **Google/Firebase Analytics non viene introdotto**.
- **Vercel non è parte dell’architettura target**; `vercel.json` disabilita i deployment Git automatici nel candidato.

## Account deletion

La cancellazione account resta una funzione prodotto anche dopo il reset.

Il client chiama direttamente la HTTPS Function `accountDeletion`, senza rewrite Firebase Hosting. Questo evita il limite del proxy Hosting per operazioni lunghe.

Il backend mantiene:

1. ID token verificato con revocation check;
2. requisito di autenticazione recente;
3. App Check;
4. receipt casuale con solo hash SHA-256 conservato server-side;
5. job `account_deletions/{uid}` server-only;
6. lease per serializzare i worker distruttivi;
7. cancellazione paginata delle raccolte private note;
8. verifica residui prima della cancellazione Auth;
9. Firebase Auth eliminato per ultimo;
10. tombstone tecnico con retention di 30 giorni;
11. recovery idempotente tramite GET + scheduled maintenance.

Le Functions usano Application Default Credentials tramite un service account runtime dedicato configurato con `LOGBOOK_FUNCTION_SERVICE_ACCOUNT`. Non sono richieste private key Admin esportate né `CRON_SECRET`.

## Configurazione GitHub richiesta

Repository variables Production:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_HOSTING_SITE`
- `FIREBASE_FUNCTION_REGION`
- `FIREBASE_FUNCTION_SERVICE_ACCOUNT`
- `LOGBOOK_ALLOWED_ORIGINS`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `VITE_PUBLIC_ORIGIN`
- `VITE_ACCOUNT_DELETION_API_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`
- `VITE_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Repository secret:

- `SENTRY_AUTH_TOKEN`

Il deploy usa GitHub OIDC / Google Workload Identity Federation. Non usare una service-account key JSON persistente.

Il service account di deploy e quello runtime delle Functions devono essere identità distinte.

## Verifiche esterne obbligatorie prima del primo deploy

Verificare direttamente nei sistemi competenti:

1. piano Blaze/billing del progetto;
2. Hosting site definitivo e origin canonico scelto;
3. regione reale Firestore e regione Functions coerente;
4. API Cloud Functions v2, Cloud Build, Artifact Registry e Cloud Scheduler abilitate;
5. Workload Identity Federation e service account di deploy;
6. service account runtime Functions e IAM minimo necessario a Firestore/Auth/App Check;
7. Firebase Auth Authorized Domains;
8. Google OAuth origin/redirect, incluso `https://<auth-domain>/__/auth/handler`;
9. restrizioni HTTP referrer della Browser API key;
10. dominio della chiave reCAPTCHA Enterprise / App Check;
11. enforcement App Check applicabile;
12. Sentry source-map/release;
13. Cloud Logging/Monitoring e budget alerts;
14. Search Console/sitemap sul nuovo origin.

## Ordine del deployment

Il workflow `.github/workflows/firebase-production.yml` si attiva soltanto dopo una `Milestone Verification` riuscita su un **push a `main`**.

L’ordine è intenzionale:

1. checkout exact-SHA verificato;
2. conferma che lo SHA sia ancora l’HEAD reale di `main`;
3. autenticazione GCP via WIF;
4. install/typecheck Functions con Node.js 22;
5. deploy delle sole Functions LogBook;
6. nuovo controllo che `main` non sia avanzato;
7. build frontend Production con Node.js 24 + release Sentry sullo stesso SHA;
8. nuovo controllo exact-SHA;
9. deploy Firebase Hosting;
10. controllo finale di drift.

Functions vengono pubblicate prima di Hosting perché il backend nuovo è compatibile con il client precedente; un errore nel secondo step non deve lasciare un frontend nuovo senza backend.

## Hosting/PWA

`firebase.json`:

- pubblica `dist/`;
- preserva `firestore.rules`;
- contiene soltanto la SPA fallback e **nessun rewrite verso account deletion**;
- riserva `/__/*` agli helper Firebase;
- non applica CSP/frame headers applicativi agli endpoint riservati;
- serve asset fingerprinted `/assets/**` con cache lunga e `immutable`;
- forza rivalidazione dell’app shell;
- serve `sw.js` e Workbox con policy no-cache/no-store;
- mantiene HSTS, nosniff, frame denial, Referrer-Policy, Permissions-Policy e CSP.

Il service worker non deve intercettare il namespace `/__/*`, richiesto da Firebase Authentication.

## Auth domain

In Production `VITE_FIREBASE_AUTH_DOMAIN` deve coincidere con l’hostname canonico pubblico e non può terminare con `.firebaseapp.com`.

Firebase documenta che il namespace `/__` del dominio Hosting è riservato anche agli helper OAuth e che, con Hosting, un auth domain first-party evita i problemi dei browser che bloccano storage/cookie di terze parti.

## Sequenza operativa di cutover

1. congelare il candidate SHA e ottenere `Canonical Verification` verde;
2. eseguire gli audit indipendenti sullo stesso SHA;
3. prima del merge/cutover, esportare eventuali dati che si vogliono conservare e completare il reset dell’account esistente;
4. configurare e verificare tutti i prerequisiti esterni;
5. solo con approvazione esplicita, squash merge in `main`;
6. attendere CI post-merge verde sul nuovo SHA di `main`;
7. verificare il workflow Firebase Production e lo SHA realmente pubblicato;
8. smoke test: startup, PWA/offline, login email/Google, sync, logout/login, guest→account, account deletion/recovery, App Check, CSP, Sentry;
9. verificare Search Console/canonical;
10. rimuovere in un task separato risorse/env Vercel residue lato provider quando non servono più.

## Failure policy

- Un deploy Firebase verde non sostituisce la CI.
- CI verde non prova il runtime Production.
- Nessun deploy da PR/branch.
- Nessun fallback a credenziali Admin statiche.
- Nessun account deletion via Hosting rewrite.
- Nessun dato locale del vecchio origin viene dichiarato migrato: nel clean cut viene deliberatamente abbandonato/esportato prima del cambio origin.
- Se la configurazione Production non coincide con origin, project ID, Function URL, site ID o service account previsti, il preflight fallisce chiuso.
