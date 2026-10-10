# Servizi esterni e configurazione fuori repository

Questa regola disciplina i sistemi esterni la cui configurazione effettiva non è rappresentata integralmente dal repository Git.

Il registro decisionale stabile e leggibile anche fuori dal codice è `docs/operations/external-services-register.md`.

## Fonte di verità

- **MUST:** codice/config repository e stato del provider esterno sono fonti di verità separate. Non dedurre la configurazione live dal solo repository.
- **MUST:** prima di cambiare un'integrazione esterna, verificare quando possibile lo stato live nel sistema competente: GitHub, Vercel, Firebase/Google Cloud, Sentry, Snyk o Google Search Console.
- **MUST:** quando cambia materialmente un'impostazione esterna, aggiornare nello stesso task il registro dei servizi oppure indicare esplicitamente perché non può ancora essere aggiornato.
- **MUST:** distinguere gli stati `ACTIVE`, `LEGACY`, `OPTIONAL`, `EXTERNAL-ONLY` e `VERIFY-LIVE`. Un'impostazione riportata storicamente non prova lo stato runtime corrente.

## Boundary privacy del repository pubblico

Il repository è pubblico.

- **MUST NOT:** committare valori segreti, auth token, private key, credenziali service account, email personali, identificativi di fatturazione/account, username della workstation o path filesystem personali.
- **MUST:** documentare nomi e scopo delle environment variable, non i valori segreti.
- **MUST:** non tracciare snapshot `.env.production` o equivalenti con valori reali del deployment. Il contratto pubblico vive in `.env.example`; i valori Production vivono nel provider di deployment.
- **SHOULD:** evitare di duplicare nella documentazione identificativi/site key client pubblici quando nome e ruolo sono sufficienti.
- **MUST:** esempi e fixture di test usano identità e path sintetici.
- **MUST:** il deploy Firebase Hosting da GitHub usa Workload Identity Federation con impersonation limitata al repository; il service account Hosting ha soltanto `roles/firebasehosting.admin` + `roles/serviceusage.apiKeysViewer`.
- **MUST:** il deploy Firestore Production usa un service account WIF separato, senza chiavi private, con il minimo contratto corrente `roles/firebaserules.admin` + `roles/datastore.indexAdmin` + `roles/serviceusage.apiKeysViewer` + `roles/serviceusage.serviceUsageViewer`; non assegnare questi privilegi al deployer Hosting per comodità.
- L'identità Firebase Admin di Vercel è separata e, quando consuma token App Check limited-use, deve possedere il permesso `firebaseappcheck.appCheckTokens.verify`; `roles/firebaseappcheck.tokenVerifier` è il ruolo minimo da preferire quando si assegna ex novo tale capacità, mentre un ruolo già presente che includa lo stesso permesso non va duplicato inutilmente.
- **MUST:** se un valore privato viene esposto, ruotarlo/revocarlo presso il provider e ripulire lo stato repository corrente dove praticabile; cancellare un messaggio o aggiungere un commit successivo non sostituisce la rotazione.

## Ritiro servizi e allowlist

- **MUST:** origin e domini di deployment ritirati vengono rimossi dalla configurazione applicativa e dalle allowlist esterne quando non sono più necessari.
- **MUST:** non mantenere autorizzato un vecchio origin per sola compatibilità storica se nessun runtime reale lo usa.
- **MUST:** il ritiro di un origin che ha ospitato una PWA deve considerare anche i Service Worker già installati: un redirect HTTP del root non basta se un worker legacy può ancora servire l'app shell dalla propria cache.
- **MUST:** durante la finestra di dismissione dell'origin Vercel, `/sw.js` deve servire un worker di ritiro non cacheabile che prende controllo, elimina soltanto le cache Workbox legacy e si deregistra senza forzare la navigazione delle finestre già aperte né toccare IndexedDB/localStorage; al caricamento successivo il root raggiunge il 301 verso Firebase. Non re-autorizzare il vecchio origin in Firebase Auth/App Check per rendere funzionante una copia PWA obsoleta.
- **MUST:** prima di eliminare una funzione generica di portabilità, dimostrare che sia specifica del provider ritirato. Il supporto generico a base path/subpath non è automaticamente codice legacy di deployment.
- **VERIFY:** restrizioni referrer API key, origin/redirect OAuth, domini autorizzati Firebase Auth, domini reCAPTCHA/Fraud Defense e proprietà Search Console sono stato esterno.

