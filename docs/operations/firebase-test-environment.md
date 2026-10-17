# Ambiente di test isolato — TheLogBook

> **Stato:** frontend Firebase Hosting Test, backend Vercel Test e Firestore Rules/indici Test distribuiti; autenticazione, App Check, WIF/OIDC, Rules live e flussi E2E autenticati ancora da verificare. Le note storiche successive descrivono le tappe precedenti, non lo stato corrente.
> **Ambito:** Firebase Test e backend Vercel Test, separati dal runtime Production.
> **Ultimo aggiornamento:** 2026-10-17. Le configurazioni storiche elencate come "riferite" provengono da schermate del product owner; le verifiche dirette recenti sono distinte qui sotto.

## Registro operativo e regole di minimizzazione

Questo file e `docs/operations/external-services-register.md` sono il registro tecnico condivisibile nel repository **pubblico**. Ogni intervento su Test deve riportare data, ambito, baseline `main` e SHA del candidato, PR, verifiche osservate sullo SHA esatto, provider/progetto coinvolto, operazioni riuscite o fallite, stato del runtime e attività residue. Distinguere sempre test automatici, operazioni del provider e verifiche browser dal vivo. Le sezioni storiche sottostanti restano traccia delle fasi precedenti, non descrivono necessariamente lo stato attuale.

**Divieto di inserire valori sensibili o personali:** nessun valore di chiavi API o site key (anche se pubbliche), private key, token, credenziale, secret, `.env` reale, identificativo di sessione, recapito/email personale, nome di persona, percorso locale contenente uno username, screenshot non anonimizzato o contenuto di dati di allenamento. Riportare invece soltanto il **nome** delle variabili, gli identificativi tecnici non segreti necessari al collaudo, SHA, link a CI/PR e l'esito dei controlli. Dati di collaudo esclusivamente sintetici. I valori runtime devono rimanere nei provider autorizzati o in file locali ignorati, mai in commit, PR, log pubblici o documentazione.

### Cronologia verificata

