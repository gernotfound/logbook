# Servizi esterni e configurazione fuori repository

**Quando leggere:** GitHub/ruleset, Firebase, Google Cloud, Vercel, Snyk, IAM, domini e dismissioni.
**Non inferire:** configurazione nel repository, CI e deploy riusciti non certificano da soli quote, permessi o stato runtime del provider.

Questa regola disciplina i sistemi esterni la cui configurazione effettiva non è rappresentata integralmente dal repository Git.

Il registro decisionale stabile e leggibile anche fuori dal codice è `docs/operations/external-services-register.md`. Per il checkpoint effettivo di schema, binding, schedule e deploy consultare il [quadro operativo Cloudflare](../../docs/operations/cloudflare-current-state.md); verificare di nuovo i provider. Un deploy Worker non applica automaticamente migrazioni D1: usare soltanto i workflow manuali isolati con ledger, hash SQL, gate exact-SHA e preflight, senza assumere autorizzazione a scritture reali.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Stato operativo e fornitori target

- Kinde è il target per login email/password e Google e invii Auth. Il frontend pubblica soltanto il gateway OAuth/sessione **identity-only**, senza concedere accesso ai dati fitness. Per un GO account restano da verificare configurazione effettiva, identità, sessioni, policy password ≥15, Google, reset/verifica email, sicurezza, quote Free, erasure e privacy.
- Per il rate limit OAuth il gateway costruisce un bucket solo con metadati della richiesta diretta Cloudflare. Inoltra il digest della rete al solo Worker Kinde privato; non inoltra indirizzo IP, header di attribuzione del chiamante o bucket alle API fitness. L'IPv6 usa il prefisso /64; la configurazione DNS/edge non deve sostituire l'indirizzo con Pseudo IPv4. Le richieste da Worker, senza metadati o da un gateway della versione precedente condividono un bucket separato, sempre limitato. I cap restano locali a Cloudflare e distinti per start/callback. Verificare attribuzione e disponibilità su provider isolato prima del rilascio OAuth.
- Cloudflare: frontend Static Assets e quattro route Kinde OAuth/sessione sono pubblici; le API D1 fitness, le chiavi e il recovery restano in Worker privati, senza service binding `D1_API` sul frontend. Due D1 isolate dichiarano `jurisdiction=eu`: questo non certifica residenza di email/Workers/log o conformità GDPR. Riferimento: [quadro operativo](../../docs/operations/cloudflare-current-state.md).
- **MUST (deploy KEK privata):** da quando il secret `CLOUD_ACCOUNT_KEK_V1` è stato provisionato sul Worker `thelogbook-api-isolated`, ogni deploy automatico dell'API privata deve verificarne la presenza come binding `secret_text` **sia prima di qualsiasi scrittura al provider sia dopo il deploy**. La verifica legge solo il nome/tipo da Cloudflare e fallisce chiusa se assente, duplicato, sostituito da plaintext o non interrogabile. Non verifica il valore né prova restore, recuperabilità o autorizzazione del cloud fitness. Non inserire il segreto in CI o nel manifest Wrangler.
- **MUST (privacy frontend Cloudflare):** il provider non deve iniettare Web Analytics/RUM nel documento HTML. Nella verifica live 14/11 la zona `thelogbook.me` è in modalità `rum=manual`, con Web Analytics `auto_install=false` e ruleset `enabled=false`, dopo la correzione dell'iniezione automatica. Lo smoke confronta i byte del documento pubblicato con la build originale e deve restare bloccante; la policy di privacy è in [Telemetria](telemetry-and-privacy.md). Non eliminare dati storici del sito Analytics senza mandato dedicato.
- Firebase Auth/Firestore/App Check rimangono nei chiamanti del frontend legacy; Hosting Firebase è disabilitato. Non rimuovere i loro gate fino alla sostituzione verificata.
- Vercel: progetto backend sospeso secondo precedente riscontro; `vercel.json` imposta `git.deploymentEnabled=false` per tutti i branch. Functions e cron sono ancora nel codice, non equivalgono a un backend attivo.
- I servizi di posta dismessi non fanno parte della nuova architettura; i vecchi test sono rintracciabili solo nella cronologia Git, senza istruzioni attive concorrenti.

Ogni affermazione live va riletta presso il provider competente. [Registro](../../docs/operations/external-services-register.md).
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
- **MUST (fresh start):** non mantenere Service Worker di ritiro per installazioni pre-lancio inesistenti. Il progetto Vercel sospeso non è una strategia di rollback; non autorizzare vecchi origin in Kinde/Cloudflare senza una necessità verificata.
- **MUST:** prima di eliminare una funzione generica di portabilità, dimostrare che sia specifica del provider ritirato. Il supporto generico a base path/subpath non è automaticamente codice legacy di deployment.
- **VERIFY:** restrizioni referrer API key, origin/redirect OAuth, domini autorizzati Firebase Auth, domini reCAPTCHA/Fraud Defense e proprietà Search Console sono stato esterno.