## Boundary dei provider

### Firebase / Google Cloud

Firebase Hosting, Firebase Authentication, Firestore, Firebase Admin e App Check sono boundary distinti anche quando condividono lo stesso progetto Google Cloud. Il frontend/PWA target è servito da Firebase Hosting statico sul piano Spark; Functions/Scheduler Firebase non fanno parte dell'architettura.

- Seguire `.agents/rules/firebase-config.md` per contratti env client/server, App Check e Rules.
- Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio Fraud Defense. LogBook usa attualmente il provider reCAPTCHA Enterprise tramite Firebase App Check; non dichiarare attive Account defense, SMS defense, transaction defense o API Fraud Defense dirette senza evidenza live.
- Le restrizioni Browser API key e la configurazione OAuth sono controlli di sicurezza esterni e devono essere riesaminati quando cambia l'origin canonico di deployment.

### Vercel

- Vercel è il boundary backend trusted Production: contiene env server-only, Functions e cron; il frontend/PWA Production target è Firebase Hosting.
- **MUST:** il deployment Vercel non deve eseguire né pubblicare il build Vite/Firebase del frontend. Il suo output statico è un artefatto backend-only dedicato; in particolare non deve esporre il Service Worker PWA generato per Firebase.
- `main` resta l'unico branch abilitato al deployment salvo cambio deliberato del contratto repository.
- Le credenziali server-only non devono mai avere prefisso `VITE_`.
- Un deployment Vercel verde non prova la CI GitHub; la CI verde non prova il deployment Production.

### GitHub / CodeQL / Snyk

- GitHub è la fonte di verità per repository, PR/ruleset e CI canonica.
- CodeQL fa parte di `Canonical Verification`; Snyk è supplementare e non deve diventare l'unico controllo SAST bloccante.
- Ruleset e required check sono stato GitHub esterno: verificarli direttamente prima di cambiare nomi dei check o comportamento di merge.

### Analytics di utilizzo ritirati

- Google Analytics 4/Firebase Analytics, Vercel Analytics e Speed Insights non fanno parte del runtime corrente.
- **MUST:** non inviare page view, eventi di utilizzo o dati sanitari a servizi analytics; mantenere separata la telemetria tecnica Sentry.
- **NOTE:** il product owner ha confermato lo scollegamento GA4 dal progetto Firebase, la dismissione della proprietà Google Analytics e la rimozione della variabile GitHub del Measurement ID. La PR #320 attesta separatamente la rimozione dal codice e dai workflow. Non permane alcuna configurazione Analytics corrente da gestire.

### Sentry

- Sentry resta Error Monitoring soltanto, salvo futura decisione esplicita di prodotto.
- Non attivare accidentalmente Session Replay, tracing, logging o Application Metrics seguendo wizard/onboarding.
- I token auth Sentry sono segreti build-only; il DSN browser è configurazione runtime pubblica ma non va duplicato inutilmente.
- Seguire `docs/telemetry-sentry-guide.md` per minimizzazione payload e source map.

### Google Search Console

- Search Console è un sistema di verifica/indicizzazione, non una dipendenza runtime dell'app.
- Mantenere coerenti URL Production canonico, metodo di verifica, `robots.txt` e `sitemap.xml`.
- Non rimuovere file/meta di verifica solo perché l'indicizzazione è già riuscita: la proprietà potrebbe dover essere riverificata in futuro.

## Review richiesta quando cambia un provider

Prima di sostituire, rimuovere o riconfigurare materialmente un servizio esterno:

1. identificare chiamanti e dipendenza runtime correnti;
2. verificare la configurazione live del provider;
3. identificare impatto dati/privacy/sicurezza;
4. identificare assunzioni su quota/free tier e comportamento in failure;
5. aggiornare codice/config/test;
6. aggiornare questa regola se cambia un invariante;
7. aggiornare `docs/operations/external-services-register.md` con motivo della decisione e data di verifica.
