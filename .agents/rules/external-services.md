# Servizi esterni e configurazione fuori repository

**Quando leggere:** GitHub/ruleset, Firebase, Google Cloud, Vercel, Snyk, IAM, domini e dismissioni.
**Non inferire:** configurazione nel repository, CI e deploy riusciti non certificano da soli quote, permessi o stato runtime del provider.

Questa regola disciplina i sistemi esterni la cui configurazione effettiva non è rappresentata integralmente dal repository Git.

Il registro decisionale stabile e leggibile anche fuori dal codice è `docs/operations/external-services-register.md`.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Stato corrente Kinde e ritiro Mailjet/Brevo — 14/11/2026

**Nuova autorizzazione e prova provider — 14/11/2026:** il proprietario chiede ritiro account Mailjet e Brevo e pulizia DNS. Il plugin Cloudflare ha cancellato 7 record solo `notify.thelogbook.me` dedicati ai due fornitori; read-back 18→11, 11 estranei invariati (posta IONOS preservata). **Account Mailjet/Brevo non cancellati**: nessun accesso alle loro console; occorre conferma del proprietario. Screenshot Kinde: business `thelogbook.kinde.com` con regione `Europe - Ireland`, onboarding incompleto. Non generalizzare il mandato ad altri DNS, OAuth, provider, segreti o ambienti. Vedere [registro](../../docs/operations/external-services-register.md).

## Decisione precedente — selezione Kinde (prima della pulizia DNS)

Il product owner ha scelto **Kinde** per identità email/password e Google, con email Auth gestite dal provider, evitando l'integrazione Mailjet sul nuovo backend. Kinde non è ancora configurato/attivo; Free, regione EU, API di erasure, password workflow, sessioni, cookie Safari, audit e DPA richiedono verifica su tenant isolato. La scelta non elimina i controlli owner/consenso/revoca su D1. **Mailjet: RETIRE-PLANNED, non cancellato.** La PR #1077 è stata chiusa senza merge perché superata; dominio `notify.thelogbook.me`, record DNS e account provider hanno storia reale e richiedono inventario e autorizzazione DNS/provider specifica prima di ogni eliminazione. Non cancellare alla cieca record SPF/DKIM/DMARC o credenziali che potrebbero essere condivisi con altri flussi. Nessuna modifica Production, DNS, account o billing implicita.

## Stato transitorio e ritiro anticipato — 14/11/2026

- **Verifica provider 14/11:** Vercel `logbook` sospeso su richiesta del proprietario; evento Vercel `project-paused` osservato. Produzione bloccata in modo reversibile, nessuna eliminazione di progetto, segreti, dati o modifiche ad altri progetti. Le Functions/Cron ancora nel repository non sono un backend ora disponibile.
- **Controllo esterno GitHub `Vercel` — 14/11:** `main bc4a6296` riportava stato `failure` pubblicato dall'app Vercel, per l'ultimo deployment bloccato, pur con `Canonical Verification` e post-merge CodeQL verdi. Il ruleset GitHub `protect main branch` richiede soltanto `Canonical Verification`: `Vercel` non è un gate canonico. Il product owner ha richiesto di eliminare quel controllo superfluo. La configurazione repository pone `vercel.json.git.deploymentEnabled=false` per impedire **tutti gli auto-deploy Git**, incluso `main`, finché lo stack è sospeso. Questo non elimina gli stati già pubblicati né prova la disconnessione Git sul provider; verificare gli stati su nuovi commit dopo merge. La rimozione definitiva dell'app dal progetto non è autorizzata da questa sola modifica.
- **Cloudflare:** zona `thelogbook.me` active con record web ancora IONOS, nessuna route/custom-domain, unico Worker Static Assets `thelogbook-frontend` e D1 EU di test. Nessun cutover DNS eseguito; GO funzionale rimane bloccato.
- **GitHub:** PR #1083 MERGED su `main 2d4c9d5b` v2.394.0; CI main exact-SHA e CodeQL verdi, senza prova di runtime Cloudflare.

## Checkpoint storico — 13/11/2026

