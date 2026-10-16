# TheLogBook — istruzioni operative per agenti AI

Ambito: soltanto la PWA TheLogBook (`gernotfound/logbook`). Questo file è la mappa dei vincoli trasversali, non una fotografia completa del runtime. Le specifiche sono in `.agents/rules/`, le versioni effettive nei manifest eseguibili.

## Convenzioni

Ogni regola in questo documento è classificata:

- **MUST:** requisito non negoziabile. Violarlo può causare bug, perdita dati o problemi di sicurezza.
- **SHOULD:** preferenza forte. Derogare solo con motivazione tecnica esplicita.
- **VERIFY:** controllare codice, test o dashboard prima di assumere che sia vero.
- **NOTE:** contesto storico o informativo, non istruzione esecutiva.

Un `MUST` è un contratto da rispettare, non prova che codice o Production lo soddisfino già. Se codice, test e documentazione divergono, raccogliere evidenze prima di decidere quale fonte riallineare.

## Fonte di verità e gestione del drift

1. Il repository GitHub `gernotfound/logbook`, al commit realmente letto, è la fonte di verità tecnica.
2. Prima di analizzare o modificare: controllare l'HEAD reale di `main`, leggere questo file, leggere le regole pertinenti in `.agents/rules/`, quindi cercare implementazione, chiamanti, tipi, test e configurazioni correlate.
3. `AGENTS.md` contiene gli invarianti trasversali; `.agents/rules/` contiene i contratti specialistici.
4. Se documentazione e codice divergono, non modificare il codice per farlo aderire alla cieca a una regola obsoleta. Discriminare il comportamento corretto con codice, test, history e configurazione; correggere la fonte normativa nello stesso task quando necessario.
5. Una regola documentale obsoleta non deve bloccare un upgrade tecnicamente corretto: va aggiornata o rimossa con evidenza e regressioni adeguate.
6. **MUST:** quando un refactor rimuove o rinomina funzioni/contratti o cambia i gate di CI, cercare i riferimenti normativi collegati in `AGENTS.md`, `.agents/rules/` e nella documentazione operativa; riallinearli nello stesso task. Descrivere prioritariamente gli invarianti, senza citare come esistenti helper rimossi o classificare advisory verifiche realmente bloccanti.
7. **MUST:** non dichiarare mai letto, testato, deployato o verificato ciò che non è stato realmente osservato.
8. **MUST:** distinguere contratti vigenti, motivazioni storiche e osservazioni live. Date e SHA di baseline non dimostrano l'assenza attuale di dati/utenti o la configurazione corrente dei provider.
9. **MUST:** `.agents/rules/*.md` contiene documenti **da aprire esplicitamente** secondo il task: non presumere che ogni agente o connettore li carichi automaticamente. Leggere regole, implementazione, chiamanti, test e configurazioni sullo SHA corrente.

## Quali documenti leggere

- **Ogni task:** questo file, HEAD GitHub di `main`, regole pertinenti e codice/test coinvolti.
- **Archivio locale, journal, replica e workout:** `.agents/rules/storage-and-sync.md`; integrare `.agents/rules/crash-consistency.md`, `.agents/rules/causal-gc.md`, `.agents/rules/domain-operations.md` dove pertinenti.
- **Modello dati, proiezioni, nuove mutazioni:** `.agents/rules/data-model-and-zod.md`, `.agents/rules/domain-operations.md`.
- **Backup, import/export, guest, consenso, Auth, logout, cancellazione:** `.agents/rules/account-lifecycle.md`; integrare `.agents/rules/storage-and-sync.md` e `.agents/rules/firebase-config.md`.
- **Firestore Rules, App Check e servizi/deploy:** `.agents/rules/firebase-config.md`, `.agents/rules/external-services.md`, `.agents/rules/ci-verification.md`.
- **UI, temi, PWA, Service Worker, accessibilità:** `.agents/rules/design-system.md`; per update/reload anche `.agents/rules/storage-and-sync.md`, `.agents/rules/account-lifecycle.md`.
- **Catalogo e seeding:** `.agents/rules/catalog-operations.md`; per custom item `.agents/rules/data-model-and-zod.md`.
- **CI, oracle, fuzz:** `.agents/rules/ci-verification.md`, `.agents/rules/verification-hardening.md`, `.agents/rules/distributed-fuzz.md` secondo il cambiamento.

