# TheLogBook

TheLogBook è una Progressive Web App per allenamento, nutrizione e monitoraggio della composizione corporea. È progettata **offline-first**: le modifiche vengono persistite localmente prima della replica cloud, così l'app può continuare a funzionare anche con connettività assente o instabile.

Versione applicativa corrente: **1.1.0**.

## Funzionalità principali

### Allenamento

- libreria esercizi e voci personalizzate;
- routine e cicli di allenamento;
- sessione live con serie, carichi, ripetizioni, RPE, recuperi, dropset e isometrie;
- timer resistente al background mobile tramite timestamp, non dipendente da un semplice intervallo;
- storico allenamenti e analisi di volume/carico.

### Nutrizione

- pianificazione nutrizionale e target ON/OFF;
- diario alimentare giornaliero;
- libreria alimenti/custom foods;
- tracciamento integratori;
- calcoli di fabbisogno e macro basati sui dati inseriti dall'utente.

### Dati corporei

- peso e composizione corporea;
- circonferenze e misurazioni;
- informazioni giornaliere correlate presenti nei record nutrizionali mensili;
- grafici e analisi storiche.

### Backup ed esportazione

- backup/import JSON versionato (`logbook-backup` V3);
- esportazione CSV per analisi esterne;
- recovery conservativo quando un formato locale/cloud non può essere reinterpretato in sicurezza.

## Architettura offline-first

TheLogBook usa più livelli di persistenza con responsabilità separate:

| Livello | Tecnologia | Ruolo |
|---|---|---|
| Stato UI/app | Zustand | Stato operativo in memoria |
| Persistenza locale principale | IndexedDB (`idb-keyval`) | `UserData`, baseline, journal semantico e metadati causali |
| Persistenza sincrona | `localStorage` | workout/timer/device state, preferenze e boundary best-effort specifici |
| Replica cloud | Firebase Firestore | sincronizzazione tra dispositivi per gli account autenticati |

Le normali mutazioni business attraversano **Domain Operations**: l'intento viene trasformato in operazioni semantiche, persistito atomicamente nell'envelope locale e poi replicato verso Firestore. La sincronizzazione usa metadati causali/Vector Clock e mantiene le operation pending quando la rete non consente una conferma sicura.

Una race importante è coperta esplicitamente: se una nuova modifica locale avviene tra il commit remoto e l'acknowledge locale, TheLogBook prende lo snapshot remoto confermato come baseline e rigioca soltanto le operation locali ancora pending, evitando di perdere sia modifiche remote sia modifiche locali.

## Modalità ospite e account

### Ospite

I dati business restano sul dispositivo nella persistenza locale dell'app. Non è necessario un account per usare le funzioni locali principali.

### Account cloud

Con un account autenticato, i dati applicativi vengono sincronizzati su Firestore. Quando dati guest preesistenti vengono associati a un account, il flusso usa una hydration cloud completa, un merge deterministico e il journal autenticato prima della replica.

La cancellazione account non è una semplice delete client-side: è gestita da Vercel Functions con Firebase Admin, una barriera server `account_deletions/{uid}` e recovery cross-device. Dopo il completamento resta soltanto un tombstone tecnico server-only, limitato a 30 giorni e rimosso dal cron giornaliero.

## PWA

- installabile su iOS/Android e browser compatibili;
- Service Worker gestito con `vite-plugin-pwa`;
- update protetti da un reload barrier che blocca l'aggiornamento quando la persistenza locale non è in uno stato sicuro;
- pipeline icone dedicata con asset standard, Apple touch e `maskable`.

La sorgente vettoriale approvata `assets/brand/thelogbook-icon-master.svg` viene processata da `scripts/resize_icons.mjs`; da un unico master vengono generati favicon, Apple touch, PNG PWA 192×192 e 512×512, SVG scalabile, variante maskable 512×512 e card social PNG.

## Telemetria tecnica

TheLogBook non integra SDK per analytics di utilizzo. Rimane il monitoraggio degli errori tecnici:

- **telemetria tecnica TheLogBook:** Sentry Error Monitoring riceve solo errori/anomalie tecniche sanitizzati in Production; TheLogBook non allega deliberatamente Firebase UID o email e non abilita Replay, tracing, logging o metriche. Le vecchie collection Firestore telemetriche restano temporaneamente solo per cleanup/compatibilità;
- **Google Analytics 4 / Firebase Analytics:** ritirato dal client; nessuna raccolta di statistiche di utilizzo nell'app;
- **Vercel Analytics + Speed Insights:** ritirati dal frontend Production dopo il cutover a Firebase Hosting.

I dettagli destinati agli utenti sono nella Privacy Policy dell'app. La documentazione tecnica non deve promettere anonimato quando esistono identificativi tecnici pseudonimi.

## Stack

- React 19
- Vite 8
- TypeScript 7
- Zustand 5
- Zod 4
- Firebase Web SDK 12 + Firebase Admin server-side
- Vercel Functions
- Sentry Error Monitoring (`@sentry/react` + source map build-time)
- `vite-plugin-pwa`
- Chart.js / `react-chartjs-2`
- Vitest + Testing Library
- Playwright
- Firebase Emulator
- oxlint
- Node.js 24.x nel workflow canonico e nel runtime Vercel corrente

## Configurazione locale

### Requisiti

- Node.js compatibile con il progetto; la CI canonica usa Node 24;
- npm;
- Java per i test Firebase Emulator quando si esegue il gate completo.

### Installazione

```bash
npm ci
cp .env.example .env
npm run dev
```

`.env.example` contiene soltanto **nomi e placeholder**. Non contiene credenziali reali.

Il repository non versiona `.env.production`. Il frontend Firebase Hosting riceve la configurazione pubblica dalla pipeline GitHub Actions; le credenziali server-only restano nel runtime Vercel. Test ed E2E usano configurazioni sintetiche.

Il client richiede quattro variabili Firebase core (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`). App Check usa `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`; il frontend usa inoltre `VITE_ACCOUNT_DELETION_API_ORIGIN` per raggiungere il backend trusted Vercel. In Production Sentry usa `VITE_SENTRY_DSN`, mentre `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` sono build-only per release/source map.

Le API trusted di account deletion usano inoltre variabili **server-only**:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`
- `CRON_SECRET`

Queste variabili non devono avere prefisso `VITE_`, non devono entrare nel bundle client e i valori reali non devono essere committati.

## Verifica

Il gate repository completo corrente è:

```bash
npm run verify:m8
```

Non sostituirlo, per un candidato finale, con il solo lint/test/build. Il workflow `.github/workflows/verification.yml` esegue inoltre `npm audit --audit-level=high` e il job stabile **Canonical Verification** sull'exact event HEAD.

Comandi più piccoli (`npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`) restano utili per diagnosi locali ma non certificano da soli il repository.

## Deployment

Il frontend Production è distribuito su **Firebase Hosting** esclusivamente dallo stato corrente di `main` dopo il successo di `Milestone Verification` / `Canonical Verification`. Il workflow ricontrolla l'exact SHA e rifiuta un candidato diventato obsoleto prima di eseguire `firebase deploy --only hosting`.

Vercel distribuisce da `main` soltanto il backend trusted/cron e il redirect del vecchio hostname. I branch di sviluppo non generano Preview Deployment Vercel.

Il normale ciclo di consegna è quindi:

```text
branch dedicato
→ draft PR
→ Canonical Verification exact-SHA
→ review finale
→ squash merge in main
→ CI su main
→ Firebase Hosting frontend + Vercel backend dallo stesso main verificato
```

## Documentazione tecnica normativa

Gli agenti e i maintainer devono partire da:

- [`AGENTS.md`](AGENTS.md) — invarianti e procedura operativa trasversale;
- [`.agents/rules/`](.agents/rules/) — contratti specialistici per sync, dati, account lifecycle, Firebase, servizi esterni, CI, crash consistency, catalogo e UX;
- [`docs/operations/external-services-register.md`](docs/operations/external-services-register.md) — perché usiamo i provider esterni, configurazioni da preservare e verifiche future.

In caso di divergenza tra documentazione e implementazione corrente, non assumere che il documento più vecchio sia corretto: verificare codice, test, history e configurazione, quindi riallineare la documentazione normativa insieme alla modifica pertinente.
