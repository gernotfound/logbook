# Telemetria tecnica e privacy — TheLogBook

**Quando leggere:** Sentry, coda diagnostica, sanitizzazione, retention e source map.
**Non inferire:** eleggibilità locale e accettazione dello SDK non provano consegna remota; i filtri testuali non eliminano ogni dato sanitario.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Destinazione e minimizzazione

Il client corrente usa **Sentry Error Monitoring** come destinazione esterna per errori e anomalie tecniche in Production. Il Firebase UID può essere usato localmente per stabilire l'eleggibilità all'invio, ma non viene deliberatamente inserito nel payload Sentry. Messaggi e stack locali attraversano i sanitizzatori, ma i filtri per pattern non riconoscono ogni nota sanitaria libera. **MUST:** al boundary Sentry inviare soltanto classificazioni di errore/origine da allowlist e messaggi tecnici fissi, mai messaggi, stack o component stack originali anche se sanitizzati. Il client non abilita PII di default, disattiva le integrazioni automatiche e `beforeSend` rimuove `user`, `request`, breadcrumb, transaction, extra e valori/stacktrace originali delle eccezioni. Replay, tracing, logging e metriche non sono abilitati.

Configurazione client/build:

- `VITE_SENTRY_DSN`: DSN pubblico del progetto Sentry, incluso nel bundle Production;
- `SENTRY_AUTH_TOKEN`: segreto build-only con scope CI per upload source map/release;
- `SENTRY_ORG` e `SENTRY_PROJECT`: identificatori build-time;
- `LOGBOOK_BUILD_SHA`: SHA exact-main passato dal workflow Firebase Hosting Production; `EXPECTED_SHA`/`GITHUB_SHA` restano fallback verificabili.

**MUST:** `SENTRY_AUTH_TOKEN` resta server/build-only, senza prefisso `VITE_`, e non deve comparire in bundle, log, Markdown o fixture. Le source map Production vengono caricate a Sentry e rimosse dagli asset pubblici dopo l'upload.

Le collection `users/{uid}/telemetry_errors`, `telemetry_events` e `telemetry_anomalies` sono contratti pre-lancio ritirati: il client corrente invia esclusivamente diagnostica tecnica a Sentry e non le legge né scrive. Il fresh start esclude il supporto dei client precedenti: le Security Rules non accordano più accesso client a queste collection, nemmeno al proprietario con consenso attivo. Non restano parser payload, retry o upgrade `expireAt` per quei client. Questa chiusura del boundary non cancella documenti e non certifica l'assenza di dati live: retention nominale 30 giorni, maintenance cron e cancellazione account/health-data restano operativi attraverso Admin SDK per eventuali record residui. Il loro ritiro backend completo richiede verifica separata del provider e del contenuto; non rimuovere tali tutele come side effect del clean-cut client.

## Coda cifrata owner-scoped

**MUST:** per la coda diagnostica, best-effort **non** significa storage in chiaro: errori/stack, session ID e UID possono essere presenti nel payload tecnico.
I nuovi report persistono esclusivamente cifrati con chiave owner-scoped sbloccata e AEAD autenticata; prima dello sblocco restano in RAM.
Le code plaintext pre-lancio non vengono lette, adottate, convertite né cancellate automaticamente; la chiusura della scheda può perdere i report ancora soltanto in RAM.
Un ciphertext illeggibile non autorizza la sua cancellazione o sovrascrittura.
**MUST:** il writer corrente registra un `queuedAt` numerico per ogni report. La retention di sette giorni usa solo tale timestamp: i record che ne sono privi, lo hanno malformato o implausibilmente futuro sono esclusi, senza usare `timestamp` dell'evento come fallback. Le voci scadute non vengono restituite né inviate e il replay non può reintrodurle; il pruning dello storage avviene al successivo accesso alla coda.
Tale retention tecnica è distinta da quella Firestore legacy di 30 giorni e da Sentry Production.

**MUST:** mantenere i limiti di capacità della coda corrente, la separazione owner e il fallback RAM. Un guest privo di UID autenticato non autorizza invio Sentry né riassegnazione dei report dopo il login.

- **MUST:** code diagnostiche persistenti soltanto con AEAD owner-scoped e vault disponibile; in caso contrario usare il fallback in memoria previsto, senza creare nuove copie plaintext. Mantenere i limiti di capacità e la retention dei report correnti, senza importare o cancellare code globali pre-lancio. Una cache di telemetria già persistita non è prova della versione cifrata più recente: prima di riutilizzarla per lettura/nuovo enqueue, ricaricare la coda protetta per lo stesso owner quando il vault è disponibile; se esistono eventi RAM non ancora persistiti, preservarli e riconciliarli senza sovrascrivere ciphertext illeggibile. Gli aggiornamenti differiti dei conteggi d'errore sono patch applicate soltanto agli ID ancora presenti nella copia cifrata corrente: non devono reinserire report già consegnati né cancellare nuovi report di un'altra scheda. La ripresa non deve reintrodurre report che un'altra scheda ha già rimosso. Questo non rappresenta un CAS atomico fra schede.

## Analytics ritirati

Google Analytics/Firebase Analytics, Vercel Analytics e Speed Insights sono fuori dal runtime. Nessun SDK `firebase/analytics`, Measurement ID, evento comportamentale o consenso GA4 da reintrodurre. Il fresh start non richiede cleanup di vecchie preferenze GA4. Storia delle dismissioni e verifiche provider restano nel [registro esterno](../../docs/operations/external-services-register.md), senza dedurre assenza di dati live.

## Privacy e verifica

- Non promettere anonimato in presenza di identificativi tecnici; nessun payload salute libero, UID deliberato o credenziale nel servizio esterno.
- Le modifiche materiali alla Privacy Policy usano `LEGAL_VERSIONS.privacy`, indipendente dalla release PWA.
- Testare il vero boundary di `src/lib/sentryClient.ts`, non soltanto i sanitizzatori locali.
- Code diagnostiche, Sentry Production e raccolte Firestore ritirate hanno retention distinte; configurazioni Data Scrubbing, quote e retention Sentry sono stato provider da leggere direttamente.
- [Guida Sentry](../../docs/telemetry-sentry-guide.md): quota/deduplica, best-effort delivery e source map. [Servizi esterni](external-services.md) e [Verifica CI](ci-verification.md): custodia secret, build e prove separate.