Se la modifica attraversa più boundary, leggere **l'unione** dei contratti pertinenti. L'indice non è un'allowlist di file da ignorare.

Per specifiche, guide operative, compliance e storico consultare l'[indice `docs/`](docs/README.md), che distingue stato e ambito. **Non** leggere automaticamente tutti i documenti né considerare proposte o checklist storiche come contratti attivi.

## Classificazione del rischio

Classificare internamente ogni task almeno come STANDARD, SENSITIVE o CRITICAL.

Sono **CRITICAL** almeno: dati utente, IndexedDB/persistenza, sincronizzazione, Firestore e Security Rules, autenticazione, guest→account, schema/migrazioni, import/export, cancellazione account, PWA update/reload e qualunque percorso con rischio di perdita/corruzione dati o sicurezza.

- **MUST:** maggiore è il rischio, maggiore è la profondità di ricerca, test e review.
- **MUST:** risolvere la root cause, non applicare workaround locali che lasciano invarianti incoerenti.
- **MUST:** mantenere il diff minimo rispetto all'obiettivo e aggiungere test di regressione quando appropriato.
- **MUST:** analisi in sola lettura = nessuna modifica. Un incarico operativo non autorizza cancellazioni irreversibili di dati reali, bypass di protezioni o modifiche IAM/secret live estranee.
- **MUST:** una motivazione storica pre-lancio non dimostra assenza attuale di account, dati, backup o vecchie PWA installate.

## Diagnosi e audit

- **MUST:** non fermarsi al primo finding. Completare il perimetro pertinente distinguendo sintomo, causa immediata e root cause; seguire chiamanti, stato, persistenza, UI/runtime, test, workflow e configurazioni quando influiscono sulla diagnosi.
- **MUST:** cercare evidenze contrarie, cause concorrenti e pattern analoghi prima di chiudere un audit. Per i percorsi CRITICAL includere failure path, recovery e invarianti di integrità dei dati.

## Autonomia operativa

Quando il product owner autorizza a procedere, risolvere o completare un task, l'autorizzazione copre l'intero normale ciclo tecnico pertinente: analisi → root cause → branch → implementazione → test → commit → PR → correzione CI → review → merge → verifica post-merge → verifica Firebase Hosting e Vercel runtime.

Non richiedere una nuova approvazione per scelte di implementazione, test falliti, CI rossa, conflitti tecnici o correzioni necessarie lungo quel ciclo. Fermarsi solo se serve una vera decisione di prodotto/UX non deducibile, un'azione distruttiva/irreversibile sui dati utente non già autorizzata, oppure mancano permessi/strumenti indispensabili.

**MUST:** la delega tecnica non supera restrizioni esplicite sui connettori o autorizzazioni specifiche della chat. Non usare strumenti disabilitati per default senza consenso operativo esplicito e non aggirare un rifiuto di sicurezza cambiando canale.

Per task strutturali o CRITICAL preparare un piano di lavoro prima delle modifiche. Il piano può vivere nel reasoning, nella descrizione PR o temporaneamente nel branch; non richiede una seconda autorizzazione dopo un mandato generale a procedere. Eventuali `implementation_plan*.md` task-specific sono artefatti temporanei e **MUST** essere rimossi prima del candidato finale, in accordo con `.agents/rules/ci-verification.md`.

## Stack e runtime correnti

**Architettura:** frontend React/Vite/TypeScript, stato Zustand, validazione Zod, PWA offline-first, IndexedDB/localStorage e replica Firestore. Versioni delle librerie e dei runtime si verificano nei manifest/configurazioni eseguibili, non in un elenco duplicato qui.

- **Nome pubblico:** TheLogBook. Namespace tecnici e persistiti storici (`logbook:*`, package e chiavi storage) non cambiano senza migrazione esplicita.
- **Hosting:** frontend Firebase Hosting alla radice `/`; backend trusted con Functions native Vercel in `/api/` e Firebase Admin soltanto server-side. Non spostare un boundary per comodità.
- **UI:** CSS nativo e token semantici; **MUST:** niente Tailwind. Seguire `.agents/rules/design-system.md`.
- **Telemetria:** solo monitoraggio errori tecnici Sentry. Non reintrodurre Analytics comportamentali ritirati.
- **Toolchain e test:** `package.json`, `.node-version`, workflow e `.agents/rules/ci-verification.md` sono le fonti da consultare per versioni e comandi.