| Data | Operazione | Evidenza / risultato | Limite |
|---|---|---|---|
| 2026-10-16 | Preparazione dell'ambiente Firebase/Vercel isolato e integrazione WIF keyless nel branch Test | Identità e ruoli IAM riferiti tramite schermate; protezioni e regressioni di codice nel branch | Le schermate IAM non provano uno scambio OIDC reale |
| 2026-10-16 | Primo deploy manuale del backend-only sul progetto Vercel Test | Deployment `dpl_B3chKa6BctS5NLJxKaXnhWPjsrZ6` dal commit `06b433387ba1f486f2b528a11da02550e4d19d41` READY; smoke: file statico 200, preflight Test 204, origin Production 403, App Check mancante 403, cron senza secret 503 | Vercel Authentication impedisce l'accesso browser ordinario; OIDC/STS e token App Check validi non collaudati |
| 2026-10-17 | Sincronizzazione branch Test e guardrail di build/deploy | PR #431 rimasta draft; CI canonica [38980606575](https://github.com/gernotfound/logbook/actions/runs/38980606575) riuscita sul commit `4f9f0f4dbba1f75654a482fb7c371c3b8ecce6d8` | Verifica automatica, non prova runtime |
| 2026-10-17 | Pubblicazione Firestore Rules e indici nel progetto **solo Test** | CLI `firebase deploy --only firestore --project thelogbook-test --config .firebase.test.local.json --non-interactive` terminata con esito 0 dal commit validato `4f9f0f4d`; Rules compilate e rilasciate, indici distribuiti nel database `(default)` | Autorizzazioni live con account fittizi e read-back ancora da verificare |
| 2026-10-17 | Incorporati i miglioramenti E2E di `main` | Commit Test `4a521e738bb23b0591467e4c6a72c9eae40c9f34`, [CI 38981211594](https://github.com/gernotfound/logbook/actions/runs/38981211594) riuscita; PR #431 ancora draft | Nessun merge su `main` o deploy Hosting da quel commit |
| 2026-10-17 | Ricevuta nel dialogo la site key pubblica reCAPTCHA Enterprise per Test | Disponibilità comunicata; **valore deliberatamente omesso dal repository** | Associazione al provider e acquisizione token App Check reali non ancora verificate |
| 2026-10-17 | Integrato l'ulteriore cambiamento di `main` sul budget di sync catalogo e sui pannelli Training inattivi | Baseline GitHub `df27d56bff4ea2f4081f642f343500cb2dbbb09d`; merge nel branch Test predisposto senza conflitti | Nuovo SHA e gate CI da verificare dopo il commit |

**Prossime prove:** verificare nel provider la site key e i domini Test senza riportare valori, testare App Check senza enforcement, risolvere l'accessibilità browser del backend Test senza incorporare bypass token pubblici, collaudare WIF/OIDC e Firestore autorizzato su account sintetici, poi build e Hosting Test, smoke browser/offline e casi di recovery. Nessuna azione su Production o merge PR #431 senza autorizzazione specifica.

## Progresso verificato successivo — 2026-10-17

- **Sincronizzazione GitHub:** `main` remoto `01223093c7f1885acab54fb516d1084897bc2e3b`, integrato senza conflitti nel branch Test `ef737f9d18411a60a224463787fbbbe98cf2f5c5`. La PR #431 resta draft e non viene integrata in `main`.
- **CI canonica:** [run 39017399742](https://github.com/gernotfound/logbook/actions/runs/39017399742) **SUCCESS**, incluso CodeQL, Playwright, Firebase Rules e shard di verifica sul commit esatto `ef737f9d18411a60a224463787fbbbe98cf2f5c5`.
- **Build frontend Test:** `npm run build:test` riuscita dopo il controllo delle env Test; le configurazioni SDK sono state ricavate dal progetto Firebase Test e il controllo dei bundle JS non ha trovato gli origin/ID Production oggetto della scansione. Generati 64 file statici e Service Worker. La site key è stata impiegata soltanto come environment variable di processo, senza copiarne il valore in documentazione o sorgenti.
- **Firebase Hosting Test live:** deploy CLI `firebase deploy --only hosting --project thelogbook-test --config .firebase.test.local.json --non-interactive` da `ef737f9d`, completato con rilascio sul sito `https://thelogbook-test.web.app`. Smoke HTTP diretto: `/`, `/sw.js` e `/manifest.webmanifest` restituiscono HTTP **200**, con content-type corrispondenti.
- **Vercel Test:** modificata la protezione SSO del **solo progetto backend Test** da `all_except_custom_domains` a `preview` (confermato dal read-back del provider). Questo permette alla PWA di raggiungere gli endpoint del deployment Production *del progetto isolato Test*, mentre le risorse Production reali sono distinte. Smoke HTTP non autenticato: `/backend-only.txt` **200**, `/api/account-deletion` **403**. La sicurezza ora poggia su Origin/CORS, Firebase Auth e App Check nel codice server, non sul login Vercel del browser. Non sono state ridotte le protezioni delle richieste applicative.
- **Non ancora verificato:** dominio Firebase Auth autorizzato, token validi App Check, enforcement live, scambio OIDC/STS con Google Cloud, accesso Firestore con account fittizi, flussi login, offline e sincronizzazione tramite browser. Non dichiarare Test operativo end-to-end fino al superamento di queste prove.

### Verifica candidata successiva — 2026-10-17

- La run [39018100554](https://github.com/gernotfound/logbook/actions/runs/39018100554) sul precedente commit `0cfd7ec40e57ce107d66f6856fe954e86c0f7469` è **fallita** nel solo shard unit/integration 2/2, mentre Playwright, CodeQL, build, Rules e gli altri shard sono riusciti. Il test coinvolto è `tests/tab_validation.test.tsx`, relativa all'avvio tramite shortcut Impostazioni e alla persistenza della scheda Home.
- Analisi e correzione del test sul branch Test: la pagina lazy e la scrittura asincrona delle preferenze venivano asserite prima della stabilizzazione. Le attese sono state rese esplicite con `waitFor`, mantenendo le asserzioni sullo stato e sul valore finale; ripristinato inoltre l'URL di partenza in `beforeEach` per impedire contaminazioni fra scenari. Le 17 regressioni del file sono riuscite in due esecuzioni locali consecutive dopo la correzione. Il nuovo SHA richiede comunque l'intero gate canonico GitHub prima di essere considerato validato.

## Stato osservato e runbook isolato — 2026-10-17

- GitHub `main` osservato allo SHA `df27d56bff4ea2f4081f642f343500cb2dbbb09d` (compresi i nuovi guardrail E2E della PR #418 e l'ottimizzazione del catalogo della PR #416); branch Test `testing/00-firebase-test-critical` tenuto distinto e PR #431 **draft, senza merge**. La sincronizzazione del branch con main e le nuove regressioni richiedono gate CI sul nuovo SHA prima dei prossimi deploy.
- Vercel Test: progetto **`prj_o232EaPmYkrn04zev3Sw9iL2ympj`**, deployment CLI manuale `dpl_B3chKa6BctS5NLJxKaXnhWPjsrZ6` dal commit Test `06b433387ba1f486f2b528a11da02550e4d19d41` allo stato **READY**. Smoke live: statico HTTP 200, preflight CORS dall'origin Test HTTP 204, origin Production rifiutato HTTP 403, endpoint account-deletion senza App Check HTTP 403, cron senza secret HTTP 503. Lo scambio reale Vercel OIDC → Google STS → IAM non è ancora stato dimostrato.
- Vercel Authentication **attiva** sul progetto Test: le richieste autorizzate con `vercel curl` non dimostrano accessibilità dal browser PWA Test. Non pubblicare bypass token in un bundle frontend. La decisione tecnica di esposizione deve mantenere intatti Auth, App Check, CORS e limitazione degli endpoint.
- Firebase CLI con sessione autorizzata ha individuato il progetto `thelogbook-test`, il sito Hosting `thelogbook-test` e la web app `1:1016481853013:web:1dbfcc122026dc757baedc`. Questo non certifica ancora Rules, OAuth, App Check o dati live.
- **Guardrail Hosting/Firestore:** `node scripts/prepare-firebase-test-config.mjs thelogbook-test` genera il file ignorato `.firebase.test.local.json`, derivando il profilo canonico da `firebase.json` ma sostituendo solo `hosting.site` con `thelogbook-test`. Rifiuta qualsiasi project ID diverso, incluso quello Production. Usare sempre `--project thelogbook-test --config .firebase.test.local.json` e `--only` esplicito, dopo CI verde sul commit esatto. Non modificare `.firebaserc` né `firebase.json` Production.
- **Guardrail frontend:** `npm run build:test` controlla la presenza delle quattro env Firebase Web Test, della **site key pubblica** reCAPTCHA Enterprise Test e dell'endpoint backend Test; vieta valori di progetto, Auth, backend o Sentry Production. Prelevare l'API key pubblica dal solo progetto Test con `firebase apps:sdkconfig WEB <app-id-test> --project thelogbook-test`, senza committarla. Usare `VITE_FIREBASE_AUTH_DOMAIN=thelogbook-test.web.app` solo dopo la verifica del dominio autorizzato. La site key Test è stata fornita nella conversazione e non viene riprodotta in questo repository; resta da verificare direttamente l'associazione nel provider e l'acquisizione dei token.
- **Firestore Test distribuito — 2026-10-17:** CI [38980606575](https://github.com/gernotfound/logbook/actions/runs/38980606575) **SUCCESS** su `4f9f0f4dbba1f75654a482fb7c371c3b8ecce6d8`, inclusi Canonical Verification, emulator Rules, Playwright, CodeQL e unit/integration. Dallo stesso SHA pulito è stato eseguito `firebase deploy --only firestore --project thelogbook-test --config .firebase.test.local.json --non-interactive`: CLI **exit 0**, compilazione/rilascio Rules riusciti e indici deployati nel database `(default)`. **Non è una prova di test autorizzativo live** e non comporta alcun deploy Hosting. `main`, PR #431 e risorse Production sono rimasti invariati.
- **Prossimi gate di provider:** verificare il provider App Check, la site key pubblica reCAPTCHA Enterprise Test e l'enforcement, la raggiungibilità del backend dal browser, la federazione OIDC effettiva e le Rules live con dati fittizi; poi deploy Hosting Test e test end-to-end autenticati. Nessuna attivazione indiscriminata di enforcement né scrittura su Production.


## Obiettivo e limiti

Eseguire prove con account e dati esclusivamente fittizi per autenticazione, sincronizzazione, funzionamento offline, revoca del consenso e cancellazione dei dati salute mantenendo l'account (PR #429). La repository e il codice sorgente rimangono `gernotfound/logbook`; l'ambiente di test deve avere risorse, privilegi, credenziali e deployment isolati. Niente operazioni distruttive su utenti o dati Production.

L'allestimento **non** autorizza merge su `main`, modifica delle credenziali Production, modifiche al ruleset, deploy Production o creazione di dati nel progetto Firebase reale. Prima di qualunque test distruttivo, verificare l'identità dell'account e i project ID di tutte le connessioni del frontend e backend.

## Configurazione Firebase Test — comunicata dal product owner

| Elemento | Configurazione riferita | Evidenza / limite |
|---|---|---|
| Progetto | `TheLogBook Test`, ID `thelogbook-test` | Dati in Firebase Console forniti dal product owner |
| Numero progetto | `1016481853013` | Dato fornito dal product owner |
| Ambiente GCP | Non specificato | Nessun effetto sull'isolamento da Production |
| Cloud Firestore | database `(default)`, regione Torino (`europe-west12`) | Confermato dal product owner; API del provider non ancora verificate |
| Firestore Security Rules iniziali | `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }` | Copiate dal product owner; **client read/write negati** finché non si applicano Rules applicative testate |
| Authentication | Metodo Email/Password abilitato | Riferito dal product owner; account fittizi non ancora creati |
| Domini Auth autorizzati | `localhost`, `thelogbook-test.firebaseapp.com`, `thelogbook-test.web.app` | Tabella dalla console fornita dal product owner; nessun dominio Production riportato |
| Web app | `TheLogBook Test Web`; una sola registrazione finale | Un duplicato omonimo è stato eliminato dal product owner |
| Firebase Hosting | `thelogbook-test.web.app`, `thelogbook-test.firebaseapp.com` | Domini predefiniti attivati, nessuna distribuzione della PWA Test attestata |
| Google Cloud reCAPTCHA Enterprise | API abilitata; chiave **Web** `TheLogBook Test - App Check Web` | Screenshot Google Cloud: domini Test configurati, verifica dominio attiva |
| Firebase App Check | Web app registrata con Fraud Defense / reCAPTCHA Enterprise; site key (ID, non secret key) | Screenshot registrazione e successiva conferma correzione chiave dal product owner |
| App Check enforcement | **Non applicato** per Cloud Firestore e Firebase Authentication | Screenshot scheda API di Firebase App Check; mantenere disattivo fino a collaudo token |
| Token TTL App Check | 1 ora mostrata nell'interfaccia prima della registrazione | Controllare valore effettivo nella console se rilevante |

**Chiavi:** non copiare qui né in GitHub API key, site key, secret key reCAPTCHA, chiavi service account, token, password, email degli utenti o fatturazione. Una prima registrazione App Check ha utilizzato per errore la secret key legacy; il product owner ha successivamente riferito di aver sostituito il valore con la site key (ID) corretta. Il token App Check non è stato ancora collaudato su un sito Test pubblicato.

## Vercel Test — in preparazione

- Team selezionato: `gnfcreator`.
- Repository da importare: `gernotfound/logbook` (la stessa di Production, **nessuna seconda repo**).
- Nome del progetto: `thelogbook-test-backend`, ora **applicato e letto dal provider**. Project ID: `prj_o232EaPmYkrn04zev3Sw9iL2ympj`.
- Root Directory prevista: `./` (project root, da verificare nelle Settings); preset applicativo **Other** verificato, Node.js **24.x** verificato.
- **Progetto creato e verificato via connettore 2026-10-16:** Project ID `prj_o232EaPmYkrn04zev3Sw9iL2ympj`, team `gnfcreator`, creato inizialmente come `project-8xnkl` da interfaccia product owner. I tentativi iniziali di lettura con filtro esplicito `teamId` davano 404 e la creazione via connettore era stata rifiutata 403; la lettura con **Project ID senza team scope esplicito** ha successivamente restituito il progetto corretto, con `accountId` corrispondente a `gnfcreator`. L'assistente ha aggiornato via Vercel API il nome in **`thelogbook-test-backend`**, `framework=null` (Other), Node.js 24.x, `previewDeploymentsDisabled=true`, build command `node scripts/prepare-vercel-backend-static.mjs` e output directory `vercel-backend-static`; l'API ha accettato l'aggiornamento. Il read-back successivo ha verificato nome, framework, Node.js 24.x, **nessun deployment** (`latestDeployment=null`, elenco 0). La lettura di `get_git_deployment_context` per il team ha elencato i sette progetti Git già collegati, ma **non** il nuovo progetto Test: alla data della verifica non risulta un collegamento Git al progetto Test. La lettura senza `teamId` ha funzionato; il filtro `teamId` restituiva 404 nonostante il medesimo `accountId`. Alcune opzioni come il flag Preview e gli override build/output non sono esposte nel payload sintetico della lettura e restano da ricontrollare nella schermata Vercel Settings prima di collegare Git.

### Vercel OIDC — evidenza schermata 2026-10-16

Il product owner ha mostrato la pagina *Secure Backend Access with OIDC Federation* del progetto Vercel Test. La selezione **Team (Recommended)** appare già attiva; il pulsante **Save** appare disabilitato (nessun cambio pendente evidente). Claim mostrati nell'interfaccia:

| Claim | Valore mostrato |
|---|---|
| `iss` | `https://oidc.vercel.com/gnfcreator` |
| `aud` | `https://vercel.com/gnfcreator` |
| `sub`, `scope` | `owner:gnfcreator:project:thelogbook-test-backend:environment:production` |

Questa schermata **non equivale ancora a una federazione GCP funzionante**. La parola `production` denota l'environment **del solo progetto Vercel Test**, non il progetto Firebase reale; l'autorizzazione GCP deve vincolare esattamente l'identità di team, progetto Vercel e ambiente per evitare privilegi incrociati. I timestamp `iat`, `nbf`, `exp` mostrati non vengono persistiti nella documentazione perché temporanei. Prossimo passaggio: preparare in `thelogbook-test` un pool/provid­er Workload Identity Federation OIDC Google Cloud con issuer e audience osservati, mappatura `google.subject=assertion.sub`, condizione che limiti al `sub` osservato e permesso `roles/iam.workloadIdentityUser` sul solo service account runtime dedicato. Non creare provider con condizioni generiche né generare chiavi JSON. Prima del deploy servono codice Firebase Admin compatibile OIDC sul branch Test, gate e prova runtime su dati fittizi.

### Provider OIDC Google Cloud — restrizioni verificate tramite screenshot (2026-10-16)

Nel progetto Google Cloud **`thelogbook-test`** il product owner ha creato, tramite console, il pool `logbook-test-vercel` e il provider OIDC `vercel-test-backend` (nome visualizzato `TheLogBook Test Vercel OIDC`). I due screenshot della schermata di modifica del provider **confermano**:

| Controllo | Configurazione osservata |
|---|---|
| Provider | ID `vercel-test-backend`, abilitato |
| Issuer | `https://oidc.vercel.com/gnfcreator` |
| File JWK | Nessun file personalizzato |
| Segmenti di pubblico | **Pubblico predefinito** (non audience personalizzati aperti) |
| Mapping attributi | `google.subject` = `assertion.sub` |
| Condizione CEL | `assertion.sub == 'owner:gnfcreator:project:thelogbook-test-backend:environment:production'` |

L'audience predefinita del provider corrisponde al nome canonico GCP `https://iam.googleapis.com/projects/1016481853013/locations/global/workloadIdentityPools/logbook-test-vercel/providers/vercel-test-backend` (o alla forma `//iam.googleapis.com/...` equivalente supportata). Il runtime Vercel Test dovrà richiedere mediante `getVercelOidcToken({ audience: GCP_AUDIENCE })` **un token OIDC con audience di questo provider**, non usare il token predefinito del team Vercel `https://vercel.com/gnfcreator`.

**Associazione service account — verificata tramite console:** la scheda `Service account connessi` del pool mostra `logbook-test-vercel-runtime` e l'unico filtro `google.subject="owner:gnfcreator:project:thelogbook-test-backend:environment:production"`. Questo prova la configurazione visualizzata dell'impersonazione e del filtro per soggetto esatto, **non** una prova dell'effettivo scambio token STS/impersonation. Le metriche WIF riportavano ancora assenza di scambi osservati. Nessun file JSON di chiave privata è stato creato; il pannello per scaricare la configurazione di credenziali esterne ADC era facoltativo e non è necessario condividere quel file in chat.

**Vincoli successivi prima del primo deploy:** implementare sul branch Test il percorso `Firebase Admin ↔ Google STS` con OIDC e impersonation senza chiave, preservando il comportamento Production; predisporre env pubbliche e server-side solo Test e restrizioni anti-cross-environment, isolare cron e redirect della baseline; eseguire gate canonico/CI sul candidato; collaudare token con il subject/audience attesi e rifiuto dei soggetti diversi, prima di test con account fittizi. Fonti tecniche: [Vercel GCP OIDC](https://vercel.com/docs/oidc/gcp), [Google WIF](https://cloud.google.com/iam/docs/workload-identity-federation).

**Delta remoto `main`:** rispetto al punto di origine del branch, sono intervenuti anche i commit `48bafc1d...` e `7ff77418...`, relativi principalmente a codice/test allenamenti e nutrizione e manifest npm. Sono stati osservati con compare GitHub, non integrati automaticamente nel branch Test. Prima di implementare il backend riesaminare differenze effettive, manifest/lockfile e contratto di deploy; nessuna modifica a `main` è autorizzata senza avvisare il product owner.

### Guardrail necessari prima del primo deploy

1. Il `vercel.json` della baseline imposta `git.deploymentEnabled.main=true` e `**=false`. **Non collegare GitHub prima della verifica dell'identità e delle impostazioni del progetto Vercel Test vuoto.** Scegliere per il backend Test una strategia di deploy manuale e pinned-SHA dal branch `testing/00-firebase-test-critical`, oppure una connessione Git deliberatamente isolata che non distribuisca `main` né ogni push del branch. Verificare nello specifico la compatibilità con il `vercel.json` corrente, il redirect alla PWA reale, il cron giornaliero e il gate canonico: non assumere che il solo cambio di Production Branch sia un isolamento sufficiente.
2. La baseline include `/api/account-deletion-cron` programmato giornalmente e un redirect dalla root all'URL Production: esaminare/neutralizzare entrambi per il Test, **senza** modificare il runtime Production.
3. Provisionare l'identità Firebase Admin **del progetto Test** in Vercel Test, con IAM minimo e App Check replay verification se necessario. Mai riutilizzare le variabili `FIREBASE_ADMIN_*` di Production.

### Google Cloud IAM — inventario riferito tramite screenshot (2026-10-16)

- Nella pagina **Service accounts** del progetto `thelogbook-test`, lo screenshot mostra **una sola identità Firebase Admin SDK predefinita**, abilitata, **senza chiavi** nella colonna apposita. È un inventario della schermata utente, non una lettura IAM via API e non dimostra l'assenza di identità nascoste o ruoli ereditati.
- **Identità dedicata creata, confermata tramite screenshot del product owner (2026-10-16):** `logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com`, visualizzata come **TheLogBook Test Vercel Runtime**, stato **Abilitato**, colonna **ID chiave: Nessuna chiave**. Nella schermata dell'inventario compaiono sia questa identità sia il preesistente account Firebase Admin SDK; nessuna chiave risulta in elenco. Lo screenshot **non dimostra i ruoli IAM effettivi**: la creazione è stata eseguita lasciando vuote le autorizzazioni facoltative, ma servirà verifica separata in IAM.
- **IAM aggiornato, evidenza screenshot del product owner 2026-10-16:** nella scheda `IAM → Consenti`, per `logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com` risultano **assegnati tre ruoli** nel progetto `thelogbook-test`: `Cloud Datastore User` (`roles/datastore.user`), `Firebase App Check Token Verifier` (`roles/firebaseappcheck.tokenVerifier`) e `Firebase Authentication Admin` (`roles/firebaseauth.admin`). La riga dell'identità non mostra Proprietario/Editor o altri ruoli; la schermata non certifica eventuali privilegi ereditati da altre gerarchie o autorizzazioni effettive di endpoint. Verificare il comportamento backend con account fittizio prima di dichiarare funzionante l'accesso.
- **Decisione di sicurezza:** non riutilizzare l'account Firebase Admin SDK predefinito, non concedere Proprietario/Editor, non creare chiavi in questa fase. I ruoli IAM verranno verificati dopo il salvataggio e prima di qualsiasi deploy.
- L'implementazione attuale di `server/accountDeletion/firebaseAdmin.ts` usa `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL` e `FIREBASE_ADMIN_PRIVATE_KEY` tramite `cert()`. **Non generare alcuna chiave privata per ora**: prima valutare provisioning sicuro/possibile identità federata e configurazione Test isolata. Non inserire credenziali nel repository o in chat.

### Accessi per automazioni ChatGPT e GitHub — decisione progettuale (non ancora applicata)

Il product owner desidera che le automazioni e ChatGPT possano amministrare in modo più autonomo **soltanto il progetto Test**. Questo **non equivale** ad allargare i ruoli del service account runtime Vercel: i permessi di un service account non diventano automaticamente accessibili a ChatGPT.

- **Identità runtime** `logbook-test-vercel-runtime`: accesso dati Firestore, Auth e verifica token App Check richiesti dalle Functions Vercel, limitato al progetto `thelogbook-test`. I tre ruoli IAM proposti sono `roles/datastore.user`, `roles/firebaseauth.admin`, `roles/firebaseappcheck.tokenVerifier` (da verificare in IAM prima del deploy).
- **Identità distinta per operazioni automatizzate**, proposta `logbook-test-automation`: provisioning e deployment Test di Firestore Rules/indici, Firebase Hosting e, solo se necessario, account di prova. Ruoli separati per attività e con condizioni sugli ambienti; preferire workload identity federation / identità temporanee e gate su SHA esatto. Concedere permessi amministrativi soltanto per la specifica operazione autorizzata. Non aggiungere Proprietario, Editor, IAM Security Admin, Service Account Key Admin o permessi Production.
- **Accesso interattivo di ChatGPT**: richiede un connettore/app effettivamente disponibile e autenticato con le opportune capacità; non deriva dai ruoli assegnati agli account di servizio. Alla data attuale in questa conversazione non sono stati eseguiti comandi IAM sul provider attraverso ChatGPT; ruoli e accesso diretto non sono ancora verificati.
- **Azioni critiche** come cancellare il progetto, cancellare utenti o dati reali, rimuovere regole protettive o abilitare costi richiedono un confine d'autorizzazione distinto, anche se l'ambiente è Test. Usare esclusivamente dati fittizi per i collaudi E2E.
- **Evidenze**: screenshot del product owner documentano identità, assenza di chiavi e **tre ruoli effettivamente elencati nella schermata IAM**, ma non equivalgono a verifica API né a collaudo runtime. Le fonti normative per i ruoli sono la documentazione IAM Google Cloud e i contratti runtime presenti nel repository; ogni accesso effettivo deve essere provato con richieste Test autorizzate.




4. Definire `PUBLIC_APP_ORIGIN` e origini CORS Test; evitare accessi cross-environment. Tenere separate le env client `VITE_FIREBASE_*`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` e `VITE_ACCOUNT_DELETION_API_ORIGIN`. Verificare CSP, OAuth e domini di origine.
5. Effettuare controlli fail-closed della destinazione prima dei deploy Firestore/Hosting; distribuire Rules e indici Test dal commit verificato, poi frontend Test e backend Test. Nessun workflow Test deve cambiare il workflow o le risorse Production.
6. Collegare il test E2E a UID/account fittizi; simulare offline/revoca/cancellazione e confermare la persistenza dell'account, senza coinvolgere dati utente reali.
7. Tenere separati gate canonico, CI, deploy, smoke HTTP e prove E2E autenticate: non dichiararli completati in assenza di evidenza osservata.

## Gestione GitHub

- Branch dedicato: `testing/00-firebase-test-critical`, creato dal remoto `main` allo SHA `58c41265a40af7e13f11244e54d957b85111aea4`.
- Branch a lunga durata per la **preparazione** dell'ambiente Test, non un branch da fondere automaticamente. `main` può progredire indipendentemente.
- Prima delle modifiche successive, ricontrollare il vero `main` remoto, i delta e le regole di `AGENTS.md` e `.agents/rules/`.
- Proposta di protezione: impedire cancellazione accidentale e force-push, mantenendo normale avanzamento via commit; verificare eventuali vincoli GitHub già presenti e i permessi amministrativi prima di applicarli.
- **Nessuna PR o merge autorizzati** per questa fase di sola infrastruttura Test. Ogni eventuale integrazione in `main` va concordata esplicitamente col product owner.

## Implementazione keyless sul branch Test — candidata, da validare

Lavoro aggiunto su `testing/00-firebase-test-critical`, **non distribuito né integrato in `main`**:

- `server/accountDeletion/testOidcCredential.ts`: il backend recupera con `@vercel/oidc` un OIDC JWT con audience specifica del provider GCP; scambia il token con STS (`sts.googleapis.com`), impersona **solo** l'account `logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com` tramite IAM Credentials e restituisce a Firebase Admin un access token temporaneo. Non salva né richiede chiavi private.
- `server/accountDeletion/firebaseAdmin.ts`: se `FIREBASE_ADMIN_AUTH_MODE=vercel-oidc`, verifica rigorosamente il project ID Firebase Test, email account Test, `VERCEL_PROJECT_ID` Test, ambiente Vercel `production`, flag Vercel e origin frontend `https://thelogbook-test.web.app`; rifiuta la presenza di una chiave Admin privata. **Per i progetti non Test** lascia attivo il percorso `cert()` preesistente e rifiuta auth mode sconosciuti; anche un deployment configurato per il progetto `thelogbook-test` senza OIDC fallisce chiuso.
- `vercel.test.json`: profilo backend-only usabile tramite **`--local-config vercel.test.json`**, con tutti i deploy Git automatici disabilitati, nessun redirect a frontend Production, nessuna schedulazione automatica cron, nessun service worker legacy. Non sostituisce `vercel.json` Production, che resta immutato. Il cron esiste come endpoint da invocare **solo manualmente e con `CRON_SECRET` Test** durante i test controllati.
- `scripts/check-vercel-test-safety.mjs` e `tests/m7_firebase_test_oidc.test.ts`: guardrail su isolamento e regressioni del token exchange, expiry, caching, failure paths.
- `package.json`/`package-lock.json` dichiarano e fissano `@vercel/oidc` e relativi pacchetti. **CI GitHub osservata sullo SHA esatto `84c0dee34a9149dc430e280da6ad03f5cc1f7671`, run [38912861341](https://github.com/gernotfound/logbook/actions/runs/38912861341): SUCCESS**, inclusi installazione npm, sei shard (statico, rules, build/M7–M8, due unit/integration, hardening/stress), Playwright E2E, CodeQL e Canonical Verification. Questo NON collauda il runtime OIDC esterno e NON prova alcun deploy.

### Env Vercel Test verificate direttamente nel provider — 2026-10-16

Nel progetto Vercel Test **`prj_o232EaPmYkrn04zev3Sw9iL2ympj`** sono state create via connettore Vercel quattro variabili **encrypted**, con target esclusivamente `production` dell'ambiente Vercel Test. Il read-back `filter_project_envs` ha confermato l'esistenza delle quattro chiavi e il target (non sono stati stampati né committati valori criptati):

| Chiave | Valore previsto | Ambito |
|---|---|---|
| `FIREBASE_ADMIN_AUTH_MODE` | `vercel-oidc` | Server-only Test |
| `FIREBASE_ADMIN_PROJECT_ID` | `thelogbook-test` | Server-only Test |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | `logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com` | Server-only Test |
| `PUBLIC_APP_ORIGIN` | `https://thelogbook-test.web.app` | Origine CORS Test |

`FIREBASE_ADMIN_PRIVATE_KEY` **non è presente** e non deve essere aggiunta. L'elenco del progetto prima della creazione era vuoto, quello dopo contiene solo queste quattro chiavi. Mancano ancora, per testare il cron manualmente, un `CRON_SECRET` dedicato e tutte le condizioni di deploy/runtime. Non sono presenti deployment al momento del read-back.

### Google Cloud Test: API federazione abilitate — conferma console del product owner (2026-10-16)

Il product owner ha aperto nel progetto `thelogbook-test` le pagine API di Google Cloud e riportato il pulsante **«Gestisci»** per entrambe:

- **IAM Service Account Credentials API** — `iamcredentials.googleapis.com`: riferita come **abilitata** dalla console.
- **Security Token Service API** — `sts.googleapis.com`: riferita come **abilitata** dalla console.

Non è stata eseguita una lettura dello stato enablement via Cloud API da questa conversazione. Il pulsante «Gestisci» è un riscontro sufficiente per procedere a preparare un collaudo, ma **non prova** l'effettivo scambio di credenziali, l'assenza di blocchi org/IAM o l'accesso Firestore/App Check nel runtime.

**Checkpoint storico superato:** il progetto Vercel Test era inizialmente privo di deployment e senza collegamento Git. Il primo deploy manuale, realizzato usando `vercel.test.json` e un commit identificato del branch Test, è documentato nella cronologia in apertura. Il progetto Test rimane scollegato da Git per impedire deployment automatici da `main`; il profilo Vercel Production non deve essere usato. **Blocco ancora reale:** l'accesso dal browser è protetto da Vercel Authentication e lo scambio OIDC con Google Cloud non è stato verificato mediante una richiesta autenticata.

### Prerequisiti storici e controlli permanenti per i deployment Test

1. **GitHub:** verificare il gate canonico sullo SHA esatto del branch dopo le modifiche e correggere eventuali errori senza ridurre i controlli. La CI di default gira su PR verso `main`, push su `main` o `workflow_dispatch`: un semplice commit sul branch Test non significa CI verde.
2. **Vercel Test:** usare esclusivamente il progetto `prj_o232EaPmYkrn04zev3Sw9iL2ympj`. Il progetto è senza collegamento Git; eseguire soltanto un deploy manuale, da un checkout exact-SHA del branch Test e con `--local-config vercel.test.json`. Verificare gli override nella dashboard e disabilitare Preview automatici; **non usare mai il `vercel.json` Production** per il progetto Test.
3. **Variabili server-only Vercel Test:** `FIREBASE_ADMIN_AUTH_MODE=vercel-oidc`, `FIREBASE_ADMIN_PROJECT_ID=thelogbook-test`, `FIREBASE_ADMIN_CLIENT_EMAIL=logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com`, `PUBLIC_APP_ORIGIN=https://thelogbook-test.web.app`; `CRON_SECRET` lungo e generato nel provider, se si provano endpoint di recupero. `FIREBASE_ADMIN_PRIVATE_KEY` **non impostata**. Le env Vercel di sistema `VERCEL`, `VERCEL_ENV` e `VERCEL_PROJECT_ID` devono corrispondere al profilo Test; non sovrascriverle.
4. **Google Cloud Test:** verificare che **IAM Service Account Credentials API** (`iamcredentials.googleapis.com`) e **Security Token Service API** (`sts.googleapis.com`) siano attive in `thelogbook-test`, e la conferma IAM della sola identità `principal://.../subject/owner:gnfcreator:project:thelogbook-test-backend:environment:production`. Non aggiungere privilegi su Production.
5. **Test runtime:** effettuare una richiesta di stato autenticata da un **account fittizio**, osservare la federazione WIF, verificare che i vecchi token/altro progetto Vercel siano rifiutati, quindi testare consensi, salvataggio e cancellazione dati solo nel database Test. La CI, i token validi e i deploy sono evidenze distinte.

## Prossime verifiche

- [ ] Verifica stato/protezioni GitHub del branch dedicato.
- [x] Creazione progetto Vercel Test e primo deployment backend-only manuale; READY, con smoke HTTP fail-closed documentati nella cronologia.
- [ ] Verificare in Vercel Settings la persistenza di `previewDeploymentsDisabled`, Build/Output Settings e Root Directory; successivamente collegare/restringere Git o predisporre deploy manuale exact-SHA, senza distribuire `main`.
- [ ] Verifica API key browser, restrizioni/referrer e registrazione App Check nel progetto Firebase Test.
- [x] Tre ruoli IAM runtime richiesti riportati nella schermata Google Cloud del progetto Test, senza ruoli generali visibili.
- [x] Implementazione e regressioni della federazione OIDC/keyless isolate nel branch Test. **Da verificare ancora:** scambio token e autorizzazioni effettive nel runtime Vercel Test.
- [x] Deploy Rules e indici su Firestore Test dopo gate/emulator; **da verificare ancora** il read-back live e gli accessi con account fittizi.
- [ ] Deploy PWA su Hosting Test con configurazione frontend e CSP separate.
- [ ] Test token App Check senza enforcement, poi valutarne attivazione.
- [ ] Test E2E autenticato su dati fittizi e documentazione dei risultati reali.
