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

### Guardrail necessari prima del primo deploy

1. Il `vercel.json` della baseline imposta `git.deploymentEnabled.main=true` e `**=false`. **Non collegare GitHub prima della verifica dell'identità e delle impostazioni del progetto Vercel Test vuoto.** Scegliere per il backend Test una strategia di deploy manuale e pinned-SHA dal branch `testing/00-firebase-test-critical`, oppure una connessione Git deliberatamente isolata che non distribuisca `main` né ogni push del branch. Verificare nello specifico la compatibilità con il `vercel.json` corrente, il redirect alla PWA reale, il cron giornaliero e il gate canonico: non assumere che il solo cambio di Production Branch sia un isolamento sufficiente.
2. La baseline include `/api/account-deletion-cron` programmato giornalmente e un redirect dalla root all'URL Production: esaminare/neutralizzare entrambi per il Test, **senza** modificare il runtime Production.
3. Provisionare l'identità Firebase Admin **del progetto Test** in Vercel Test, con IAM minimo e App Check replay verification se necessario. Mai riutilizzare le variabili `FIREBASE_ADMIN_*` di Production.

### Google Cloud IAM — inventario riferito tramite screenshot (2026-10-16)

- Nella pagina **Service accounts** del progetto `thelogbook-test`, lo screenshot mostra **una sola identità Firebase Admin SDK predefinita**, abilitata, **senza chiavi** nella colonna apposita. È un inventario della schermata utente, non una lettura IAM via API e non dimostra l'assenza di identità nascoste o ruoli ereditati.
- **Decisione di sicurezza:** non riutilizzare l'account predefinito né attribuirgli ruoli aggiuntivi. Predisporre un account di servizio dedicato `logbook-test-vercel-runtime` soltanto in `thelogbook-test`, inizialmente **senza chiavi e senza ruoli assegnati**. I privilegi verranno definiti separatamente sulla base delle operazioni effettive del backend e verificati nel provider (Firestore access, Firebase Authentication, App Check token replay verification).
- L'implementazione attuale di `server/accountDeletion/firebaseAdmin.ts` usa `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL` e `FIREBASE_ADMIN_PRIVATE_KEY` tramite `cert()`. **Non generare alcuna chiave privata per ora**: prima valutare provisioning sicuro/possibile identità federata e configurazione Test isolata. Non inserire credenziali nel repository o in chat.


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

## Prossime verifiche

- [ ] Verifica stato/protezioni GitHub del branch dedicato.
- [x] Creazione progetto Vercel Test senza deploy, nome e framework verificati in provider; **nessun deployment** presente.
- [ ] Verificare in Vercel Settings la persistenza di `previewDeploymentsDisabled`, Build/Output Settings e Root Directory; successivamente collegare/restringere Git o predisporre deploy manuale exact-SHA, senza distribuire `main`.
- [ ] Verifica API key browser, restrizioni/referrer e registrazione App Check nel progetto Firebase Test.
- [ ] Provisioning IAM/Test e credenziali solo nel provider, mai nel repository.
- [ ] Installazione Rules e indici su Firestore Test dopo gate/emulator.
- [ ] Deploy PWA su Hosting Test con configurazione frontend e CSP separate.
- [ ] Test token App Check senza enforcement, poi valutarne attivazione.
- [ ] Test E2E autenticato su dati fittizi e documentazione dei risultati reali.