- Firebase Hosting `thelogbook` è disabilitato secondo output CLI del proprietario; il workflow GitHub Hosting è dichiarato disabilitato, `disabled_manually` non verificato indipendentemente. Non riattivarlo.
- Auth, Firestore/App Check e Vercel Functions/Cron sono **dipendenze del codice runtime ancora in uso**, non dati/account da migrare. Il product owner dichiara vuoti database e account; convertirne le funzionalità e abbandonare le dipendenze il prima possibile dopo i relativi test.
- PR [#1070](https://github.com/gernotfound/logbook/pull/1070), [#1072](https://github.com/gernotfound/logbook/pull/1072), [#1076](https://github.com/gernotfound/logbook/pull/1076), [#1078](https://github.com/gernotfound/logbook/pull/1078), [#1079](https://github.com/gernotfound/logbook/pull/1079) e [#1081](https://github.com/gernotfound/logbook/pull/1081) integrate; l'eventuale nuovo lavoro deve comunque verificare lo SHA corrente. Static Assets `thelogbook-frontend` senza binding D1, sandbox D1 `eu` con `0001`/`0002` soltanto; nessun Worker API/AuthGate pubblicato. Il percorso Auth/consenso/replica e il logout D1 restano candidati isolati.
- Il controllo Vercel del 13/11 ha mostrato un deployment Production `READY` su `4e25427ffbe0a4f4a7a695d25dec211b4ff16200` (backend precedente) e tentativi intermedi `CANCELED`: nessuno certifica Cloudflare o una PWA funzionante. Ri-verificare lo stato del provider quando rilevante. La rimozione di provider, credenziali, OAuth, DNS, cron e dati reali non è autorizzata da un merge, anche quando il prodotto nuovo parte vuoto.
- Dati precedenti, App Check quota e screenshot OAuth sono checkpoint storici. Stato live, vincoli Free, giurisdizioni e dismissioni vanno verificati nelle fonti competenti: [registro](../../docs/operations/external-services-register.md), [runbook](../../docs/operations/cloudflare-workers-migration.md), [CF-09](https://github.com/gernotfound/logbook/issues/1063).

## Fonte di verità

- **MUST:** codice/config repository e stato del provider esterno sono fonti di verità separate. Non dedurre la configurazione live dal solo repository.
- **MUST:** prima di cambiare un'integrazione esterna, verificare quando possibile lo stato live nel sistema competente: GitHub, Vercel, Firebase/Google Cloud, Snyk o Google Search Console.
- **MUST:** quando cambia materialmente un'impostazione esterna, aggiornare nello stesso task il registro dei servizi oppure indicare esplicitamente perché non può ancora essere aggiornato.
- **MUST:** distinguere gli stati `ACTIVE`, `LEGACY`, `OPTIONAL`, `EXTERNAL-ONLY` e `VERIFY-LIVE`. Un'impostazione riportata storicamente non prova lo stato runtime corrente.

## Boundary privacy del repository pubblico

Il repository è pubblico.

- **MUST NOT:** committare valori segreti, auth token, private key, credenziali service account, email personali, identificativi di fatturazione/account, username della workstation o path filesystem personali.
- **MUST:** documentare nomi e scopo delle environment variable, non i valori segreti.
- **MUST:** non tracciare snapshot `.env.production` o equivalenti con valori reali del deployment. Il contratto pubblico vive in `.env.example`; i valori Production vivono nel provider di deployment.
- **SHOULD:** evitare di duplicare nella documentazione identificativi/site key client pubblici quando nome e ruolo sono sufficienti.
- **MUST:** esempi e fixture di test usano identità e path sintetici.
- **MUST:** un eventuale deploy Firebase Hosting **solo se nuovamente autorizzato** usa Workload Identity Federation con impersonation limitata al repository; il service account Hosting ha soltanto `roles/firebasehosting.admin` + `roles/serviceusage.apiKeysViewer`. La WIF Hosting esistente non autorizza a riabilitare il workflow disattivato.
- **MUST:** il deploy Firestore Production usa un service account WIF separato, senza chiavi private, con il minimo contratto corrente `roles/firebaserules.admin` + `roles/datastore.indexAdmin` + `roles/serviceusage.apiKeysViewer` + `roles/serviceusage.serviceUsageViewer`; non assegnare questi privilegi al deployer Hosting per comodità.
- L'identità Firebase Admin di Vercel è separata e, quando consuma token App Check limited-use, deve possedere il permesso `firebaseappcheck.appCheckTokens.verify`; `roles/firebaseappcheck.tokenVerifier` è il ruolo minimo da preferire quando si assegna ex novo tale capacità, mentre un ruolo già presente che includa lo stesso permesso non va duplicato inutilmente.
- **MUST:** se un valore privato viene esposto, ruotarlo/revocarlo presso il provider e ripulire lo stato repository corrente dove praticabile; cancellare un messaggio o aggiungere un commit successivo non sostituisce la rotazione.

## Ritiro servizi e allowlist

- **MUST:** origin e domini di deployment ritirati vengono rimossi dalla configurazione applicativa e dalle allowlist esterne quando non sono più necessari.
- **MUST:** non mantenere autorizzato un vecchio origin per sola compatibilità storica se nessun runtime reale lo usa.
- **MUST:** il ritiro di un origin che ha ospitato una PWA deve considerare anche i Service Worker già installati: un redirect HTTP del root non basta se un worker legacy può ancora servire l'app shell dalla propria cache.
- **MUST (baseline fresh start pre-lancio):** il Service Worker di ritiro su `/sw.js` dell'origin Vercel è dismesso: non esistono installazioni pre-lancio da supportare. Vercel continua a ospitare solo backend trusted e il redirect del vecchio root verso il precedente frontend Firebase; questo redirect **non certifica un sito raggiungibile** dopo il disable. Il Service Worker della PWA era distribuito da Firebase Hosting; il nuovo runtime candidato Cloudflare va validato separatamente. Non re-autorizzare il vecchio origin in Firebase Auth/App Check.
- **MUST:** prima di eliminare una funzione generica di portabilità, dimostrare che sia specifica del provider ritirato. Il supporto generico a base path/subpath non è automaticamente codice legacy di deployment.
- **VERIFY:** restrizioni referrer API key, origin/redirect OAuth, domini autorizzati Firebase Auth, domini reCAPTCHA/Fraud Defense e proprietà Search Console sono stato esterno.

**Incidente quota 12/11/2026, Google Cloud:** notifica del provider per `logbook-db-98cc4` attesta **10.000 valutazioni gratuite reCAPTCHA consumate** e circa **12.813 azioni senza valutazione**. Non significa 12.813 richieste Firebase accettate. Sul piano senza billing, nuove `CreateAssessment` oltre quota falliscono `429 RESOURCE_EXHAUSTED`; App Check può non ottenere nuovi token. Mantieni enforcement, nessun upgrade a pagamento né bypass; il solo Cloudflare Hosting non mitiga questa quota. Considerare un provider custom App Check verificato via Turnstile Free e backend trusted, dopo analisi di IAM, rate-limit e failure path. Screenshot OAuth owner aggiornato mostra `thelogbook.me` e callback presenti e `thelogbook.web.app` rimossi: **non riattivare il vecchio sito per rollback non richiesto**. Verifica di salvataggio e login live ancora aperta. Dettagli nel registro e issue #1041.

## Boundary dei provider

### Firebase / Google Cloud

Firebase Hosting, Firebase Authentication, Firestore, Firebase Admin e App Check sono boundary distinti anche quando condividono lo stesso progetto Google Cloud. Il precedente frontend/PWA era servito da Firebase Hosting statico sul piano Spark, site ID `thelogbook`, **disabilitato il 12/11/2026 secondo output CLI fornito**. Il nuovo frontend target è Cloudflare Workers Static Assets, non ancora distribuito; Functions/Scheduler Firebase non fanno parte dell'architettura.

- Seguire `.agents/rules/firebase-config.md` per contratti env client/server, App Check e Rules.
- Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio Fraud Defense. TheLogBook usa attualmente il provider reCAPTCHA Enterprise tramite Firebase App Check; non dichiarare attive Account defense, SMS defense, transaction defense o API Fraud Defense dirette senza evidenza live.
- Le restrizioni Browser API key e la configurazione OAuth sono controlli di sicurezza esterni e devono essere riesaminati quando cambia l'origin canonico di deployment.
- **Decisione di prodotto 2026-11-10:** mantenere le **25 API già presenti nell'allowlist della Firebase Browser key**; non proporne o eseguirne la riduzione per mera pulizia. Un eventuale cambiamento necessita nuova decisione di prodotto motivata, verifica chiamanti/SDK e regressioni. Vedi [registro servizi esterni](../../docs/operations/external-services-register.md).
- **MUST:** le chiamate REST dirette a Firebase Authentication/Identity Toolkit non ricevono automaticamente l'attestazione App Check dal Firebase SDK. Con enforcement Auth, il collegamento email/password in `src/lib/auth/accountEmail.ts` deve acquisire un token App Check **standard** e inviarlo nell'header `X-Firebase-AppCheck`, ricontrollando la sessione prima di trasmettere le credenziali; se il token manca, non effettuare la richiesta. Il token limited-use con consumo una tantum resta riservato alle API trusted Vercel. Con protezione anti-enumerazione attiva, il collegamento usa `accounts:signUp` con `idToken`, non il vecchio `accounts:update`.


### Vercel

- Vercel è il boundary backend trusted Production: contiene env server-only, Functions e cron; il frontend/PWA precedentemente su Firebase Hosting è disabilitato e il target Cloudflare attende i gate di rilascio.
- **MUST:** il deployment Vercel non deve eseguire né pubblicare il build Vite/Firebase del frontend. Il suo output statico è un artefatto backend-only dedicato; in particolare non deve esporre il Service Worker PWA generato per Firebase.
- `main` resta l'unico branch abilitato al deployment salvo cambio deliberato del contratto repository.
- Le credenziali server-only non devono mai avere prefisso `VITE_`.
- Un deployment Vercel verde non prova la CI GitHub; la CI verde non prova il deployment Production.
- **VERIFY:** `scripts/vercel-ignore-build.mjs` controlla sempre `package.json` e `package-lock.json`, ignorando esclusivamente i campi root del numero di versione PWA quando entrambi i manifest sono coerenti. Qualsiasi modifica a dipendenze, script, lockfile non relativa a questi campi, file server o impossibilità di verificare la cronologia Git deve mantenere il deploy Vercel. I test di regressione canonici sono in `scripts/vercel-ignore-build-regressions.mjs`.

### GitHub / CodeQL / Snyk

- GitHub è la fonte di verità per repository, PR/ruleset e CI canonica.
- CodeQL fa parte di `Canonical Verification`. Snyk **non è un job attivo nei workflow correnti del repository**; un suo eventuale riutilizzo richiede verifica nel provider e non può sostituire da solo i controlli di sicurezza bloccanti.
- Ruleset e required check sono stato GitHub esterno: verificarli direttamente prima di cambiare nomi dei check o comportamento di merge.

### Analytics di utilizzo ritirati

- Google Analytics 4/Firebase Analytics, Vercel Analytics e Speed Insights non fanno parte del runtime corrente.
- **MUST:** non inviare page view, eventi di utilizzo, dati sanitari o report automatici degli errori client a fornitori esterni di analytics o monitoraggio. I log necessari ai servizi Firebase/Vercel costituiscono un trattamento distinto, da verificare nei rispettivi provider.
- **NOTE:** il product owner ha confermato lo scollegamento GA4 dal progetto Firebase, la dismissione della proprietà Google Analytics e la rimozione della variabile GitHub del Measurement ID. La PR #320 attesta separatamente la rimozione dal codice e dai workflow. La decisione di dismissione non certifica oggi lo stato delle console o la cancellazione di dati presso i provider.

### Monitoraggio errori esterno

Non esistono dipendenze di Error Monitoring nel runtime o nella build frontend. Non reintrodurre SDK, invii client, credenziali dedicate o caricamenti automatici di source map senza nuova decisione di prodotto. I controlli tecnici di integrità, gestione errori e recupero restano locali oppure propri dei servizi infrastrutturali necessari.

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

## Documenti collegati

- [Registro dei servizi esterni](../../docs/operations/external-services-register.md): decisioni e stato da rivalidare in console.
- [Cutover Firebase Hosting](../../docs/operations/firebase-hosting-cutover.md): **storico**, non checklist di deployment attuale.