## Avvio locale

- **Requisiti:** Node.js 24.x e npm; Java è necessario per i test Firebase Emulator.
- **Installazione:** eseguire `npm ci`, copiare `.env.example` in `.env`, configurare i valori locali richiesti e avviare con `npm run dev`.
- **Verifica finale:** `npm run verify:m8`; i comandi `lint`, `test` e `build` da soli sono soltanto diagnostici.
- **Segreti:** `.env.example` contiene nomi e placeholder. Non versionare credenziali reali, `.env` o configurazioni private Production.

## File canonici del modello dati

**MUST:** classificare ogni dato come effimero, device-local, cloud-root o mensilizzato prima di modificarlo; `UserData` non coincide automaticamente con il documento root Firestore.

**MUST:** per una nuova chiave cloud-root verificare congiuntamente tipi, gateway Zod, proiezione, Domain Operations, hydration/merge, Rules, backup e regressioni. La matrice di file e responsabilità vive in `.agents/rules/data-model-and-zod.md`.

## Storage, persistenza e sincronizzazione

| Livello | Ruolo |
|---|---|
| **Zustand** | Stato operativo in memoria, source of truth per React |
| **IndexedDB** | Persistenza locale principale: Local Envelope V5 + journal semantico |
| **`localStorage`** | Persistenza sincrona/device-critical, preferenze e code boundary-specific |
| **Firestore** | Replica remota e sincronizzazione cloud |

Le versioni persistite sono quattro dimensioni indipendenti con fonte eseguibile in `src/lib/schemaEvolution.ts`. Il bump della PWA non le incrementa: modificarle soltanto con la specifica migrazione e le verifiche di compatibilità.

- **MUST:** offline l'app deve potersi avviare e operare dai dati locali.
- **MUST:** le normali mutazioni business UI/hook attraversano Domain Operations. Snapshot-save è riservato ai boundary bulk/compatibility allowlisted.
- **MUST:** IndexedDB e journal vengono aggiornati atomicamente prima della replica cloud.
- **MUST:** una write Firestore rifiutata non deve essere esposta come confermata.
- **MUST:** le Promise di persistenza critica rigettano in caso di failure; vietato trasformare un errore critico in successo silenzioso.
- **MUST:** il reload barrier è fail-safe: dati in memoria senza envelope leggibile = sessione unsafe, quindi niente reload automatico.
- **MUST:** una conferma cloud o lost-ack non può eliminare/sovrascrivere operazioni locali ancora pending. `local-pending` richiede prova dell'intero batch integro nel journal. Sequenze, causal context e recovery sono definiti in `.agents/rules/crash-consistency.md` e `.agents/rules/storage-and-sync.md`.

### Protezione automatica dell'archivio locale (CRITICAL)

- **MUST:** nessuna passphrase/PIN/codice di recupero aggiuntivo nella UX ordinaria; la PWA usa l'identità Firebase Auth confermata o una generazione guest valida per inizializzare il vault cifrato automaticamente, anche offline dove la sessione è già disponibile.
- **MUST:** UID, token e API key Firebase non sono segreti crittografici. Ogni owner ha DEK casuale, wrappata da un `CryptoKey` AES-GCM-256 **non esportabile** conservato in IndexedDB con namespace owner; la DEK non va persistita in chiaro.
- **MUST:** cifratura AEAD sincrona dei record nel **medesimo** `idb-keyval.update` e salvataggi device-critical sincroni, con owner/AAD autenticati e fail-closed se storage/key/ciphertext non sono leggibili.
- **MUST:** migrazione interrompibile/riprendibile, key control versionati, purge key soltanto dopo eliminazione verificata delle copie cifrate. Perdere la chiave non equivale ad avere l'archivio vuoto; conservare ciphertext offline non recuperabile.
- **VERIFY:** una chiave non esportabile dentro lo *stesso profilo browser* non protegge dal furto dell'intero profilo o da XSS. Non è crittografia end-to-end né sblocco mediante hardware remoto.
- **MUST:** una sessione autenticata già verificata può operare **solo localmente** offline con la generazione di consenso attivo in cache.
- **MUST:** dopo una revoca locale offline l'accesso fitness resta sospeso. Eccezione: la persona presta **esplicitamente** un nuovo consenso valido per il solo dispositivo **e** la revisione precedente è già attestata dal server; l'intento di revoca precedente rimane durevole.
- **MUST:** il primo accesso senza consenso verificato resta bloccato.
- **MUST:** il primo `online`/foreground deve interrogare e riconciliare il consenso server **prima** di letture/write cloud, checkpoint o journal. Una revoca remota più recente blocca le attività e preserva il journal locale senza upload.
- **MUST:** nessun cache marker locale autorizza replica/cloud. Una nuova revisione dopo riaccettazione non può ri-etichettare pending del consenso precedente senza recupero separato ed esplicito.
- **MUST:** documentazione completa e limiti nel file `docs/architecture/secure-local-archive-design.md`.

