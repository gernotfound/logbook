# Telemetria Sentry — guida operativa TheLogBook

> Stato: guida tecnica stabile | Ultima verifica: 2026-10-02 | Fonti eseguibili: `src/lib/sentryClient.ts`, `src/lib/telemetry/`, `src/lib/telemetrySanitizer.ts`, `src/lib/storageTelemetry.ts`, `vite.config.ts`, `firebase.json`.

TheLogBook usa Sentry esclusivamente come **Error Monitoring** tecnico della Production. Google Analytics 4/Firebase Analytics, Vercel Analytics e Speed Insights sono ritirati dal frontend Production; TheLogBook non invia eventi di utilizzo a servizi analytics.

## Perimetro

Vengono inviati soltanto:

- errori JavaScript/React intercettati dal Telemetry Hub;
- promise rejection non gestite;
- fallback Zod rappresentati come errore tecnico deduplicato;
- anomalie critiche di recovery della persistenza.

Non vengono abilitati Sentry Session Replay, tracing, logging o Application Metrics. I flussi ordinari di utilizzo (workout, installazione PWA, navigazione) non diventano eventi Sentry.

## Privacy e minimizzazione

Prima del boundary Sentry, TheLogBook sanitizza messaggi e stack rimuovendo pattern riconosciuti di email, IP presenti nel testo, Bearer/JWT, intestazioni Basic Authorization, chiavi Firebase, path utente e chiavi sensibili, incluse varianti comuni snake_case, kebab-case e camelCase. Lo SDK usa zero breadcrumbs, nessuna integrazione automatica e un `beforeSend` che elimina user/request/extra: gli errori vengono catturati manualmente dal boundary TheLogBook.

Il Firebase UID serve solo come gate locale per mantenere la semantica autenticata del sistema precedente e **non viene deliberatamente inviato a Sentry**. Il contesto inviato è limitato a session ID tecnico, versione app, build SHA, piattaforma derivata, display mode, stato online, source, contatori/timestamp e component stack sanitizzato quando disponibile.

Le impostazioni Sentry di Data Scrubbing, Default Scrubbers, IP scrubbing e Spike Protection sono configurazione esterna e devono essere verificate nella console quando rilevanti.

## Quota e deduplica

La finestra di deduplica client è 15 minuti per fingerprint. Il primo errore della finestra viene inviato; ripetizioni successive vengono aggregate localmente ma non generano un secondo evento alla scadenza della finestra. Questo limita l'impatto di hot loop sulla quota Sentry.

La coda locale best-effort resta bounded a 50 elementi per compatibilità/offline. Gli elementi guest privi di UID autenticato non vengono riassegnati dopo il login.

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

- Security Rules per client PWA precedenti;
- retention di 30 giorni e maintenance cron per documenti esistenti/legacy;
- account deletion, che continua a rimuovere le collection private note.

La loro rimozione completa è un task successivo e richiede evidenza che i client vecchi non possano più scrivere e che i dati residui siano stati smaltiti.

## Verifica

Per ogni modifica al monitoring:

1. mantenere sanitizzazione/minimizzazione;
2. non aggiungere dati business liberi;
3. aggiornare test del boundary di produzione;
4. verificare la build source-map Sentry nel workflow Firebase Hosting Production;
5. verificare almeno un errore controllato in Sentry senza esporre PII;
6. eseguire il gate canonico `npm run verify:m8` sull'exact SHA candidato.

Una modifica materiale al flusso richiede coerenza con Privacy Policy, documentazione compliance e versione `LEGAL_VERSIONS.privacy`.
