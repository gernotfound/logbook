# LogBook

LogBook è una Progressive Web App per allenamento, nutrizione e monitoraggio della composizione corporea. È progettata **offline-first**: le modifiche vengono persistite localmente prima della replica cloud, così l'app può continuare a funzionare anche con connettività assente o instabile.

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

LogBook usa più livelli di persistenza con responsabilità separate:

| Livello | Tecnologia | Ruolo |
|---|---|---|
| Stato UI/app | Zustand | Stato operativo in memoria |
| Persistenza locale principale | IndexedDB (`idb-keyval`) | `UserData`, baseline, journal semantico e metadati causali |
| Persistenza sincrona | `localStorage` | workout/timer/device state, preferenze e boundary best-effort specifici |
| Replica cloud | Firebase Firestore | sincronizzazione tra dispositivi per gli account autenticati |

Le normali mutazioni business attraversano **Domain Operations**: l'intento viene trasformato in operazioni semantiche, persistito atomicamente nell'envelope locale e poi replicato verso Firestore. La sincronizzazione usa metadati causali/Vector Clock e mantiene le operation pending quando la rete non consente una conferma sicura.

Una race importante è coperta esplicitamente: se una nuova modifica locale avviene tra il commit remoto e l'acknowledge locale, LogBook prende lo snapshot remoto confermato come baseline e rigioca soltanto le operation locali ancora pending, evitando di perdere sia modifiche remote sia modifiche locali.

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

La sorgente approvata dell'icona [LB] viene processata da `scripts/resize_icons.mjs`; il manifest mantiene un solo asset standard 512×512 e un asset maskable 512×512 dedicato.

## Analytics e telemetria

Sono sistemi distinti:

- **telemetria tecnica LogBook:** errori/eventi sanitizzati per stabilità e diagnostica; per un account autenticato può essere collegata all'UID tecnico dell'utente e non viene descritta come anonima;
- **Firebase Analytics:** opt-in, inizializzazione lazy e consent-aware;
- **Vercel Analytics + Speed Insights:** renderizzati soltanto quando l'utente abilita l'opt-in Analytics.

I dettagli destinati agli utenti sono nella Privacy Policy dell'app. La documentazione tecnica non deve promettere anonimato quando esistono identificativi tecnici pseudonimi.

## Stack

- React 19
- Vite 8
- TypeScript 7
- Zustand 5
- Zod 4
- Firebase Web SDK 12 + Firebase Admin server-side
- Vercel Functions
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

Il client richiede le otto variabili `VITE_FIREBASE_*` configurate in `src/lib/firebase.ts`; App Check usa `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Per collegare un clone a servizi cloud reali occorre una configurazione Firebase propria o un ambiente autorizzato.

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

Il repository è configurato perché Vercel distribuisca **solo `main`**. I branch di sviluppo sono disabilitati in `vercel.json` e non devono generare Preview Deployment.

Il normale ciclo di consegna è quindi:

```text
branch dedicato
→ draft PR
→ Canonical Verification
→ review finale exact-head
→ merge in main
→ CI su main
→ deployment Vercel di produzione da main
```

## Documentazione tecnica normativa

Gli agenti e i maintainer devono partire da:

- [`AGENTS.md`](AGENTS.md) — invarianti e procedura operativa trasversale;
- [`.agents/rules/`](.agents/rules/) — contratti specialistici per sync, dati, account lifecycle, Firebase, CI, crash consistency, catalogo e UX.

In caso di divergenza tra documentazione e implementazione corrente, non assumere che il documento più vecchio sia corretto: verificare codice, test, history e configurazione, quindi riallineare la documentazione normativa insieme alla modifica pertinente.