### Accesso browser storage

`src/lib/sync/browserStorage.ts` distingue accessi strict e best-effort.

- **MUST:** gate di sicurezza/lifecycle che devono distinguere “chiave assente” da “storage illeggibile” usano il boundary strict e propagano/classificano l'errore.
- **MAY:** hint, preferenze e code best-effort possono degradare in modo conservativo secondo il loro contratto.
- **MUST:** non estendere automaticamente la semantica best-effort a logout, account deletion, reload barrier, ownership o altre invarianti CRITICAL.

→ Dettagli: `.agents/rules/storage-and-sync.md`, `.agents/rules/domain-operations.md`, `.agents/rules/crash-consistency.md`.

## Hydration e merge guest→account

- `window`: startup/foreground con root + finestra mensile; preservare i mesi locali non caricati.
- `all`: scansione completa per guest→account/operazioni complete; l'assenza remota diventa autorevole per i mesi coperti, quindi le pending locali vengono poi rigiocate.
- **MUST:** non trattare una hydration `all` come finestra parziale.
- **MUST:** il merge guest/cloud passa da `UserDataSchema.parse()` prima della persistenza.
- Array con ID: unione deduplicata con priorità guest in collisione; record per data: merge per data e ID; scalari business: guest se valorizzato. **Eccezione di sicurezza:** `legalConsent` non segue la priorità guest: il consenso della sessione ospite non si trasferisce automaticamente all'account.
- **NOTE:** “guest wins” non equivale a “dato più recente”. Leggere implementazione e test prima di alterare questa policy.

## Workout, timer e date

### `localWorkout` vs `activeWorkout`

| Campo | Storage | Scopo |
|---|---|---|
| `localWorkout` | `localStorage` owner-scoped + Zustand | Sessione in corso del dispositivo |
| `activeWorkout` | Firestore | Snapshot cloud del workout attivo |

- **MUST:** un fetch cloud non sovrascrive un `localWorkout` attivo.
- **MUST:** su `visibilitychange === 'hidden'`, salvare i dati device-critical sincronicamente e in modo protetto.
- **MUST:** il timer usa timestamp e ricalcolo del delta; non affidarsi a un `setInterval` puro per il tempo reale in background.
- **MUST:** date giornaliere utente in `YYYY-MM-DD` locale tramite l'helper canonico; non usare `toISOString().slice(0, 10)` per rappresentare una data locale.
- Timestamp evento/audit: UTC/epoch; shard mensile derivato dalla data locale business.

## Dati e Zod

- **MUST:** i dati in ingresso da boundary persistiti vengono prima normalizzati/migrati e poi validati dal gateway Zod applicabile.
- **MUST:** nessun `undefined` nei payload Firestore.
- **MUST:** elementi collezione privi dell'identità business richiesta vengono scartati; non creare “ghost record” assegnando identità fittizie per farli passare.
- **MAY:** campi non-identità corrotti possono essere sanitizzati dai sub-schema solo secondo i fallback esplicitamente modellati.
- **MUST:** una versione futura sconosciuta è fail-closed / `update-required`; non riscrivere dati futuri con la versione corrente.

