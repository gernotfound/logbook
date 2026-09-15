# Configurazione Firebase — LogBook

> Stato: normativo | Ultima verifica: 2026-09-15 | File verificati: `src/lib/firebase.ts`, `src/lib/appCheck.ts`, `server/accountDeletion/firebaseAdmin.ts`, `api/account-deletion-cron.ts`, `firestore.rules`, `firebase.json`, `.firebaserc`, `vercel.json`, `.env.example`

## Tre contratti di configurazione distinti

Non trattare tutte le variabili Firebase/App Check/Admin come un unico blocco obbligatorio. Esistono tre boundary differenti: client Firebase, App Check client e server trusted M7.

### Client Firebase — fail-fast

`src/lib/firebase.ts` controlla all'avvio otto variabili `VITE_FIREBASE_*`. Se una manca o è vuota, il client lancia `Error` prima di `initializeApp`.

| Variabile | Stato corrente | Note |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | MUST | Chiave API pubblica Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | MUST | Dominio Auth |
| `VITE_FIREBASE_DATABASE_URL` | VERIFY | È nel fail-fast/config ma il progetto usa Firestore, non Realtime Database |
| `VITE_FIREBASE_PROJECT_ID` | MUST | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | MUST | Config Firebase Web |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | MUST | Config Firebase Web |
| `VITE_FIREBASE_APP_ID` | MUST | Config Firebase Web |
| `VITE_FIREBASE_MEASUREMENT_ID` | MUST | Usata dalla configurazione Analytics |

**MUST:** L'accesso Vite alle env client resta statico (`import.meta.env.VITE_FIREBASE_API_KEY` ecc.). Non sostituirlo con `import.meta.env[key]`.

Le chiavi Firebase Web sono pubbliche nel bundle client; la protezione dei dati dipende da Security Rules, autenticazione, App Check e configurazione backend.

## App Check — reCAPTCHA Enterprise

- **Provider:** `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`).
- **Inizializzazione:** lazy/on-demand in `src/lib/appCheck.ts`.
- **Support check:** manuale su runtime browser (`window.crypto`, `window.fetch`); `firebase/app-check` non espone l'`isSupported` usato da Analytics.
- **Site key:** il codice accetta prima `VITE_RECAPTCHA_V3_SITE_KEY` e poi il fallback storico `VITE_RECAPTCHA_SITE_KEY`.
- **Semantica se manca la site key:** App Check ritorna `disabled/fallback`; questa condizione **non** fa parte del fail-fast delle otto env Firebase client e non impedisce `initializeApp`.
- **Token iniziale:** un failure di acquisizione viene loggato e il provider può riprovare; non trasformare genericamente ogni `permission-denied` Firestore in “normale bootstrap noise”.

**VERIFY:** registrazione della site key, enforcement App Check e stato della configurazione in Firebase/Google Cloud sono esterni al repository e devono essere verificati in console quando rilevanti.

**MUST:** nel percorso sync, un `permission-denied` osservato da `replicateJournal` resta `rejected` e non va mascherato. Retry bootstrap è accettabile solo quando la causa transitoria è identificata.

## Server trusted M7 — Firebase Admin

`server/accountDeletion/firebaseAdmin.ts` richiede queste tre env quando inizializza Firebase Admin:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

La private key supporta newline escaped (`\\n`) e viene normalizzata server-side.

`api/account-deletion-cron.ts` usa inoltre:

- `CRON_SECRET`

`CRON_SECRET` è un requisito specifico del cron: se assente, `/api/account-deletion-cron` risponde 503. Non è una variabile necessaria al bootstrap del client Vite.

**MUST:** tutte queste credenziali/config server restano server-only, senza prefisso `VITE_`, e non devono essere inserite nel bundle client o committate.

**VERIFY:** il repository prova i nomi richiesti dal codice, non che i valori siano effettivamente provisionati in ogni environment Vercel né quali ruoli IAM siano assegnati al service account.

`.env.example` è attualmente un template client e non rappresenta l'elenco completo della configurazione server M7. Non inferire da quel file che le env Admin/cron non servano; un eventuale template multi-runtime va progettato come task separato, distinguendo chiaramente i boundary.

## Firestore Security Rules

### Test e deploy sono operazioni diverse

Il gate repository corrente testa `firestore.rules` tramite Firebase Emulator (`npm run test:rules`, transitivamente incluso in `verify:m8`). Questo **non** deploya le Rules sul progetto Firebase.

**MUST:** una modifica approvata a `firestore.rules` richiede test pertinenti e un deploy Rules esplicito verso il target corretto:

```bash
npx firebase-tools deploy --only firestore:rules
```

L'autenticazione/credential path usato per il deploy dipende dall'ambiente operativo; non documentare un particolare ruolo IAM o service account come requisito corrente senza evidenza verificata.

I file `firebase.json` e `.firebaserc` definiscono la configurazione repository usata dagli strumenti Firebase; leggere entrambi prima di cambiare target o Rules.

### Sintomo di Rules/Auth/App Check

`FirebaseError: Missing or insufficient permissions` / `permission-denied` può avere più cause (Rules, Auth, App Check, dominio/configurazione). Non classificare automaticamente l'errore come “Rules non deployate” o “App Check transitorio” senza discriminare la causa.

## Sicurezza domini

Se si cambia o si aggiunge un dominio di hosting:

1. verificare Firebase Auth → Authorized domains;
2. verificare le restrizioni applicabili della Browser API Key in Google Cloud.

Questi stati console sono **VERIFY**, non facts dimostrati dal repository.

## CSP (Content Security Policy)

La CSP è configurata in `vercel.json`. Prima di modificarla:

1. leggere `vercel.json` e identificare la direttiva interessata;
2. **MUST:** non rimuovere i domini Firebase/Vercel necessari al comportamento corrente senza una sostituzione verificata;
3. verificare login, sync, analytics, API M7 e PWA dopo il cambiamento pertinente.

## Sicurezza HTTP

Gli header HTTP sono configurati in `vercel.json`; leggere la configurazione corrente prima di descriverne l'elenco come normativo, perché può cambiare indipendentemente da questa regola.

## File di credenziali

**MUST:** `service-account.json` resta nel `.gitignore` e non va mai committato.

**MUST:** nessuna credenziale Firebase Admin privata deve essere copiata in Markdown, `.env.example`, codice client o test fixture committate.
