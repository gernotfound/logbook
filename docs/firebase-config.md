# Configurazione Firebase — LogBook

> Stato: normativo | Ultima verifica: 2026-09-09 | File verificati: `src/lib/firebase.ts`, `src/lib/appCheck.ts`, `firestore.rules`, `firebase.json`, `.firebaserc`, `vercel.json`, `.env.production`, `.env.example`

## Variabili d'ambiente

L'app richiede 8 variabili `VITE_FIREBASE_*` + 1 variabile App Check:

| Variabile | Obbligatoria | Note |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | MUST | Chiave API pubblica Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | MUST | Dominio Auth (`logbook-db-98cc4.firebaseapp.com`) |
| `VITE_FIREBASE_DATABASE_URL` | VERIFY | Passata a `firebaseConfig.databaseURL` ma il progetto usa solo Firestore, non Realtime Database. Potrebbe essere rimossa. |
| `VITE_FIREBASE_PROJECT_ID` | MUST | ID progetto (`logbook-db-98cc4`) |
| `VITE_FIREBASE_STORAGE_BUCKET` | MUST | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | MUST | |
| `VITE_FIREBASE_APP_ID` | MUST | |
| `VITE_FIREBASE_MEASUREMENT_ID` | MUST | Per Google Analytics |
| `VITE_RECAPTCHA_V3_SITE_KEY` | MUST (se App Check attivo) | Nome storico, il provider è Enterprise |

### Fail-fast

In `src/lib/firebase.ts`, tutte le variabili sono controllate all'avvio. Se anche una sola manca o è vuota, l'app lancia immediatamente un `Error` bloccante prima di `initializeApp`.

### Accesso statico Vite

**MUST:** Usare sempre la notazione statica (`import.meta.env.VITE_FIREBASE_API_KEY`). Vite sostituisce le variabili in modo statico durante la build; l'accesso dinamico con `import.meta.env[key]` fallisce in produzione e restituisce `undefined`.

Le chiavi Firebase Web sono pubbliche per natura client-side. La sicurezza dei dati dipende da Security Rules, IAM e App Check.

## App Check — reCAPTCHA Enterprise

- **Provider:** `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`).
- **Inizializzazione:** Lazy/on-demand in `src/lib/appCheck.ts`, importato dinamicamente da `firebase.ts`.
- **`isSupported` non esiste** per `firebase/app-check`. Il check di supporto browser è manuale (`window.crypto` e `window.fetch`).
- **Throttle iniziale:** Al primo caricamento, Firebase App Check acquisisce il token con un breve ritardo. Durante questo intervallo, Firestore può rispondere `permission-denied`. Questo è normale e transitorio.
- **Attivazione:** La chiave su Firebase App Check e Google Cloud deve essere "Registered", altrimenti tutte le richieste Firestore riceveranno `permission-denied`.

## Firestore Security Rules

### Deploy obbligatorio

**MUST:** Il file `firestore.rules` non si applica da solo. Modificarlo nel repository non ha effetto su Firebase finché non viene eseguito il deploy:

```bash
npx firebase-tools login          # autenticazione browser (una tantum)
npx firebase-tools deploy --only firestore:rules
```

I file `firebase.json` (punta a `firestore.rules`) e `.firebaserc` (progetto `logbook-db-98cc4`) sono già nel repository.

### Quando ri-deployare

Ogni volta che si modifica `firestore.rules`. Non è necessario un redeploy Vercel — le rules sono separate dall'app.

### Sintomo tipico se le rules non sono deployate

Tutti i tentativi di lettura/scrittura Firestore restituiscono `FirebaseError: Missing or insufficient permissions`.

## Sicurezza domini

Se si cambia o si aggiunge un dominio di hosting, è **TASSATIVO** autorizzare il nuovo dominio in:

1. **Firebase Auth** → Authorized domains
2. **Google Cloud Console** → Restrizioni Browser API Key

In caso contrario: errori 403 Forbidden o `auth/unauthorized-domain`.

## CSP (Content Security Policy)

La CSP è configurata in `vercel.json`. Prima di modificarla:

1. Leggere `vercel.json` e identificare la direttiva interessata.
2. **MUST:** Non rimuovere i domini Firebase (`*.firebaseapp.com`, `*.googleapis.com`, `*.firebaseio.com`) o Vercel dalla CSP.
3. Verificare login, sync, analytics e PWA dopo il cambiamento.

## Sicurezza HTTP

Headers configurati in `vercel.json`:
- `Strict-Transport-Security` (HSTS con preload)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

## File di credenziali

**MUST:** Il file `service-account.json` è nel `.gitignore` e non va mai committato. Contiene le credenziali admin. Va scaricato da Firebase Console e usato solo localmente per operazioni admin (seeding, script).