## Boundary dei provider

### Firebase / Google Cloud

Firebase Hosting, Firebase Authentication, Firestore, Firebase Admin e App Check sono boundary distinti anche quando condividono lo stesso progetto Google Cloud. Il precedente frontend/PWA era servito da Firebase Hosting statico sul piano Spark, site ID `thelogbook`, **disabilitato il 12/11/2026 secondo output CLI fornito**. Il frontend candidato Cloudflare Workers Static Assets risulta già distribuito sul Worker `thelogbook-frontend` secondo l'inventario provider; la decisione del 14/11/2026 autorizza l'origin `thelogbook.me` come unico sito pubblico di sviluppo, non il GO funzionale della PWA. La route Custom Domain `thelogbook.me`, il certificato assegnato e la disabilitazione effettiva di `workers.dev`/preview sono stati letti sul provider il 14/11/2026; il successo del deployment e dello smoke HTTP resta una verifica separata per ogni SHA. Functions/Scheduler Firebase non fanno parte dell'architettura.

- Seguire `.agents/rules/firebase-config.md` per contratti env client/server, App Check e Rules.
- Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio Fraud Defense. TheLogBook usa attualmente il provider reCAPTCHA Enterprise tramite Firebase App Check; non dichiarare attive Account defense, SMS defense, transaction defense o API Fraud Defense dirette senza evidenza live.
- Le restrizioni Browser API key e la configurazione OAuth sono controlli di sicurezza esterni e devono essere riesaminati quando cambia l'origin canonico di deployment.
- **Decisione di prodotto 2026-11-10:** mantenere le **25 API già presenti nell'allowlist della Firebase Browser key**; non proporne o eseguirne la riduzione per mera pulizia. Un eventuale cambiamento necessita nuova decisione di prodotto motivata, verifica chiamanti/SDK e regressioni. Vedi [registro servizi esterni](../../docs/operations/external-services-register.md).
- **MUST:** le chiamate REST dirette a Firebase Authentication/Identity Toolkit non ricevono automaticamente l'attestazione App Check dal Firebase SDK. Con enforcement Auth, il collegamento email/password in `src/lib/auth/accountEmail.ts` deve acquisire un token App Check **standard** e inviarlo nell'header `X-Firebase-AppCheck`, ricontrollando la sessione prima di trasmettere le credenziali; se il token manca, non effettuare la richiesta. Il token limited-use con consumo una tantum resta riservato alle API trusted Vercel. Con protezione anti-enumerazione attiva, il collegamento usa `accounts:signUp` con `idToken`, non il vecchio `accounts:update`.


### Vercel — backend legacy sospeso

- Il repository imposta `git.deploymentEnabled=false` su tutti i branch; `ignoreCommand`, Functions e cron non riabilitano i deployment.
- Non riattivare il vecchio backend né distribuire frontend Vite su Vercel. Prima di rimuovere codice e test, verificare quali contratti non sono ancora stati convertiti e collaudati in Workers.
- Le credenziali server-only non devono mai usare prefisso `VITE_`.
### GitHub / CodeQL / Snyk

- GitHub è la fonte di verità per repository, PR/ruleset e CI canonica.
- CodeQL fa parte di `Canonical Verification`. Snyk **non è un job attivo nei workflow correnti del repository**; un suo eventuale riutilizzo richiede verifica nel provider e non può sostituire da solo i controlli di sicurezza bloccanti.
- Ruleset e required check sono stato GitHub esterno: verificarli direttamente prima di cambiare nomi dei check o comportamento di merge.

### Analytics: Cloudflare Web Analytics Free autorizzato, altri provider ritirati

- **Decisione di prodotto 17/11/2026:** Cloudflare Web Analytics Free è autorizzato per visite e metriche aggregate di prestazioni, compatibilità e qualità della PWA. Il precedente divieto assoluto di pageview/analytics **non si applica a Cloudflare Web Analytics**, dopo le verifiche previste in [Telemetria e privacy](telemetry-and-privacy.md). Attivazione futura: [issue #1202](https://github.com/gernotfound/logbook/issues/1202); la decisione non costituisce già deploy o raccolta attiva.
- Google Analytics 4/Firebase Analytics, Vercel Analytics e Speed Insights restano ritirati: non reintrodurli come effetto di questa decisione.
- **MUST:** escludere dati sanitari, dati di account/sessione, URL sensibili, eventi individuali e report automatici di errori client. Verificare che la soluzione rispetti le quote Cloudflare Free, non introduca costi e conservi i gate privacy/CI. La limitazione dell'iniezione edge non vieta una futura integrazione manuale revisionata; preservare gli smoke byte-esatti.
- **NOTE:** l'assenza di SDK dal codice non prova l'erasure presso i vecchi provider; non è motivo per riattivare servizi dismessi.

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
