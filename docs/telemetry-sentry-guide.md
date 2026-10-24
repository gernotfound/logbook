# Telemetria Sentry — guida operativa TheLogBook

> Stato: guida tecnica stabile | Ultima verifica repository: 2026-10-13 | Fonti eseguibili: `src/lib/sentryClient.ts`, `src/lib/telemetry/`, `src/lib/telemetrySanitizer.ts`, `src/lib/storageTelemetry.ts`, `vite.config.ts`, `firebase.json`.

TheLogBook usa Sentry esclusivamente come **Error Monitoring** tecnico della Production. Google Analytics 4/Firebase Analytics è dismesso anche sul provider (scollegato dal progetto Firebase, proprietà ritirata); Vercel Analytics e Speed Insights sono ritirati. TheLogBook non invia eventi di utilizzo a servizi analytics.

## Perimetro

Vengono inviati soltanto:

- errori JavaScript/React intercettati dal Telemetry Hub;
- promise rejection non gestite;
- fallback Zod rappresentati come un unico errore tecnico deduplicato, senza generare eventi locali aggiuntivi;
- anomalie critiche di recovery della persistenza.

Non vengono abilitati Sentry Session Replay, tracing, logging o Application Metrics. I flussi ordinari di utilizzo (workout, installazione PWA, navigazione) non diventano eventi Sentry.

## Privacy e minimizzazione

La coda locale applica la sanitizzazione per pattern a messaggi e stack (email, IP, credenziali, chiavi, percorsi utente). Questi filtri **non** possono riconoscere tutte le note sanitarie libere: perciò il boundary verso Sentry non invia messaggi, stack o component stack originali. Trasmette soltanto una classificazione di errore e di origine da allowlist e un messaggio tecnico fisso. Anche `beforeSend` scarta valori e stacktrace delle eccezioni aggiunti prima della serializzazione SDK. Lo SDK usa zero breadcrumbs e nessuna integrazione automatica.

Il Firebase UID serve solo come gate locale e **non viene deliberatamente inviato a Sentry**. Il contesto inviato è limitato a session ID tecnico conforme al formato generato dall'app, versione applicativa validata, build SHA, piattaforma derivata, display mode, stato online, classificazione source, contatori/timestamp. Il fingerprint remoto aggrega per tipo e origine tecnica: non include hash derivati da testi sanitari arbitrari. Questo riduce il dettaglio disponibile per il debugging ma mantiene i segnali tecnici essenziali.

Le impostazioni Sentry di Data Scrubbing, Default Scrubbers, IP scrubbing e Spike Protection sono configurazione esterna e devono essere verificate nella console quando rilevanti.

## Quota e deduplica

La finestra di deduplica client è 15 minuti per fingerprint. Il primo errore della finestra viene affidato allo SDK Sentry; ripetizioni successive vengono aggregate localmente ma non generano un secondo evento alla scadenza della finestra. Il successo di `captureException` indica accettazione locale dello SDK, **non conferma di consegna del server Sentry**. Il retry della coda copre i fallimenti/timeout rilevati prima di tale accettazione; i tentativi di rete successivi dipendono dal transport SDK e restano best-effort.

La coda diagnostica locale best-effort conserva al massimo 50 report; gli elementi più vecchi di sette giorni non vengono restituiti o inviati. I nuovi payload sono persistiti in `localStorage` soltanto come ciphertext AEAD owner-scoped quando il vault locale è sbloccato; prima restano nella RAM della scheda. Il fresh start non rilegge né importa code plaintext legacy, globali o owner-scoped. Se il vault è bloccato, soltanto i nuovi report restano in RAM e possono andare persi alla chiusura della scheda. Il pruning del ciphertext avviene al successivo accesso alla coda, non automaticamente mentre la PWA è chiusa. Gli elementi guest privi di UID autenticato non vengono riassegnati dopo il login. Questa durata locale non determina la retention di Sentry né quella delle collection Firestore legacy.

## Release e source map

La build frontend **Firebase Hosting Production** usa:

- `VITE_SENTRY_DSN` nel browser;
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` soltanto nella build trusted GitHub Actions;
- l'exact SHA GitHub come nome release completo.

`@sentry/vite-plugin` viene attivato soltanto quando `FIREBASE_HOSTING_DEPLOY=production` e sono presenti le credenziali build. Vite genera source map hidden, il plugin le carica a Sentry e poi elimina `dist/**/*.map`, evitando di pubblicarle come asset statici. I deploy backend Vercel non attivano questo passaggio frontend.

## CSP

`firebase.json` autorizza l'endpoint ingest Sentry del progetto nella direttiva `connect-src`. Non è richiesto alcun dominio Sentry in `script-src` perché lo SDK viene bundlato dall'app.

## Firestore legacy

Le collection `telemetry_errors`, `telemetry_events` e `telemetry_anomalies` non sono più la destinazione del client corrente. Restano temporaneamente:

- Security Rules storiche per percorsi non più supportati dalla PWA corrente;
- retention di 30 giorni e maintenance cron per documenti esistenti/legacy;
- account deletion, che continua a rimuovere le collection private note.

La loro eventuale rimozione completa resta un intervento backend/Rules separato, soggetto a verifica del provider live e dell'effettivo contenuto: non è implicitamente autorizzato dal fresh start del client.

## Verifica

Per ogni modifica al monitoring:

1. mantenere sanitizzazione/minimizzazione;
2. non aggiungere dati business liberi;
3. aggiornare test del boundary di produzione;
4. verificare la build source-map Sentry nel workflow Firebase Hosting Production;
5. verificare almeno un errore controllato in Sentry senza esporre PII;
6. eseguire il gate canonico `npm run verify:m8` sull'exact SHA candidato.

Una modifica materiale al flusso richiede coerenza con Privacy Policy, documentazione compliance e versione `LEGAL_VERSIONS.privacy`.
