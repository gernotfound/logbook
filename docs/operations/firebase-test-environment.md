# Ambiente di test isolato — TheLogBook

> **Stato:** preparazione in corso, ambiente NON ancora pronto per eseguire E2E.
> **Ambito:** Firebase Test e futuro backend Vercel Test, separati dal runtime Production.
> **Ultimo aggiornamento:** 2026-10-16. Le configurazioni elencate come "riferite" sono state mostrate dal product owner tramite console/screenshot; NON costituiscono verifica diretta via API del provider.

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

### Prerequisiti e verifica prima del primo deploy

1. **GitHub:** verificare il gate canonico sullo SHA esatto del branch dopo le modifiche e correggere eventuali errori senza ridurre i controlli. La CI di default gira su PR verso `main`, push su `main` o `workflow_dispatch`: un semplice commit sul branch Test non significa CI verde.
2. **Vercel Test:** usare esclusivamente il progetto `prj_o232EaPmYkrn04zev3Sw9iL2ympj`. Il progetto è senza collegamento Git; eseguire soltanto un deploy manuale, da un checkout exact-SHA del branch Test e con `--local-config vercel.test.json`. Verificare gli override nella dashboard e disabilitare Preview automatici; **non usare mai il `vercel.json` Production** per il progetto Test.
3. **Variabili server-only Vercel Test:** `FIREBASE_ADMIN_AUTH_MODE=vercel-oidc`, `FIREBASE_ADMIN_PROJECT_ID=thelogbook-test`, `FIREBASE_ADMIN_CLIENT_EMAIL=logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com`, `PUBLIC_APP_ORIGIN=https://thelogbook-test.web.app`; `CRON_SECRET` lungo e generato nel provider, se si provano endpoint di recupero. `FIREBASE_ADMIN_PRIVATE_KEY` **non impostata**. Le env Vercel di sistema `VERCEL`, `VERCEL_ENV` e `VERCEL_PROJECT_ID` devono corrispondere al profilo Test; non sovrascriverle.
4. **Google Cloud Test:** verificare che **IAM Service Account Credentials API** (`iamcredentials.googleapis.com`) e **Security Token Service API** (`sts.googleapis.com`) siano attive in `thelogbook-test`, e la conferma IAM della sola identità `principal://.../subject/owner:gnfcreator:project:thelogbook-test-backend:environment:production`. Non aggiungere privilegi su Production.
5. **Test runtime:** effettuare una richiesta di stato autenticata da un **account fittizio**, osservare la federazione WIF, verificare che i vecchi token/altro progetto Vercel siano rifiutati, quindi testare consensi, salvataggio e cancellazione dati solo nel database Test. La CI, i token validi e i deploy sono evidenze distinte.

## Prossime verifiche

- [ ] Verifica stato/protezioni GitHub del branch dedicato.
- [x] Creazione progetto Vercel Test senza deploy, nome e framework verificati in provider; **nessun deployment** presente.
- [ ] Verificare in Vercel Settings la persistenza di `previewDeploymentsDisabled`, Build/Output Settings e Root Directory; successivamente collegare/restringere Git o predisporre deploy manuale exact-SHA, senza distribuire `main`.
- [ ] Verifica API key browser, restrizioni/referrer e registrazione App Check nel progetto Firebase Test.
- [x] Tre ruoli IAM runtime richiesti riportati nella schermata Google Cloud del progetto Test, senza ruoli generali visibili.
- [ ] Predisporre la federazione OIDC/keyless Vercel → GCP, adattare l'init Firebase Admin solo per il profilo Test con regressioni, poi verificare identità effettiva e permessi nel runtime.
- [ ] Installazione Rules e indici su Firestore Test dopo gate/emulator.
- [ ] Deploy PWA su Hosting Test con configurazione frontend e CSP separate.
- [ ] Test token App Check senza enforcement, poi valutarne attivazione.
- [ ] Test E2E autenticato su dati fittizi e documentazione dei risultati reali.