→ Dettagli: `.agents/rules/data-model-and-zod.md`.

## Sicurezza e configurazione Firebase

**Tre boundary:** client Firebase (`VITE_FIREBASE_*`), App Check client (`VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`), backend trusted (`FIREBASE_ADMIN_*` e `CRON_SECRET`). Mai esporre credenziali server con prefisso `VITE_`, né versionare segreti reali.

- **MUST:** rispettare bootstrap App Check e token limited-use/anti-replay per endpoint sensibili. Un `permission-denied` resta rifiuto finché la causa non è diagnosticata, non un salvataggio riuscito.
- **MUST:** Firestore Rules richiedono test Emulator, gate canonico e workflow Production dedicato. Deployment Hosting e Firestore hanno identità WIF separate e devono rispettare l'ordine sicuro client/Rules.
- **MUST:** verificare dal provider stato live di Auth, IAM, env, domini, App Check, Rules e deployment.

→ Contratti: `.agents/rules/firebase-config.md` e `.agents/rules/external-services.md`.

## Servizi esterni e configurazione fuori repository

Repository e provider esterni sono fonti distinte. GitHub ruleset, Firebase/Google Cloud, Vercel, Sentry, Snyk e Search Console possono differire dalla configurazione nel codice.

- **MUST:** verificare direttamente provider, quote, domini, enforcement e runtime pertinenti prima di affermare lo stato live; non pubblicare credenziali o dati personali.
- **MUST:** aggiornare il registro operativo solo per cambi materiali verificati, distinguendo stato osservato, decisione e fatto storico.

→ `.agents/rules/external-services.md` e `docs/operations/external-services-register.md`.

## Account lifecycle e cancellazione account

**CRITICAL:** cancellazione account server-mediated; il client non elimina direttamente `/users/{uid}`.

- **MUST:** Functions Vercel autenticano la richiesta, Firebase Admin gestisce il job, elimina i dati privati e cancella Firebase Auth **per ultima**. `account_deletions/{uid}` è un marker server-only cross-device.
- **MUST:** la copia locale resta fino alla prova di completamento server. Timeout, risposta assente, Auth mancante o tombstone scaduto non sono prova sufficiente.
- **MUST:** il tombstone tecnico server-only viene conservato fino a 30 giorni; il cron autenticato esegue il cleanup senza indebolire i percorsi di recovery.
- **MUST:** consenso revocato, email non verificata, guest→account, logout e cancellazione hanno failure path distinti e non devono essere confusi.

→ Dettagli: `.agents/rules/account-lifecycle.md`, `.agents/rules/storage-and-sync.md`.

## Telemetria tecnica e privacy

**MUST:** Sentry resta limitato a errori/anomalie tecniche sanitizzati, minimizzati e autorizzati: non inviare intenzionalmente UID, dati salute, token o eventi comportamentali; non attivare Replay, tracing, logging, metriche o Analytics.

- **MUST:** code diagnostiche persistenti soltanto con AEAD owner-scoped e vault disponibile; in caso contrario usare il fallback in memoria previsto, senza creare nuove copie plaintext. Mantenere compatibilità e retention legacy finché necessarie.
- **MUST:** source map e token di upload restano nel processo build Production, non negli asset pubblici.
- **MUST:** non promettere anonimato quando esistono identificativi tecnici. Le modifiche materiali alla Privacy Policy seguono `LEGAL_VERSIONS.privacy`, indipendente dalla versione PWA.

→ `.agents/rules/firebase-config.md`, `.agents/rules/storage-and-sync.md`, `docs/telemetry-sentry-guide.md`.

## PWA, Service Worker e icone

- `vite-plugin-pwa` usa manifest e service worker alla radice `/`.
- La sorgente vettoriale approvata `assets/brand/thelogbook-icon-master.svg` è canonica; `scripts/resize_icons.mjs` pubblica la copia scalabile `public/icon.svg` e genera direttamente dal master favicon, Apple touch, PNG PWA, variante maskable e card social PNG lossless. Quando cambia l'artwork, i riferimenti HTML/manifest devono cambiare revisione per invalidare le cache degli icon consumer.
- Il manifest deve mantenere gli asset PNG standard 192×192 e 512×512 richiesti per la compatibilità/installabilità, la copia SVG scalabile `icon.svg` con `sizes: any` e il dedicato `icon-maskable-512.png` per `purpose: maskable`; evitare duplicati semantici oltre queste varianti necessarie.
- **MUST:** una modifica all'icon pipeline va verificata attraverso build/gate, non solo guardando il file sorgente.
- **MUST:** il reload/update della PWA rispetta il reload barrier di persistenza prima di applicare una nuova versione.

## Design system e UX

**MUST:** temi system/light/dark, bootstrap senza flash e UX leggibile su mobile. Valori CSS e scala tipografica hanno fonte in `src/styles/tokens.css` e `.agents/rules/design-system.md`, non in numeri duplicati qui.

- **MUST:** dialoghi tramite `GlobalDialog`/`useDialogStore`, non `window.alert`/`window.confirm`. Preferire superfici inline/full-screen per editor mobili complessi.
- **MUST:** input anti-zoom iOS, target touch e safe area accessibili; verificare light/dark, viewport, overlay e comportamento su dispositivi quando pertinente.
- **MUST:** non creare nuove referenze a ogni render nei selettori Zustand. Nelle schede mantenute vive sotto `Suspense`, non usare l'attributo HTML `hidden` come meccanismo di tab visibility: preservare il pattern `style={{ display: ... }}` salvo migrazione esplicitamente testata.
- **MUST:** recovery e render React non mutano lo store globale. `useRef(initialValue)` non è lazy initialization: preservare owner/session fencing e commit React per bozze device-critical.

→ Specifiche: `.agents/rules/design-system.md`.

## Processo Git e branch

Per modifiche non banali:

- **MUST:** lavorare su branch dedicato, non direttamente su `main`.
- **MUST:** mantenere la PR draft durante sviluppo/correzioni e renderla pronta solo quando il candidato finale è verificato.
- **MUST:** prima di ogni validazione candidata registrare l'esatto HEAD; dopo un nuovo commit, le verifiche sul vecchio SHA non certificano più il nuovo candidato.
- **MUST:** eseguire review finale del diff ed evitare refactor/formattazioni non pertinenti.
- **MUST:** dopo autorizzazione generale il merge può avvenire autonomamente quando gate e review sono verdi e non restano blocker.

### Versionamento della PWA

- **MUST (decisione prodotto):** a ogni commit che entra in `main` tramite normale squash merge incrementare di uno la componente minor della versione applicativa in `package.json` e azzerare la patch (da `MAJOR.MINOR.PATCH` a `MAJOR.(MINOR+1).0`). Calcolare il numero dal vero HEAD remoto di `main`, non dalla versione iniziale del branch; in caso di merge concorrente riallineare e rivalidare.
- **MUST:** includere il bump e la sincronizzazione dei due campi root in `package-lock.json` nel candidato PR **prima** della CI exact-SHA e review. Non introdurre bump post-verifica, commit CI automatici o push diretti a `main` e non incrementare per commit intermedi del branch.
- **MUST:** non duplicare la versione pubblica in `AGENTS.md`. Il bump non modifica automaticamente Data Schema, Sync Protocol, Local Envelope, Backup Schema, manifest catalogo o versioni dei documenti legali.
- **VERIFY:** i manifest package sono input del selettore Vercel backend; anche un bump senza modifiche di codice può provocare un deploy. Verificarne l'esito senza indebolire il rilevamento dei cambi alle dipendenze server.

## Test e CI

Il gate canonico locale è `npm run verify:m8`. Su GitHub l'equivalente richiede `Milestone Verification` sullo SHA esatto: tutti gli shard, E2E, CodeQL e `Canonical Verification` verdi.

- **MUST:** i subset `lint`, `test`, `build`, `test:e2e` sono diagnostici, non sostituti del gate finale.
- **MUST:** ogni nuovo commit invalida le verifiche relative allo SHA precedente.
- **MUST:** non indebolire test/no-skips, sicurezza, baseline warning, Emulator o protezioni GitHub per ottenere CI verde.
- **MUST:** i test normativi attraversano il boundary reale e hanno oracle indipendenti; un mock che replica la logica testata non è una prova sufficiente.
- **MUST:** distinguere test locale, CI PR, merge, CI post-merge, deploy e stato runtime; dichiarare esplicitamente ogni verifica mancante.

→ `.agents/rules/ci-verification.md`, `.agents/rules/verification-hardening.md`.

## Vercel e deployment

`vercel.json` definisce il backend trusted; il frontend Production è Firebase Hosting.

- **MUST:** `main` è l'unico branch con deploy Vercel; niente Preview dei branch di sviluppo come sostituto del gate.
- **MUST:** `ignoreCommand` salta soltanto modifiche dimostrabilmente non pertinenti al backend. Se SHA precedente o diff non sono attendibili, **deploy fail-open**, mai skip arbitrario.
- **MUST:** dopo il merge verificare SHA e CI su `main`, Hosting e Vercel separatamente; Vercel deve deployare se il diff è backend-relevant, altrimenti va verificato lo skip.

→ `.agents/rules/external-services.md` e `.agents/rules/firebase-config.md`.

## Catalogo globale

`global_catalog` è pubblico in lettura e non scrivibile dal client; i seed bundled sono intenzionalmente vuoti.

- **MUST:** una pubblicazione reale richiede file esterni validati/non vuoti, progetto esplicito e conferma; il dry-run resta non distruttivo.
- **MUST:** la versione del catalogo è distinta dalla versione pubblica della PWA. Un bump PWA non deve causare il seeding del catalogo.

→ `.agents/rules/catalog-operations.md`.

## Repository hygiene ed encoding

- **MUST:** documenti task-specific (`implementation_plan*.md`, report audit/remediation generati, directory legacy di report) non restano nel candidato finale salvo che siano deliberatamente documentazione stabile nel path canonico.
- Istruzioni normative: `AGENTS.md` + `.agents/rules/`; guide stabili e registri operativi: `docs/`. Audit e report di una singola revisione restano nella cronologia Git/PR; conservarne copie in `docs/audits/` solo quando servono ancora come evidenze storiche datate, chiaramente separate dallo stato corrente.
- **MUST:** Markdown e sorgenti UTF-8 senza BOM; non introdurre mojibake.

## Riferimenti normativi

I sottofile non sono caricati automaticamente in ogni ambiente; i loro dettagli, eccezioni e failure path devono essere consultati e confrontati con il codice corrente prima di apportare modifiche.

| Documento | Contenuto |
|---|---|
| [`.agents/rules/storage-and-sync.md`](.agents/rules/storage-and-sync.md) | Storage, versioni, hydration, offline-first e sync |
| [`.agents/rules/domain-operations.md`](.agents/rules/domain-operations.md) | Domain Operations V4 e mutation boundary |
| [`.agents/rules/data-model-and-zod.md`](.agents/rules/data-model-and-zod.md) | `UserData`, Zod, root, shard e local-only |
| [`.agents/rules/account-lifecycle.md`](.agents/rules/account-lifecycle.md) | Backup/import, deletion, logout, guest e PWA update |
| [`.agents/rules/firebase-config.md`](.agents/rules/firebase-config.md) | Env client/server, App Check, Rules, CSP e domini |
| [`.agents/rules/ci-verification.md`](.agents/rules/ci-verification.md) | Gate canonico, exact-head e CI contract |
| [`.agents/rules/crash-consistency.md`](.agents/rules/crash-consistency.md) | Commit atomico, lost ack, replay e recovery |
| [`.agents/rules/causal-gc.md`](.agents/rules/causal-gc.md) | Tombstone/vector-clock GC e stable frontier |
| [`.agents/rules/distributed-fuzz.md`](.agents/rules/distributed-fuzz.md) | Fuzz distribuito e convergenza causale |
| [`.agents/rules/verification-hardening.md`](.agents/rules/verification-hardening.md) | Qualità dei test normativi e production boundaries |
| [`.agents/rules/catalog-operations.md`](.agents/rules/catalog-operations.md) | Catalogo globale, seeding e recovery |
| [`.agents/rules/external-services.md`](.agents/rules/external-services.md) | Configurazioni esterne, segreti e verifica live |
| [`.agents/rules/design-system.md`](.agents/rules/design-system.md) | Tema, CSS, tipografia e UX |
