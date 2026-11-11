# Registro servizi esterni TheLogBook

> Stato: registro operativo stabile; ricognizione iniziale 2026-10-10. Le sezioni riportano verifiche e decisioni a date differenti: non attestano lo stato live odierno.
>
> Questo file documenta **perché** esistono le integrazioni e quali impostazioni devono essere preservate. Non è un inventario di segreti e non sostituisce la verifica live nelle console dei provider.

## Regole di lettura

- `ACTIVE`: usato dal runtime o dal processo di delivery corrente.
- `LEGACY`: contratto client ritirato; possono restare record o manutenzioni Admin da verificare. Non implica supporto ai client pre-lancio.
- `OPTIONAL`: funzione non essenziale, tipicamente subordinata a consenso o quota.
- `EXTERNAL-ONLY`: configurazione rilevante che vive nella console del provider.
- `VERIFY-LIVE`: il repository non può dimostrarne lo stato attuale.

Il repository è pubblico. Questo registro non contiene token, private key, email personali, ID di credenziali, dati di fatturazione o path locali del maintainer.

I contratti correnti sono governati da [AGENTS](../../AGENTS.md): [Cifratura](../../.agents/rules/secure-storage.md), [Consenso](../../.agents/rules/health-consent.md), [Telemetria](../../.agents/rules/telemetry-and-privacy.md) e [Servizi esterni](../../.agents/rules/external-services.md). Le descrizioni del codice non attestano nomi/valori presenti oggi nel provider; gli inventari datati e le loro vecchie checklist non autorizzano operazioni live.

## Mappa sintetica

| Sistema | Stato | Perché esiste | Fonte operativa |
|---|---|---|---|
| Firebase Authentication | ACTIVE | account email/Google e sessione autenticata | Firebase console + codice Auth |
| Cloud Firestore | ACTIVE | replica/sincronizzazione cloud dei dati account | Firestore/Rules + codice sync |
| Firebase Realtime Database | NON USATO DAL RUNTIME | modulo RTDB e relativa env client ritirati dal contratto | codice |
| Firebase Storage | NON USATO DAL RUNTIME | modulo Storage e relativa env client ritirati dal contratto | codice |
| Firebase Cloud Messaging | NON USATO DAL RUNTIME | modulo Messaging e relativa env client ritirati dal contratto | codice |
| Firebase Hosting | ACTIVE | frontend/PWA Production su `thelogbook.web.app`, deploy exact-SHA da GitHub Actions | Firebase Hosting + workflow Production |
| Firebase/Vercel Test separati | DISMESSI (2026-10-18) | Progetti `thelogbook-test` e `thelogbook-test-backend` eliminati; nessun cloud di test separato attivo | Firebase CLI, inventario Vercel, PR #431 |
| Firebase Admin | ACTIVE | lifecycle account, consenso/diritti, custodia ADK e manutenzione trusted | Vercel env + Vercel Functions |
| Firebase App Check + reCAPTCHA Enterprise / Google Cloud Fraud Defense | ACTIVE | attestazione anti-abuse prima dell'accesso cloud | Firebase App Check + Google Cloud |
| Vercel Functions / Cron | ACTIVE | backend trusted lifecycle, consenso/diritti, chiave cloud, cron e redirect del vecchio root verso Firebase | Vercel + `vercel.json` |
| Vercel Analytics / Speed Insights | RITIRATO | non fanno più parte del frontend Production | codice + cronologia cutover |
| Google Analytics / GA4 | DISMESSO | Nessuna dipendenza runtime; integrazione e preferenza client rimosse, collegamento Firebase sciolto e proprietà dismessa | PR #320 + operazioni Google/Firebase/GitHub confermate dal product owner |
| GitHub Actions / CodeQL / ruleset | ACTIVE | repository pubblico, PR, CI e SAST canonico | GitHub |
| Snyk | OPTIONAL | controllo security supplementare | integrazione Snyk esterna |
| Google Search Console | EXTERNAL-ONLY | verifica proprietà, sitemap e indicizzazione | Search Console + asset SEO repo |

## Dismissione ambiente Test separato — 2026-10-18

Su richiesta del product owner il progetto Firebase/GCP `thelogbook-test` e il progetto Vercel `thelogbook-test-backend` sono stati eliminati. Le verifiche successive hanno rilevato **assenza** del primo nell'inventario Firebase CLI e **zero corrispondenze** del secondo nell'elenco progetti Vercel; Firebase Hosting Test era stato disabilitato (HTTP 404). La [PR #431](https://github.com/gernotfound/logbook/pull/431) è chiusa senza merge e il branch remoto/locale dedicato è stato rimosso. Il codice/configurazione Test di quella PR non è stato portato su `main`.

Sono preservati Firebase Production `logbook-db-98cc4`, Vercel Production `logbook`, i relativi origin e i workflow GitHub Actions. Non si deve ricreare automaticamente un cloud Test né usare Production per stress test, simulazioni distruttive o modifiche a dati reali. Restano disponibili fixture sintetiche, Firebase Emulator, Vitest, Playwright locale e gate canonico; per prove live non distruttive seguire [Collaudi E2E](e2e-reliability.md). La rimozione dei progetti non prova da sola la pulizia di eventuali allowlist/configurazioni esterne di terze parti: verificarle prima di affermarla.

## Firebase Hosting

Firebase Hosting è il provider del frontend/PWA Production di TheLogBook dal cutover verificato del 2026-10-02. Vercel resta esclusivamente backend trusted/cron e redirect del vecchio root.

### Ritiro del Service Worker Vercel legacy — 2026-10-03

**Decisione successiva (30/10/2026, fresh start pre-lancio):** in assenza di installazioni utenti pre-lancio da supportare, la funzione `api/legacy-service-worker.ts`, la relativa rewrite Vercel e il test di ritiro sono ritirati dal codice supportato. Il vecchio root mantiene il redirect verso Firebase; la PWA e il suo Service Worker correnti restano su Firebase Hosting. I paragrafi seguenti documentano esclusivamente le verifiche storiche dell'origin ritirato, non lo stato runtime dopo questo cambiamento. Il deploy Vercel Production e l'eventuale comportamento del vecchio `/sw.js` devono essere verificati separatamente dopo il merge.


Durante lo smoke offline post-cutover è emerso un caso reale su un browser desktop già usato prima della migrazione: la pagina appariva ancora sotto `logbook-gnf.vercel.app` e Firebase Auth/App Check rifiutava correttamente il login perché il vecchio origin era stato rimosso dalle allowlist. La sequenza di errori browser-extension `runtime.lastError/background.js` osservata nello stesso momento è separata dal problema applicativo.

Verifica live del provider prima della correzione: il root Vercel continuava a reindirizzare verso Firebase, ma `https://logbook-gnf.vercel.app/sw.js` rispondeva ancora HTTP 200 con il precedente Workbox Service Worker completo, incluso precache dell'app shell e navigation fallback. Un Service Worker già installato poteva quindi servire la vecchia PWA dalla cache prima che il browser raggiungesse il redirect HTTP.

Il primo tentativo di correzione ha aggiunto una rewrite `/sw.js` verso un worker di ritiro non cacheabile. Il deployment Vercel dello SHA `83a89072989c8ff18b9637decc26b78f1901d82a` è risultato READY, ma la verifica live immediata ha mostrato che `/sw.js` continuava a servire il vecchio bundle Workbox: l'artefatto statico del frontend pubblicato nel deployment aveva precedenza pratica sulla rewrite.

La correzione definitiva separa quindi anche **fisicamente** i due delivery: Vercel sovrascrive il Build Command con `node scripts/prepare-vercel-backend-static.mjs` e pubblica soltanto `vercel-backend-static`, senza eseguire né esporre il build Vite/PWA destinato a Firebase Hosting. La rewrite `/sw.js` può così raggiungere il worker di ritiro, che prende controllo, elimina le cache legacy, si deregistra e naviga le finestre al root 301 verso Firebase. Il vecchio origin **non** viene riaggiunto a Firebase Authentication, App Check, API key, reCAPTCHA

Verifica live post-merge 2026-10-03 sullo SHA `6db65e721dda4a3eb545c03f2ad8d2516a208bf6`: deployment Vercel Production `dpl_EzuP5wdjrJdpF1PUsv9ZyGY8sXbU` in stato READY; `/sw.js` risponde HTTP 200 con il worker di ritiro, `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` e `Service-Worker-Allowed: /`, senza Workbox/precache; un asset del precedente frontend Vercel risponde HTTP 404; il root legacy risponde HTTP 301 verso Firebase Hosting; `/api/account-deletion-device` resta raggiungibile e rifiuta correttamente una sonda priva di origin autorizzata con HTTP 403; nessun runtime error Vercel rilevato nella finestra osservata.

Hardening successivo verificato live il 2026-10-03 sullo SHA `549ab6eaf41c79d649af4b412ceea3f8016faf76`: il deployment Vercel Production `dpl_6V7NzsktWgPZccFLDUey2JbwHWKP` è `READY`; `/sw.js` risponde HTTP 200 con `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`, prende controllo, elimina soltanto le cache `workbox-*`, si deregistra e non contiene navigazione forzata né accessi a IndexedDB/localStorage. Il root legacy resta HTTP 301 verso Firebase Hosting, `/api/account-deletion-device` resta raggiungibile e rifiuta correttamente una sonda senza origin autorizzata con HTTP 403, e non risultano runtime error Vercel nella finestra osservata. Sullo stesso SHA, `Milestone Verification`, `Firebase Hosting Production` e `Firebase Firestore Production` sono conclusi con successo.

Preparazione live verificata il 2026-10-01:

- è stato creato e scelto come hostname target `thelogbook.web.app`;
- il nome pubblico scelto per il progetto/servizio è **TheLogBook**;
- il progetto Firebase deve restare sul piano **Spark**: non è autorizzato il passaggio a Blaze;
- di conseguenza il target futuro non deve dipendere da Cloud Functions for Firebase o Scheduled Functions che richiedano Blaze;
- Vercel può restare come boundary serverless gratuito per Functions/Cron mentre il frontend migra a Firebase Hosting.

Questa preparazione era il checkpoint pre-cutover; il passaggio a Firebase Hosting è stato poi completato e verificato il 2026-10-02 come registrato più avanti.

I domini Firebase predefiniti possono comunque essere presenti nelle configurazioni Auth/OAuth perché appartengono al flusso Firebase Authentication; la loro presenza non dimostra da sola che Firebase Hosting sia Production.

## Firebase Authentication e OAuth

Firebase Authentication è il provider identità del prodotto. TheLogBook supporta autenticazione Google e credenziali email/password.

### Verifica console Authentication — 2026-11-10 (pre-apertura pubblica)

**Evidenza:** schermate della console Firebase Production fornite dal product owner e lette durante l'audit; non sono una prova di collaudo end-to-end o dell'assenza di ulteriori impostazioni fuori dalle viste.

- **Metodi di accesso:** soltanto email/password e Google risultano abilitati. L'opzione *Collega account con lo stesso indirizzo email* è selezionata; Firebase applica regole diverse per indirizzi email verificati e provider attendibili. Resta necessario uno smoke autenticato del collegamento Google ↔ password, compresi conflitti e mantenimento dell'UID.
- **Azioni utenti:** creazione account **abilitata**, eliminazione diretta da Firebase Auth **abilitata**, protezione anti-enumerazione email **abilitata**. **Rischio CRITICAL da valutare prima del rilascio:** un utente può tentare la cancellazione self-service con l'SDK/API Firebase senza passare dal job trusted che elimina prima Firestore e la chiave account, con rischio di residui non più associati a un account Auth. Il codice ordinario cancella l'identità per ultima tramite Admin SDK (`server/accountDeletion/jobStore.ts`), ma il solo percorso UI non impedisce la chiamata diretta. Raccomandata la disabilitazione della *sola* eliminazione self-service Firebase Auth, mantenendo creazione abilitata e cancellazione trusted Admin; **nessuna modifica provider eseguita**. Verificare collaudo controllato del percorso backend e gestione delle richieste dirette prima di applicare una nuova policy.
- **Password:** enforcement server in modalità *Richiedi applicazione*, min 8, max 4096, maiuscola/minuscola/numero/simbolo obbligatori; *Forza l'upgrade all'accesso* non selezionato. Il client usa `validatePassword` ma mantiene anche un baseline statico di 8 caratteri e delle quattro categorie in `src/lib/auth/passwordPolicy.ts`; **non** aggiornare soltanto la console se si adotta una policy più orientata alla lunghezza. Le raccomandazioni NIST SP 800-63B-4 per password a singolo fattore indicano 15 caratteri e nessuna regola di composizione: opportunità di hardening **non ancora decisa né implementata**, da verificare nei moduli UI, collegamento account e test.
- **Domini autorizzati:** `localhost`, `logbook-db-98cc4.firebaseapp.com`, `logbook-db-98cc4.web.app`, `thelogbook.web.app`. Nessun dominio Vercel nella schermata; quelli Firebase predefiniti servono per i flussi Auth e non vanno rimossi per sola pulizia.
- **Quota:** 100 nuove registrazioni/ora/IP, corrispondente al limite documentato Firebase. Non equivale a una protezione generale contro gli abusi o a una quota globale di utenti.
- **SMS:** schermata della policy regioni su *Consenti* senza regioni selezionate; il provider *Telefono* non risulta abilitato. La voce *Fraud Defense per SMS* non è abilitata, ed è distinta dall'attestazione App Check della web app. Nessun cambiamento necessario per l'assenza di login SMS; rivalutare regioni e costi **prima** di un'eventuale attivazione telefonica.
- **Da verificare separatamente:** schede *Funzioni di blocco* e *Logging delle attività utente* non incluse nelle schermate; restrizioni effettive di OAuth/API key e IAM; test reale del backend e verifica dell'assenza di residui dopo cancellazione. Le schermate non attestano uno stato reale degli utenti correnti.


**Aggiornamento operativo del 10/11/2026, ore 16:31 Europe/Rome — conferma del product owner:** dopo avere seguito la procedura manuale e avere riaperto la pagina della console, il titolare ha confermato di aver lasciato **Abilita creazione = attiva** e impostato **Abilita eliminazione = disattiva**. La voce storica «Azioni utenti» qui sopra fotografa lo stato anteriore al cambiamento; la dicitura «nessuna modifica provider eseguita» si riferisce esclusivamente all'audit e alla PR documentale precedente, non al successivo intervento manuale. **Stato evidenza: USER-CONFIRMED / verifica indipendente della configurazione live NON eseguita in questa sessione.** Non sono stati eliminati account né dati reali durante questa verifica. Firebase Auth Admin SDK resta per contratto il percorso di cancellazione dell'identità, dopo il job trusted; l'assenza di prova E2E live non consente di attestare IAM, cron, permessi e totale bonifica dei residui. La PR draft #1008 conserva un controllo preventivo sul codice per evitare l'uso di `deleteUser` client o della REST `accounts:delete` come scorciatoia.


**Collaudo manuale successivo — 10/11/2026 (riferito dal product owner):** dopo avere disattivato la cancellazione self-service di Firebase Auth, il titolare riferisce di avere **creato e cancellato con successo un nuovo account tramite TheLogBook**. Il riscontro fornisce evidenza funzionale del percorso visibile all'utente nel contesto della configurazione applicata, senza richiedere la riattivazione di «Abilita eliminazione». **Stato evidenza: USER-TESTED**, non osservato indipendentemente dall'agente; non sono stati acquisiti UID, dati personali, log server o screenshot di verifica. Il risultato riportato non certifica da solo l'assenza di residui Firestore, la rimozione della chiave cloud, il percorso di recovery/cron né la prevenzione delle chiamate SDK client dirette. Nessuna ulteriore eliminazione Production è stata eseguita dall'agente.


Fonti tecniche: [Firebase — azioni utenti](https://firebase.google.com/docs/auth/users), [Firebase — eliminazione client](https://firebase.google.com/docs/auth/web/manage-users), [Firebase — Admin SDK](https://firebase.google.com/docs/auth/admin/manage-users), [Firebase — quote](https://firebase.google.com/docs/auth/limits), [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).

**Audit provider, 2026-11-08:** il collegamento email/password su un account esistente con protezione anti-enumerazione usa la REST Identity Toolkit `accounts:signUp` con `idToken`; le chiamate REST scritte direttamente dal client non ereditano l'header App Check delle richieste del Firebase SDK. `src/lib/auth/accountEmail.ts` ora acquisisce l'attestazione standard, la include nell'header `X-Firebase-AppCheck` e interrompe l'invio delle credenziali se manca, con test di session fencing. Il controllo del provider live su questo specifico percorso richiede una prova autenticata non distruttiva; l'enforcement registrato il 2026-10-02 non è una verifica live odierna.

Stato live verificato il 2026-10-02 dopo il cutover:

- Firebase Project e Web App hanno display name **TheLogBook**;
- Firebase Authentication → Authorized domains contiene `localhost`, i due domini Firebase predefiniti e `thelogbook.web.app`; il vecchio frontend `logbook-gnf.vercel.app` è stato rimosso;
- email/password è abilitato e Improved Email Privacy è attivo;
- la password policy server è in modalità **ENFORCE**: minimo 8 caratteri, almeno una maiuscola, una minuscola, un numero e un carattere non alfanumerico; `forceUpgradeOnSignin` resta disattivato per non bloccare credenziali preesistenti al solo accesso;
- il default locale Firebase Auth è stato impostato su `it` e il client imposta esplicitamente `auth.languageCode = 'it'` per mantenere coerenti le azioni email avviate dalla PWA;
- il callback delle email action gestite dal template Firebase resta sul dominio Firebase predefinito `firebaseapp.com`: il tentativo di migrazione al site `thelogbook.web.app` è stato rifiutato dal provider con `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`. Per questo il dominio Firebase predefinito resta una dipendenza Auth legittima e non va rimosso dalle allowlist;
- il Web OAuth client era già stato predisposto con origine `https://thelogbook.web.app` e redirect `https://thelogbook.web.app/__/auth/handler`. Verifica live 2026-10-03 del Web OAuth client auto-creato: origini autorizzate presenti `http://localhost`, `http://localhost:5000`, `https://logbook-db-98cc4.firebaseapp.com`, `https://thelogbook.web.app`; redirect autorizzati presenti `https://logbook-db-98cc4.firebaseapp.com/__/auth/handler` e `https://thelogbook.web.app/__/auth/handler`. Nessun origin o redirect Vercel è presente; nessuna modifica OAuth necessaria.

Il precedente dominio GitHub Pages è **ritirato** dal 2026-09-30 e non deve essere reintrodotto salvo nuova dipendenza runtime esplicita.

### Piano password policy NIST — client e provider distinti (2026-11-10)

**Stato:** l'implementazione client è presente nel codice della PR #1009; la versione realmente distribuita su Firebase Hosting va verificata nel provider dopo il merge. L'ultima configurazione Authentication Production **riportata dal product owner il 10/11/2026** è 8–4096 caratteri, tutte e quattro le categorie obbligatorie, enforcement *Richiedi applicazione*, upgrade forzato al login disabilitato; riconfermare questi valori prima del cutover. La PR #1003 (ora integrata) annota indipendentemente quelle schermate e non va reinterpretata come prova di un cutover avvenuto.

- **Nuovo contratto applicativo:** minimo 15 code point Unicode per nuove password in registrazione, cambio password e collegamento email/password a Google; nessuna composizione imposta localmente. Passphrase con spazi e gestori password sono ammessi; il client non modifica, non tronca e non normalizza la stringa fornita. La policy Firebase effettiva determina i vincoli aggiuntivi tramite `validatePassword`; in caso di indisponibilità la mutazione fallisce chiusa con messaggio generico e nessuna credenziale inviata. I rifiuti reali delle API Auth o REST restano decisivi.
- **Transizione sicura, ordine obbligatorio:** (1) verificare gate CI exact-SHA e review richieste del client, **senza** cambiare console; (2) dopo merge e deployment conclusi, verificare che il frontend servito sia quello aggiornato e che registrazione, cambio e collegamento rispettino ancora i requisiti Firebase preesistenti; (3) soltanto allora, in Firebase Console → Authentication → Impostazioni → Password policy, selezionare minimo **15**, massimo **4096**, disattivare i quattro obblighi di categoria, conservare *Richiedi applicazione* e **non** abilitare *Forza upgrade all'accesso*; salvare; (4) rileggere il provider per provare la configurazione e controllare che `validatePassword` restituisca le nuove regole; (5) eseguire smoke controllati su nuovo account di prova, cambio credenziale, collegamento a Google, password reset e login esistente. Il merge del codice e gli eventuali workflow di deployment **non modificano la password policy Authentication**, che resta un'operazione live separata e successiva alla verifica del client.
- **Recupero e login:** l'invio del link di reset non deve rivelare se l'indirizzo esiste e non deve eseguire validazione preventiva della password; la schermata di impostazione password del link Firebase, se ospitata dal provider, non è controllata dal modulo PWA e richiede collaudo separato. Le password esistenti non vengono rifiutate al login dalla nuova soglia client: resta fondamentale mantenere disattivato l'upgrade forzato al login.
- **Controlli:** verificare in modo non distruttivo passphrase senza maiuscole/numeri/simboli, Unicode (code point e conteggio provider), spazi iniziali/finali, autofill/incolla, 15/14 caratteri, 4096/4097 quando praticabile, disservizio policy, race tra prevalidazione e write, email/password e Google. Eventuali differenze di Unicode/limiti tra SDK e backend si risolvono seguendo il rifiuto server, non con una normalizzazione silenziosa del client. Non usare Firebase Production come ambiente di stress test.
- **Limiti del riferimento NIST:** la configurazione di lunghezza e categorie non dimostra l'intera conformità SP 800-63B-4; la verifica di password comuni/compromesse, la limitazione dei tentativi e gli altri controlli lato identity provider richiedono evidenze ulteriori, non deducibili dal client. Non dichiarare il prodotto conforme al NIST per la sola policy.
- **Rollback:** se il cambiamento console causa errori, riportare **temporaneamente** solo la configurazione password provider alla baseline osservata, senza toccare account, dati o enforcement App Check; documentare il read-back. Il client nuovo continuerà a richiedere 15 caratteri e a rispettare le categorie che Firebase ha eventualmente ripristinato. Nessun cambio alla console va effettuato automaticamente dal repository.

Riferimenti: [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html), [Firebase Password Authentication Web](https://firebase.google.com/docs/auth/web/password-auth), [Firebase PasswordPolicy JS](https://firebase.google.com/docs/reference/js/auth.passwordpolicy).

## Google API Browser key

La Firebase Web API key è configurazione client pubblica, non una credenziale Admin. La sua sicurezza dipende anche dalle restrizioni lato Google Cloud.

Stato live verificato il 2026-10-02:

- la chiave browser auto-creata da Firebase è limitata a **Siti web**;
- i referrer correnti sono il dominio Firebase predefinito necessario alle email action Auth e `https://thelogbook.web.app/*`; il vecchio referrer Vercel è stato rimosso;
- le restrizioni API restano l'allowlist Firebase auto-gestita già presente. Non è stata ristretta artificialmente: Firebase documenta la Web API key come configurazione client pubblica e la protezione applicativa resta affidata a Rules, Auth e App Check;
- l'API Keys API di Google Cloud è stata abilitata come control plane per applicare e verificare questa pulizia; non introduce un nuovo servizio runtime della PWA.

### Verifica Web API key, 2026-11-10 (Google Cloud Production)

**Fonte:** tre schermate di *Google Cloud → API e servizi → Credenziali → Browser key (auto created by Firebase)*, viste durante l'audit; gli screenshot non vengono aggiunti al repository pubblico.

- **Inventario:** una *Browser key* auto-creata da Firebase (18/07/2026), un *Web client* OAuth 2.0 auto-creato da Google e i tre service account già registrati nella verifica IAM. Nessun secondo browser key visibile; screenshot non attesta eventuali chiavi eliminate o non visualizzate in altre pagine.
- **Restrizioni applicazione:** opzione *Siti web* selezionata, con **esattamente due referrer visualizzati**: `https://thelogbook.web.app/*` e `logbook-db-98cc4.firebaseapp.com/*` (secondo valore riprodotto come mostrato dalla console). Il vecchio origin Vercel non compare. La nota gialla «Se lasciato vuoto…» è un avviso contestuale generale e **non prova che la lista sia vuota**.
- **Restrizioni API:** elenco di **25 API selezionate**; l'inventario testuale della console contiene *Cloud Datastore API, Cloud Firestore API, Cloud Logging API, Cloud SQL Admin API, Cloud Storage for Firebase API, FCM Registration API, Firebase AI Logic API, Firebase App Check API, Firebase App Distribution API, Firebase App Hosting API, Firebase App Testers API, Firebase Hosting API, Firebase In-App Messaging API, Firebase Installations API, Firebase Management API, Firebase ML API, Firebase Phone Number Verification API, Firebase Realtime Database Management API, Firebase Remote Config API, Firebase Remote Config Realtime API, Firebase Rules API, Firebase SQL Connect API, Identity Toolkit API, ML Kit API, Token Service API*. La chiave **non** risulta senza restrizioni. La lista è più ampia delle API chiamate direttamente dalla PWA attuale, ma è coerente con un allowlist Firebase auto-gestito. **Decisione esplicita del product owner, 10/11/2026: mantenere intatte tutte le 25 API selezionate; non proporne la riduzione come pulizia o hardening.** Eventuali cambiamenti richiedono una nuova decisione di prodotto motivata da evidenze e successivi test di non regressione. Nessuna modifica effettuata nel provider.
- **Sicurezza:** la Firebase Web API key è un identificativo pubblico del progetto, non una credenziale Admin. Le restrizioni per HTTP referrer limitano l'utilizzo previsto della chiave, ma **non sostituiscono** Rules, Authentication, App Check o controlli server. Non riportare nel repository il valore della chiave o il client ID OAuth: non occorrono alla manutenzione di questi contratti.
- **Non ancora verificati in questa schermata:** dettagli di billing/quota, comportamento effettivo dei referrer in ogni browser/SDK e eventuali ulteriori chiavi fuori dalla vista corrente. Origini e redirect del client OAuth web sono stati letti separatamente il 10/11/2026 (sezione successiva).

**Riferimenti:** [Firebase — gestione delle API key](https://firebase.google.com/docs/projects/api-keys), [Google Cloud — restrizioni delle API key](https://cloud.google.com/docs/authentication/api-keys).

### Verifica client OAuth web, 2026-11-10 (Google Auth Platform)

**Fonte:** screenshot della pagina *Google Auth Platform → Client → ID client per Applicazione web* del client auto-creato da Google Service. Data creazione client **18/07/2026**, ultimo utilizzo mostrato **06/11/2026** (metrica con possibile ritardo). Il client secret risulta **Attivato** e visualizzato soltanto in forma mascherata; non è stato letto o salvato. Il client ID completo e i suffissi del secret non vengono duplicati nel registro pubblico.

- **Origini JavaScript autorizzate (4):** `http://localhost`, `http://localhost:5000` (origini di sviluppo Firebase), `https://logbook-db-98cc4.firebaseapp.com` e `https://thelogbook.web.app` (Production). Nessuna origine Vercel nella schermata. La presenza di localhost nel client Firebase generato automaticamente coincide con la guida ufficiale Firebase per i client OAuth web e non è, di per sé, una falla.
- **URI di reindirizzamento autorizzati (2):** `https://logbook-db-98cc4.firebaseapp.com/__/auth/handler` e `https://thelogbook.web.app/__/auth/handler`. Entrambi sono coerenti con il progetto Firebase e il sito Hosting canonico. Gli URI di callback non sono una conferma che ogni login sia stato provato nel runtime.
- **Contratto repository:** `src/lib/firebase.ts` legge `VITE_FIREBASE_AUTH_DOMAIN` dalla configurazione build; il workflow `.github/workflows/firebase-hosting-production.yml` richiede esplicitamente `thelogbook.web.app` per Production. La verifica CI e lo screenshot OAuth attestano aspetti distinti: il confronto con il provider è coerente, ma rimane da eseguire uno smoke effettivo Google Auth con account di prova.
- **Da verificare:** **Branding**, eventuale **Centro verifiche** e comportamento reale del login. La configurazione *Pubblico* e gli ambiti aggiuntivi vengono esaminati nelle sezioni successive. Nessuna modifica al client OAuth eseguita.

Riferimenti: [Firebase Auth — guida client OAuth](https://firebase.google.com/docs/auth/faq-and-troubleshooting), [Firebase Auth — dominio di redirect personalizzato](https://firebase.google.com/docs/auth/web/google-signin).

### Verifica OAuth Pubblico, 2026-11-10 (Google Auth Platform)

**Fonte:** schermata *Google Auth Platform → Pubblico* osservata dal product owner in Production (progetto TheLogBook).

- **Stato di pubblicazione:** **In produzione**. **Tipo di utente:** **Esterno**. Il pulsante *Torna al test* è disponibile ma **non è stato usato**; il progetto non è soggetto alla limitazione degli utenti esplicitamente ammessi nella modalità *In test*.
- **Tetto massimo OAuth indicato:** **0 utenti su 100**. **Non equivale a un limite di 100 account registrabili in TheLogBook.** Google applica questo contatore ai nuovi utenti che tentano di autorizzare **scope OAuth sensibili o con restrizioni non approvati**, quando compare l'avviso di applicazione non verificata; con soli scope di login standard non è un limite generale di login. È una metrica distinta dalle quote Firebase Authentication, dal numero di account attuali e dalle 25 API selezionate della Browser key.
- **Codice corrente:** `src/lib/firebase.ts` crea un `GoogleAuthProvider` con parametro `prompt: 'select_account'`; nella ricerca statica del repository al 10/11/2026 non compare una chiamata `addScope`. Questo è coerente con i normali scope di identificazione Google; la schermata *Accesso ai dati* mostra nessuno scope aggiuntivo, ma lo smoke reale del flusso OAuth resta da eseguire. La pubblicazione Production non equivale alla verifica del brand o all'assenza di avvisi Google.
- **Da verificare:** *Branding / Centro verifiche* (nome mostrato, domini/policy, stato di eventuali richieste di verifica). Nessuna modifica OAuth, consenso o limitazioni eseguita.

Fonte primaria: [Google Cloud — Gestire il pubblico dell'app](https://support.google.com/cloud/answer/15549945), [Google Cloud — app non verificate](https://support.google.com/cloud/answer/7454865), [scope Google Sign-In](https://developers.google.com/identity/protocols/oauth2/scopes).

### Verifica OAuth Accesso ai dati, 2026-11-10 (Google Auth Platform)

**Fonte:** screenshot della pagina *Google Auth Platform → Accesso ai dati* del progetto Production TheLogBook. Le tre tabelle **«I tuoi ambiti non sensibili»**, **«I tuoi ambiti sensibili»** e **«I tuoi ambiti con restrizioni»** indicano tutte **«Nessuna riga da visualizzare»**. Nessuno scope aggiuntivo risulta dunque configurato nell'interfaccia consultata.

- **Interpretazione:** le tabelle vuote **non** dimostrano che il login Google non richieda gli scope di identità standard `openid`, `email` e `profile`. Il codice `src/lib/firebase.ts` usa `GoogleAuthProvider` senza chiamate esplicite `addScope`; questo è coerente con la gestione degli scope di identificazione da parte dell'SDK Firebase. Non inferire una prova runtime dei claim del token dallo screenshot.
- **Sensibili e limitati:** nessun ambito sensibile o con restrizioni aggiuntivo visualizzato, quindi non emergono motivi per avviare una verifica di scope sensibili o richiedere un upgrade. Il contatore 0/100 nella pagina *Pubblico* non è un limite ai login con gli scope di identità standard; il relativo limite scatta per applicazioni con schermata di non verifica legata a scope non approvati. 
- **Controlli successivi:** *Branding*, eventuale *Centro verifiche*, e smoke del login Google per confermare che funzioni senza avvisi indesiderati e senza richieste di autorizzazioni superflue. Nessuna modifica agli scope effettuata.

Riferimenti: [Google — OAuth app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [Google — app non verificate](https://support.google.com/cloud/answer/7454865), [Google — tetto utenti OAuth](https://support.google.com/cloud/answer/15549945).

### Verifica OAuth Branding, 2026-11-10 (Google Auth Platform)

**Fonte Production:** due schermate *Google Auth Platform → Branding* fornite dal product owner il 10/11/2026, senza modifiche salvate o richieste di verifica avviate. La schermata indica: **«Il tuo branding deve essere verificato prima di poter essere mostrato agli utenti»**; pulsante *Verifica del branding* inattivo nello stato osservato. **Non equiparare questo avviso a un fallimento del login Google**: la presenza di credenziali/consensi è distinta dalla presentazione di branding approvato.

- **Nome applicazione OAuth:** `LogBook - Login`, denominazione **obsoleta** rispetto al nome canonico `TheLogBook` in `index.html`, nel manifest e nell'interfaccia; va aggiornato durante la preparazione della verifica.
- **Email per assistenza:** impostata su un indirizzo personale visibile nella console; **non** duplicarla nel repository pubblico. Prima della richiesta di verifica, scegliere/verificare una mailbox di assistenza effettivamente gestita.
- **Logo del consenso:** nessun file caricato (campo opzionale; non creare logo OAuth indipendente senza necessità); se aggiunto, soggetto a revisione del brand.
- **Dominio app / homepage:** campo obbligatorio **vuoto**.
- **Link informativa privacy:** campo obbligatorio **vuoto**.
- **Link termini di servizio:** campo facoltativo **vuoto**, consigliato vista la presenza di Termini nell'app.
- **Domini autorizzati branding:** `logbook-db-98cc4.firebaseapp.com` e `thelogbook.web.app`, coerenti con client OAuth e hosting canonico; non rimuovere.
- **Contatti sviluppatore:** campo email obbligatorio **vuoto** nella schermata.
- **Blocco reale per la verifica del brand:** Google richiede homepage pubblica descrittiva sul dominio verificato, con link alla privacy policy pubblicamente accessibile e coerente con la URL sullo schermo OAuth. Nel repository attuale la Privacy Policy e i Termini sono implementati come **componenti modali** (`src/pages/PrivacyPolicy.tsx`, `src/pages/TermsAndConditions.tsx`), richiamati da Consenso/Impostazioni. `src/App.tsx` per utenti non autenticati mostra `LoginBox` senza pagina pubblica descrittiva; `firebase.json` esegue rewrite generico a `/index.html`. **Non risulta nel codice un routing pubblico dedicato** alle pagine legali da linkare in Google Cloud. Il controllo pubblico con strumento di navigazione web non ha potuto attestare l'esistenza di una pagina legale accessibile senza login, quindi **non usare URL ipotetici** `/privacy` o `/terms` prima del collaudo HTTP e browser. La homepage non deve essere una pagina di solo login per la verifica Google. È una **lacuna di conformità OAuth da risolvere e collaudare prima dell'invio**, non prova di un malfunzionamento delle credenziali.
- **Intervento consigliato, separato da questo audit:** predisporre una semplice pagina introduttiva accessibile pubblicamente e URL permanenti delle informazioni legali su Firebase Hosting, **riutilizzando il contenuto vigente**; allineare denominazione prodotto, link e email di contatto sul provider; verificare possesso del dominio tramite Search Console, accuratezza della policy e test anonimo/desktop/mobile; solo dopo avviare *Verifica del branding* e, se approvata, pubblicare il brand. Non sono necessari nuovi servizi a pagamento. Verificare sempre l'effettivo comportamento Production dopo merge e deploy.
- **Da non fare:** compilare link non raggiungibili, inventare un dominio separato, pubblicare secret OAuth, cambiare login o opzioni del provider durante la sola analisi. La modifica della console e l'invio a Google sono interventi esterni non ancora autorizzati/eseguiti.

Fonti ufficiali: [Google OAuth — policy di brand](https://developers.google.com/identity/verification/authentication-policy-compliance), [requisiti di homepage e Privacy Policy](https://support.google.com/cloud/answer/13464321), [procedura di verifica del branding](https://developers.google.com/identity/verification/authentication-verification).

### Verifica OAuth Centro di verifica, 2026-11-10

**Fonte Production:** screenshot *Google Auth Platform → Centro di verifica* del 10/11/2026; configurazione osservata, nessuna richiesta di verifica o modifica live eseguita.

- **Branding status:** avviso esplicito **«Il tuo branding non viene mostrato agli utenti»**, con rinvio a *Branding* per visualizzare dettagli e procedere alla verifica. **Conferma indipendente della lacuna di branding** già registrata nella sezione precedente. Lo stato non dimostra da solo un errore funzionale nel login Google.
- **Data access status:** **«La verifica non è richiesta perché la tua app non richiede ambiti sensibili o con restrizioni»**. Conferma che l'attuale progetto non necessita della verifica degli scope sensibili/restricted; non aggiungerli durante la correzione del branding.
- **Tracciamento:** [issue #1013](https://github.com/gernotfound/logbook/issues/1013) dedicata a homepage descrittiva e pagine legali pubbliche raggiungibili senza login, nome OAuth canonico `TheLogBook`, contatti/URL reali, verifica del branding Google e smoke login. La [PR #1011](https://github.com/gernotfound/logbook/pull/1011) documenta soltanto l'audit OAuth: **non risolve** l'issue e non rappresenta una verifica approvata.
- **Invarianti:** mantenere **tutte le 25 API** attualmente selezionate nella Firebase Browser key (decisione esplicita product owner); non cambiare OAuth scope, IAM, Production o autenticazione senza lavoro e collaudo separati.

Il vecchio referrer GitHub Pages è **ritirato** dal 2026-09-30.

## Firestore

Firestore è la replica remota per account autenticati, non la persistenza locale primaria. IndexedDB resta il boundary offline-first canonico.

Il runtime non importa Firebase Realtime Database e `VITE_FIREBASE_DATABASE_URL` è stato ritirato dal contratto client; non esistono quindi motivi runtime per allowlist `firebaseio.com` nella CSP.

Analogamente, il runtime non importa Firebase Storage né Firebase Cloud Messaging e le vecchie env `VITE_FIREBASE_STORAGE_BUCKET` / `VITE_FIREBASE_MESSAGING_SENDER_ID` sono state ritirate dal contratto client.

Le raccolte private attuali sono `history_months`, `nutrition_months` e `sync_control`. I job trusted di cancellazione account e cancellazione dati salute rifiutano sottoraccolte inattese, senza considerarle eliminate implicitamente. Non sono più presenti job Admin dedicati alla retention diagnostica pre-lancio. Il 5 novembre 2026 il product owner ha eseguito tre conteggi Firestore `COUNT` senza filtri e con `allDescendants: true` sulle collection group diagnostiche ritirate: tutti hanno restituito zero documenti. La prova manuale è nella issue #809 e vale per l'istante del controllo, non come attestazione permanente dell'intero database; nessun reset generalizzato è stato eseguito.

Verifica live 2026-10-02 del database `(default)`: Firestore Native Standard in regione `europe-west12`, free tier attivo, PITR disabilitato e **delete protection abilitata** per impedire la cancellazione accidentale del database. PITR/backup gestiti non vengono attivati sul piano Spark perché richiedono fatturazione.

Aggiornamento audit Firestore 2026-10-05/06: la configurazione desiderata versionata aggiunge exemption automatic-index wildcard (`fieldPath: '*'`, `indexes: []`) per i collection group `users`, `history_months`, `nutrition_months`, `sync_control` e `global_catalog`, che vengono letti per path/document ID e non richiedono indicizzazione ricorsiva dei payload grandi. Il primo deploy Firebase CLI ha accettato e applicato `firestore.rules`/`firestore.indexes.json`, ma il read-back custom usava erroneamente `ListFields` sul singolo collection group e non costituiva un oracolo valido per le wildcard collection-level. Il verifier corrente usa il boundary amministrativo database-wide `collectionGroups/-/fields` con filtro `indexConfig.usesAncestorConfig=false OR ttlConfig:*`, coerente con il client di deploy Firebase, e mantiene fail-closed la verifica di stato live. Il read-back finale è stato inoltre corretto per la semantica protobuf: `usesAncestorConfig: false` può essere omesso dalla risposta JSON, quindi il verifier usa la stessa sostanza del matching Firebase CLI (risorsa esatta + nessun indice residuo) e rifiuta esplicitamente soltanto l'ereditarietà `usesAncestorConfig: true`.

**Verifica GitHub/Production del 10 novembre 2026 (SHA `1838598f019551e69e96f635f88e1682ab58f9e1`):** [Firebase Firestore Production, run 42796015790](https://github.com/gernotfound/logbook/actions/runs/42796015790) ha completato con successo il controllo autenticato dello stato reale delle Rules e degli indici tramite `scripts/verify-firestore-production.mjs status`, senza necessità di deploy. Il passo separato `verify` è stato correttamente saltato perché il controllo di stato non ha rilevato differenze o indici in convergenza. [Firebase Hosting Production, run 42796094576](https://github.com/gernotfound/logbook/actions/runs/42796094576) ha completato build, deploy e verifica degli asset e delle cache della PWA sullo stesso SHA. Sono prove del provider lette nei workflow, **non** attestazioni di App Check, impostazioni Firebase Authentication, IAM o recuperabilità della KEK. Per quei controlli serve una lettura amministrativa diretta e datata; una verifica storica non li aggiorna automaticamente.

## Firebase Admin e backend trusted

L'inizializzazione Admin richiede `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL` e `FIREBASE_ADMIN_PRIVATE_KEY`. `CRON_SECRET` autentica il cron, mentre `CLOUD_ACCOUNT_KEK_V1` è necessaria al boundary delle chiavi cloud cifrate: non sono requisiti del client Vite o del vault locale offline. Tutti i segreti restano server-only, senza prefisso `VITE_`.

Il server usa la KEK versionata per wrappare le ADK casuali per UID in `user_data_keys/{uid}`, collection server-only. Non derivare chiavi da Firebase Auth; non ruotare/dismettere la KEK senza rewrap verificato e custodia indipendente come definito da [Cifratura](../../.agents/rules/secure-storage.md). La presenza dei nomi nel repository non prova il provisioning o il ripristino nel provider.

Verifica live del 2026-09-30: in Vercel Production risultano presenti `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` e `CRON_SECRET`. I valori non sono registrati qui. Una chiave Admin generata accidentalmente durante la verifica è stata eliminata subito senza essere usata o installata.

**Verifica read-only Vercel del 10 novembre 2026:** `CLOUD_ACCOUNT_KEK_V1` è presente sul progetto `logbook`, target esclusivamente `production`, tipo `sensitive`/visibilità `secret`. I valori non sono stati letti, decifrati, copiati né modificati. Secondo [Vercel (aggiornamento 24 agosto 2026)](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types), le variabili `Secret` restano disponibili al runtime ma **non possono essere rilette dopo il salvataggio**, nemmeno da un amministratore. La loro esistenza non dimostra una copia indipendente della stessa KEK. **Stato della recuperabilità: NON VERIFICATA — blocker operativo prima di utenti esterni.**

Procedura non distruttiva per chiudere il blocker, senza inviare segreti a GitHub, chat o log:

1. Verificare **fuori da Vercel** se la KEK originale identica a quella provisionata è già conservata in un archivio segreto indipendente, accessibile solo ai responsabili autorizzati. La variabile `Secret` di Vercel non può essere usata come sorgente per ricostruirla.
2. Se una copia originale esiste, verificare in un ambiente **isolato e non collegato ai dati Production** che sappia decifrare un envelope di prova **non personale già prodotto con la KEK effettivamente usata in Production**, oppure usare un'altra prova autenticata equivalente di corrispondenza. Un semplice round-trip con un envelope creato dalla sola copia esterna prova il formato, **non** l'identità con la KEK distribuita. Se manca un riferimento attendibile, dichiarare il ripristino non attestato. Registrare soltanto esito, data e custode, mai valore o dump della KEK nel repository.
3. Se la copia originale **non esiste o non è verificabile**, non sostituire, ruotare, eliminare o riprovisionare `CLOUD_ACCOUNT_KEK_V1`: una chiave nuova potrebbe rendere illeggibili tutte le ADK già custodite. Prima di qualsiasi eventuale cutover occorrono verifica diretta dell'assenza di dati/account da preservare, un piano reversibile dove possibile e un'autorizzazione esplicita del product owner. La sola dichiarazione di assenza utenti non è una prova live né un permesso di reset.
4. Mantenere il rilascio pubblico bloccato rispetto alla **recuperabilità certificata** finché l'esito del punto 2 (o una decisione di prodotto dopo un cutover sicuro e verificato) non sia documentato; il funzionamento runtime non prova che esista un backup.

### Verifica IAM Production — 2026-11-10 (parziale)

**Evidenza:** screenshot Google Cloud IAM > Consenti del progetto TheLogBook, con l'opzione *Includi concessioni di ruoli fornite da Google* **non selezionata**. È un inventario dei principal mostrati da quel filtro, **non** una lista esaustiva di tutte le concessioni gestite da Google, dei binding sulle singole risorse o delle condizioni WIF.

- **Proprietario:** un principal umano con ruolo *Owner (Legacy)*. La presenza di un proprietario è attesa, ma non attesta l'assenza di altre identità fuori dal filtro.
- **Identità backend Firebase Admin SDK:** nel progetto risulta `firebase-adminsdk-fbsvc` con *Firebase Admin SDK Administrator Service Agent*, *Firebase App Check Admin*, *Firebase Authentication Admin*, *Firebase Realtime Database Admin*, *Firebase Rules Admin*, *Service Account Token Creator*, *Service Usage Viewer*. Una lettura isolata della env `FIREBASE_ADMIN_CLIENT_EMAIL` su Vercel Production ha confermato che si tratta **della stessa identità**: nessuna private key è stata letta o salvata. Il ruolo *Firebase App Check Admin* include `firebaseappcheck.appCheckTokens.verify`: **non occorre aggiungere un ulteriore ruolo Token Verifier per ottenere quel permesso**. I privilegi di amministrazione App Check/RTDB/Rules e token creator sono più estesi del solo token verifier; qualsiasi riduzione richiede inventario delle dipendenze Firebase e collaudo backend, non è stata eseguita.
- **GitHub Hosting deployer:** `github-firebase-hosting-deploy`, ruoli *Firebase Hosting Admin* e *API Keys Viewer*, coerenti con il contratto repository.
- **GitHub Firestore deployer:** `id-github-firestore-deployer`, ruoli *Firebase Rules Admin*, *Cloud Datastore Index Admin*, *API Keys Viewer* e *Service Usage Viewer*, coerenti con il contratto repository. Le due identità sono separate; i trust binding della federazione WIF non sono verificati da questa schermata.
- **Filtro Google-provided attivato:** nuova schermata Production 2026-11-10 con *Includi concessioni di ruoli fornite da Google* selezionato; compaiono i service agent gestiti da Google: Firebase Rules Service Agent (Firebase Rules Admin, Firebase Rules System, Service Usage Viewer), Firebase Management Service Agent (Firebase Service Management Service Agent), Firebase App Check Service Account (Firebase App Check Service Agent), Cloud Firestore Service Agent (Firestore Service Agent). Le tipologie e i principali ruoli service-agent corrispondono alle identità documentate da Google e **non rappresentano, da sole, concessioni anomale**. Non eliminare service agent né ridurre i loro privilegi senza una verifica tecnica specifica. L'inventario a livello progetto è stato confermato **completo dal product owner il 10/11/2026**: non risultano ulteriori righe sotto quelle mostrate, mantenendo selezionata l'opzione Google-provided. Questa prova non copre concessioni IAM sulle singole risorse, eventuali condizioni, credenziali o binding WIF.
- **Stato delle tre chiavi Admin (schermata dettagli > Chiavi, 10/11/2026):** tutte e tre risultano **Active**; la scadenza appare come **1 gennaio 10000**, rappresentazione pratica di chiavi a durata indefinita. La schermata attesta **stato e metadati**, non l'utilizzo. L'identificazione avverrà tramite le metriche per chiave (scheda *Metriche*): non è stato verificato quale key ID corrisponda alla credenziale Vercel, e l'eventuale uso da altri sistemi non è escluso. **Privacy:** conservare nel repository soltanto numero, stato, date e rischio operativo; non pubblicare ID completi, file JSON, chiavi private, snapshot di segreti, indirizzi personali o valori env. La presenza di più credenziali permanenti amministrative attive aumenta la superficie di attacco, ma **non è una prova di compromissione**. Prima di qualsiasi revoca occorrono inventario degli utilizzatori, metriche/ultima attività, verifica della chiave Production e piano di rollback; nessuna chiave è stata modificata. Google documenta l'uso di *Service account key authentication events* per investigare. [Metriche Google Cloud](https://cloud.google.com/iam/docs/service-account-monitoring).
- **Metriche autenticazione service account, 10/11/2026:** screenshot della scheda *Metriche* di `firebase-adminsdk-fbsvc`, intervallo selezionato **1 ora**; tutti e quattro i grafici (*Utilizzo service account*, *Utilizzo per API*, *Traffico autenticazioni*, *Traffico autenticazioni per chiave*) mostrano **«Nessun dato disponibile per l'intervallo di tempo selezionato»**. **Non** interpretarlo come prova di chiavi inutilizzate, inesistenza di invocazioni backend, né come prova di compromissione. Le metriche IAM possono avere latenza di pubblicazione e hanno conservazione limitata; prossimo controllo non distruttivo: estendere la vista a **30 giorni**, soprattutto sul grafico per chiave, poi verificare l'eventuale ultimo utilizzo attraverso le funzionalità diagnostiche disponibili, senza creare nuove credenziali. Non conservare nel registro ID completi o screenshot delle console. Fonti: [Monitoraggio utilizzo service account e chiavi](https://cloud.google.com/iam/docs/service-account-monitoring), [catalogo metriche Cloud Monitoring](https://cloud.google.com/monitoring/api/metrics_gcp_i_o).
- **Metriche ultimi 30 giorni — 10/11/2026 (Google Cloud IAM > Service account > firebase-adminsdk > Metriche):** finestra visualizzata approssimativamente **11/10–10/11/2026**; i grafici mostrano chiamate API sul service account Admin a **Firebase App Check, Firestore e Identity Toolkit**, e traffico di autenticazione. Nel grafico *Traffico autenticazioni per chiave* compare **una sola serie etichettata con la chiave creata il 20/09/2026**; le chiavi create il 23/08 e il 14/09 **non presentano serie visibili** nella finestra, senza che questo dimostri che siano definitivamente inutilizzate (finestra limitata, possibili accessi saltuari e latenza dati). Il valore della legenda `0/s` è puntuale e **non** azzera lo storico. Il product owner conferma che finora è esistito soltanto un account di prova, poi eliminato: ciò non esclude utilizzi server-side/cron indipendenti dagli utenti Auth. **Ipotesi, non prova:** la chiave del 20/09 potrebbe essere quella impiegata da Vercel; il confronto con la chiave privata conservata come Secret Vercel e l'inventario di eventuali altri utilizzatori **non sono stati eseguiti**. Nessuna chiave revocata, letta, esportata o modificata. Non pubblicare i key ID nel repository; prima di qualsiasi dismissione servono riscontro certo della chiave di produzione, verifica di altri consumatori e piano di recovery.
- **Chiavi service account (schermata IAM > Service account, 2026-11-10):** elenco di **tre** identità utente abilitate: `id-github-firestore-deployer` e `github-firebase-hosting-deploy` mostrano *Nessuna chiave* (coerente, ma non prova da sola la correttezza dei binding WIF); `firebase-adminsdk-fbsvc` mostra **tre ID chiave** con date di creazione 23/08, 14/09 e 20/09/2026. Nessun ID completo né materiale crittografico è stato copiato nel repository. L'account Firebase Admin è quello indicato nella configurazione Vercel; la sua env `FIREBASE_ADMIN_PRIVATE_KEY` esiste come secret, ma non è stato letto il valore né confrontato il suo key ID con i tre visibili. **Rischio da chiarire:** chiavi amministrative permanenti potenzialmente non utilizzate ampliano la superficie di esposizione. La presenza di tre chiavi non dimostra una compromissione o che tutte siano superflue. Individuare la chiave effettivamente usata dal backend e eventuali altri utilizzatori con metadati/metriche, senza leggere né esportare segreti; solo dopo un inventario e uno smoke di non regressione proporre la disabilitazione controllata di quelle inutilizzate, prima di una eventuale eliminazione. Non toccare KEK/ADK (secret distinti) durante questa procedura. [Best practice Google per chiavi service account](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).
- **Verifica accesso alla risorsa service account, 10/11/2026:** nella scheda *Entità con accesso* della risorsa `firebase-adminsdk-fbsvc`, senza includere concessioni Google, sono visibili unicamente l'owner del progetto (*Owner (Legacy)*) e lo stesso service account (*Service Account Token Creator*), entrambi con ereditarietà dal progetto. Attivando *Includi concessioni di ruoli fornite da Google* compare inoltre il *Firebase Management Service Agent*, anch'esso ereditato dal progetto. **Nessuna identità terza inattesa né grant esplicitamente diretto alla risorsa** è visibile in queste schermate; non equiparare questa constatazione alla prova che nessun soggetto possa autenticarsi con una delle tre chiavi attive, impersonare l'account tramite ulteriori binding o gestire la risorsa via altri permessi ereditati. Il ruolo *Service Account Token Creator* sul progetto è ampio: in linea generale consente la creazione di credenziali temporanee per service account nell'ambito coperto dalla concessione; l'eventuale riduzione richiede prima verifica delle dipendenze dell'SDK e del provider, soprattutto delle firme token e delle autorizzazioni ereditate. Una ricerca statica nel repository corrente non ha trovato chiamate dirette a `createCustomToken` o `signJwt`, **ma questo non basta per provare che il ruolo sia superfluo** (SDK e funzioni provider). Non eliminare o ridurre ruoli durante la ricognizione. Fonti: [accesso ai service account](https://cloud.google.com/iam/docs/manage-access-service-accounts), [Token Creator e impersonazione](https://cloud.google.com/iam/docs/service-account-permissions).
- **GitHub Firebase Hosting Deployer, scheda «Entità con accesso» (10/11/2026):** verificata la risorsa `github-firebase-hosting-deploy` con e senza il filtro *Includi concessioni di ruoli fornite da Google*. Sono visibili: il proprietario umano con *Owner (Legacy)* ereditato dal progetto, `firebase-adminsdk-fbsvc` con *Service Account Token Creator* ereditato dal progetto e **un principal GitHub Workload Identity Federation** con ruolo *Workload Identity User* concesso sulla risorsa service account; con il filtro Google compare inoltre il *Firebase Management Service Agent* (concessione ereditata). Il principal WIF è **troncato nel testo dello screenshot** e non permette di certificare il subject, la restrizione a uno specifico repository/branch o le condizioni del provider. Il workflow `.github/workflows/firebase-hosting-production.yml` usa `google-github-actions/auth` con `GCP_WORKLOAD_IDENTITY_PROVIDER` e `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`, richiedendo `main` e SHA corrente: prova del contratto codice, **non** delle attribute condition IAM live. La visibilità del principal WIF è coerente con il disegno keyless, già corroborato da *Nessuna chiave* per il deployer, ma **non basta a dimostrare che il binding non sia troppo ampio**. Non trascrivere nel repository gli identificativi completi del principal federato mostrati in console. Prossimo controllo: la risorsa del *GitHub Firestore Deployer* e successivamente il provider Workload Identity Pool (issuer, mapping, attribute condition e binding delle due identità), esclusivamente in lettura. [Google Cloud WIF](https://cloud.google.com/iam/docs/workload-identity-federation) e [best practice](https://cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).
- **GitHub Firestore Deployer, scheda «Entità con accesso» (10/11/2026):** screenshot della risorsa `id-github-firestore-deployer` con il filtro *Includi concessioni di ruoli fornite da Google* attivo. Sono visibili: owner del progetto con *Owner (Legacy)* ereditato, `firebase-adminsdk-fbsvc` con *Service Account Token Creator* ereditato, un principal GitHub federato con *Workload Identity User* direttamente sulla risorsa, e il *Firebase Management Service Agent* ereditato. Nessun altro principal appare nella tabella fornita. Il pattern risulta coerente con `github-firebase-hosting-deploy`, ma le stringhe dei principal sono **troncate in entrambe le schermate**: **non è dimostrato** che siano la stessa identità, che l'accesso sia limitato allo specifico repo/branch o che non esista una condizione WIF troppo permissiva. `.github/workflows/firebase-firestore-production.yml` usa `google-github-actions/auth` con l'account dedicato e il provider WIF, ma la CI non prova la configurazione IAM live. I due account deployment non mostrano chiavi persistenti nel controllo inventariale precedente. Nessuna concessione IAM è stata modificata. Il prossimo controllo è la pagina **Workload Identity Federation → pool → provider** per issuer, mapping e *attribute condition*, senza copiare i principal completi nel registro pubblico; le condizioni devono limitare il tenant GitHub attendibile e, dove applicabile, il repository/contesto di rilascio. [Google — best practice WIF](https://cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).
- **Provider WIF Google Cloud, lettura UI 10/11/2026:** pool **`github-logbook`**, unico provider visualizzato **`github-actions`** di tipo **OIDC**, entrambi abilitati. Nella vista *Modifica provider* sono osservati i mapping `google.subject ← assertion.sub`, `attribute.repository_id ← assertion.repository_id`, `attribute.repository_owner_id ← assertion.repository_owner_id`; la condizione CEL verifica **sia** il repository ID sia l'owner ID GitHub. Gli ID numerici corrispondono ai valori REST del repository corrente `gernotfound/logbook` e del suo proprietario, verificati in GitHub il 10/11/2026, **senza riportarli qui perché non sono necessari all'operatività del registro**. Il controllo per ID immutabili è coerente con la guida Google e limita l'accesso al repository e al proprietario identificati, ma **la condizione visualizzata non filtra il branch, l'ambiente o uno specifico workflow**. Non dedurre che qualunque branch possa già impersonare il service account: rimangono distinti i binding `roles/iam.workloadIdentityUser` sulle risorse e i permessi `id-token: write` nei workflow GitHub, che vanno verificati nel loro insieme. Il contratto repository limita i workflow Production a `main`, ma non sostituisce una condizione provider sul `ref` se si desidera defense in depth. Miglioramento possibile, **da progettare/testare prima di qualsiasi modifica live**, è aggiungere `assertion.ref == 'refs/heads/main'` o un vincolo equivalente compatibile con le reali attestazioni OIDC degli eventi `workflow_run`; introdurlo senza tale verifica potrebbe interrompere deploy Firebase. Lo screenshot non documenta issuer/audience del provider: completarli prima di dichiarare l'audit WIF concluso. Nessuna modifica alla federazione eseguita. [Google Cloud — WIF per deployment pipeline](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [best practice](https://cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).
- **Provider GitHub OIDC, issuer e audience (schermata 10/11/2026):** sulla schermata *Modifica provider github-actions*, nella sezione *Dettagli sul provider*, l'emittente configurato è `https://token.actions.githubusercontent.com/` e l'opzione *Pubblico predefinito* è selezionata, con URI di audience canonica riferita al provider `github-actions` del pool `github-logbook`; il provider è abilitato. **Conforme alla documentazione Google** per GitHub Actions; non serve impostare una custom audience. La URI esatta contenente il project number non viene duplicata nel registro pubblico, perché la risorsa è identificata dal percorso/ID già documentato e il valore non è necessario al troubleshooting. Le schermate non dimostrano il branch effettivamente presente nei token GitHub di ogni evento: prima di irrigidire la condizione CEL con `assertion.ref` controllare il claim effettivo in esecuzioni CI isolate e l'interazione con gli eventi `workflow_run`; nessuna modifica OIDC eseguita. Fonti: [Google Cloud — WIF deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) e [Best practice su audience e attributi](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).
- **Residui da verificare:** controllare ruoli su singole risorse/service account e relativi binding WIF e verificare runtime App Check limited-use su richiesta autenticata di prova; nessuna modifica IAM autorizzata/eseguita.

Fonti: [ruoli e permessi App Check](https://cloud.google.com/iam/docs/roles-permissions/firebaseappcheck), [App Check backend e token consumabili](https://firebase.google.com/docs/app-check/custom-resource-backend).

## App Check, reCAPTCHA Enterprise e Fraud Defense

TheLogBook usa `ReCaptchaEnterpriseProvider` tramite Firebase App Check per rendere più difficile l'accesso abusivo alle risorse Firebase.

Nella terminologia Google Cloud corrente, reCAPTCHA Enterprise è presentato come funzionalità della piattaforma Google Cloud Fraud Defense. Per TheLogBook questi nomi non indicano due integrazioni applicative separate: il codice usa **App Check + provider reCAPTCHA Enterprise**.

### Verifica console App Check / reCAPTCHA — 2026-11-10

**Evidenza live:** nella console del progetto Production, Cloud Firestore, Firebase Authentication e Realtime Database risultano **Applicato**; le metriche visualizzate Firestore e Authentication riportano 100% di richieste verificate e 0% non verificate. Le percentuali non provano tutti i percorsi runtime o l'assenza di traffico in periodi differenti. La Web App *TheLogBook* è **Registrata** con provider **Fraud Defense (in precedenza reCAPTCHA Enterprise)**. Nella console Google Cloud la chiave sito *TheLogBook Web* risulta *Protetto*, tipo *Website - Score*, con verifica dominio attiva, AMP disattivato e solo `thelogbook.web.app` nell'elenco domini. La schermata non prova IAM, quota disponibile o effettivo consumo di token limited-use sul backend custom.

Nella stessa panoramica Google Cloud si vedevano 247 valutazioni definite *fatturabili* nel mese e una proiezione di 741; **non** sono importi addebitati né una verifica del billing. TTL token, soglia score, configurazione OAuth/API key e ruoli IAM **non** sono stati nuovamente letti in questa verifica: i valori riportati sotto rimangono checkpoint storici finché non riconfermati.

Verifica live aggiornata il 2026-10-02:

- la Web App TheLogBook è registrata in Firebase App Check con provider Fraud Defense/reCAPTCHA Enterprise;
- provider Enterprise configurato con TTL token **3600 s** e soglia score **0,5**;
- enforcement **ENFORCED** su Cloud Firestore, Firebase Authentication/Identity Toolkit e Realtime Database;
- la replay protection dei servizi Firebase gestiti resta OFF; è distinta dal backend custom Vercel, che continua a consumare token App Check limited-use e a rifiutarne il replay;
- la chiave Web **TheLogBook Web** mantiene la verifica dominio attiva, `allowAllDomains=false`, AMP disabilitato e autorizza soltanto `thelogbook.web.app`; il vecchio dominio Vercel è stato rimosso.

Bot/Fraud Defense resta il boundary App Check osservato; Account defense, SMS defense e Transaction defense non fanno parte del runtime TheLogBook salvo futura decisione esplicita e verifica live.

**Verifica 10 novembre 2026:** i run GitHub di Firestore e Hosting attestano Rules/indici e frontend, non lo stato live dell'enforcement App Check su Firestore e Authentication, la configurazione OAuth/Auth, le restrizioni della Browser API key o i ruoli IAM del service account Admin. Nessun accesso amministrativo diretto a tali configurazioni è stato disponibile in questa sessione: restano `VERIFY-LIVE`, non `ENFORCED` nuovamente certificato. Il dato del 2 ottobre è storico. Non modificare Rules, IAM o impostazioni Auth/App Check per tentare di colmare una lacuna puramente osservativa.

L'ID/site key è configurazione client pubblica e non viene duplicato in questo registro; la Secret key reCAPTCHA non deve entrare nel browser né in env `VITE_*`.

Il cutover Vercel alla variabile canonica `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` è stato completato il 2026-09-30. Dopo un redeploy Production è stata rimossa `VITE_RECAPTCHA_V3_SITE_KEY`; un secondo redeploy sullo stesso SHA ha risposto HTTP 200, ha incorporato la site key Enterprise nel bundle e non ha mostrato runtime error. I fallback `VITE_RECAPTCHA_V3_SITE_KEY` e `VITE_RECAPTCHA_SITE_KEY` sono quindi ritirati dal contratto applicativo.

## Vercel backend

Vercel è il boundary **backend trusted Production** di TheLogBook. Il frontend/PWA Production è Firebase Hosting; Vercel ospita le Functions native per account deletion/recovery, revoca sessioni, consenso/esportazione diritti, cancellazione dei soli dati e acquisizione della chiave cloud, oltre al cron e al redirect del vecchio hostname verso `https://thelogbook.web.app/`. Non costituisce un gateway di validazione delle normali write business: il writer cifrato client e le Firestore Rules restano boundary separati.

Il redirect del root legacy deve usare **HTTP 301** esplicito: `vercel.json` usa `statusCode: 301`, così il pre-check dello strumento Search Console **Cambio di indirizzo** vede il codice richiesto da Google. Un redirect temporaneo 307 o il generico `permanent: true` di Vercel, che produce 308, non soddisfano questo contratto operativo specifico. Gli endpoint `/api/*` restano esclusi da questo redirect e continuano a servire il backend trusted.

Il repository abilita l'integrazione Git Vercel soltanto da `main` e impone `framework: null` / Fluid Compute tramite `vercel.json`. I branch di sviluppo non generano Preview Deployment. Dal 2026-10-02 un `ignoreCommand` selettivo evita nuovi deployment Production quando un commit modifica soltanto il frontend Firebase o documentazione non rilevante per il backend; modifiche a `api/`, `server/`, `vercel.json`, dipendenze/runtime o configurazione TypeScript server continuano invece a produrre automaticamente il deployment Vercel. Se il confronto con l'ultimo deployment riuscito non è disponibile o fallisce, il selettore consente il deployment per non lasciare indietro il backend.

Le configurazioni server-only che appartengono al runtime Vercel sono:

- `FIREBASE_ADMIN_PROJECT_ID`;
- `FIREBASE_ADMIN_CLIENT_EMAIL`;
- `FIREBASE_ADMIN_PRIVATE_KEY`;
- `CRON_SECRET`;
- `CLOUD_ACCOUNT_KEK_V1` per la custodia delle ADK;
- `PUBLIC_APP_ORIGIN` per la allowlist dell'origin canonico.

`PUBLIC_APP_LEGACY_ORIGIN` è ritirata dal contratto applicativo post-cutover e non deve essere reintrodotta.

### Hardening anti-abuso Vercel WAF — checkpoint 2026-11-11 (non attivato)

**Problema:** un attore può chiamare ripetutamente le API trusted Vercel, sollecitando verifica App Check/Auth e letture Firestore Admin. Le nuove verifiche server rifiutano gli input invalidi prima dei costi evitabili, ma **non sono un rate limiter distribuito**. Un contatore Firestore per ogni richiesta aggiungerebbe letture e scritture alle quote Spark proprio durante un abuso; non introdurlo senza dati operativi.

**Provider verificato solo in lettura:** il progetto Vercel `logbook` è il backend Production. La richiesta `GET /v1/security/firewall/config/active` del connettore ha restituito **HTTP 404, `Seawall Config not found`**. Questo errore non permette di attestare se una regola WAF sia attiva o meno e **non** autorizza a sovrascrivere integralmente la configurazione con `put_firewall_config`. Nessuna regola live aggiunta, aggiornata o disabilitata.

**Soluzione preferita, soggetta a verifica provider e traffico reale:** Vercel WAF supporta su Hobby **una** regola di rate limiting, algoritmo fixed-window, chiavi IP/JA4, intervallo 10 secondi–10 minuti. Configurare una condizione circoscritta alle route HTTP `/api/*`, **escludendo** `/api/account-deletion-cron` (job schedulato), e valutare esclusione delle richieste `OPTIONS` per non spezzare CORS/preflight. Scegliere soglie partendo dal volume massimo di sincronizzazione, cancellazione e diritti, non da un valore arbitrario, per non bloccare utenti dietro NAT/IP condivisi. Provare prima la condizione con azione `Log` e osservare i match; poi, solo dopo un controllo dei falsi positivi, passare a rate limit con risposta 429 e procedura di rollback. La configurazione WAF si applica al provider indipendentemente dal deploy del branch. Verificare i costi e la quota inclusa prima dell'attivazione: il piano gratuito ha vincoli di utilizzo. Riferimenti: [Vercel WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules).

**Confine di copertura:** Vercel WAF protegge soltanto le richieste verso il backend Vercel: **non** intercetta Firestore SDK diretto dal browser verso Google. Le quote Firestore Spark richiedono App Check enforcement, Firestore Security Rules, limiti di query, osservazione degli utilizzi e gestione del rischio di account autorizzati abusivi. I contatori WAF sono regionali: non sono un limite globale garantito. Nessuno smoke distruttivo o generatore di traffico Production è autorizzato.

**Evidenze visuali 2026-11-11 (screenshot del product owner, sola lettura):** in *Vercel → logbook → Firewall → Overview*, finestra *Past Day*, risultano **Firewall active**, **System Mitigations Active**, **Custom Rules 0**, **Bot Protection Inactive**, **206 Allowed**. Gli indicatori Denied, Challenged, Logged e Rate Limited mostrano un trattino; la sezione Rules dice *There are no enforced rules*. È confermata l'assenza di regole personalizzate nell'istante osservato, non l'assenza delle mitigazioni automatiche né un conteggio numerico per gli indicatori con trattino. Nessun rate limit custom attivato.

**Evidenze visuali Firestore 2026-11-11 (screenshot del product owner):** *Cloud Firestore → Utilizzo*, periodo corrente di quota **11–12 novembre (GMT)**: **443 letture**, **4 scritture**; per le eliminazioni è visualizzato un trattino, non un numero. Entrambi i totali sono molto inferiori alle soglie grafiche *Nessun costo* (letture: 50.000). La console dichiara che include il proprio utilizzo ma esclude import/export e query di aggregazione: questa non è una misura completa di tutte le quote, né dimostra il comportamento futuro. L'enforcement App Check Firestore/Auth rimane documentato con screenshot del 10/11, e non è stato cambiato.

### Verifica Vercel Cron Jobs Production — 2026-11-10

**Evidenza diretta:** screenshot Vercel *Project logbook → Cron Jobs (Legacy)* del 10/11/2026. È registrato un singolo endpoint `/api/account-deletion-cron` in stato **Active**, trigger **At 03:00 AM UTC** (espressione `0 3 * * *` nel `vercel.json` versionato), con *Next Run* mostrato come **7h** al momento della schermata. In Italia sono le 04:00 in inverno (CET) e le 05:00 in estate (CEST). Pulsante **Disable Cron Jobs** visibile e non utilizzato; nessun test manuale o avvio forzato eseguito. I campi *Invocations* e *P75 Duration* visualizzano un trattino: **non attestano né esecuzioni riuscite, né fallite, né l'assenza di invocazioni**. Una query di lettura nei log Production per il percorso negli ultimi due giorni è fallita a livello API senza risultati; non interpretare l'errore come assenza di attività. **Stato della registrazione attivo; funzionamento runtime storico non attestato.**

**Contratto di sicurezza:** `api/account-deletion-cron.ts` espone `GET` e autorizza solo il bearer `CRON_SECRET` confrontandolo con `process.env.CRON_SECRET`; senza secret risponde 503, con credenziale errata 401. Nella lettura metadati Vercel la variabile `CRON_SECRET` è presente come **sensitive**, target **Production**, senza leggere il valore. L'endpoint esegue recupero delle cancellazioni account e attività correlate: NON chiamarlo manualmente per uno smoke non autorizzato, perché può modificare dati reali.

**Evoluzione piattaforma:** nella console compare il badge **Legacy** con avviso che *Cron Jobs are deprecated* e suggerimento di passaggio a *Schedules*. [Vercel annuncia Schedules](https://vercel.com/changelog/vercel-schedules-is-now-in-public-beta) (05/11/2026): è una beta pubblica disponibile anche su Hobby, con quote incluse; la comunicazione indica esplicitamente che i **Cron Jobs esistenti continuano a funzionare**. Non esiste evidenza di una scadenza di spegnimento urgente nel controllo. **Decisione tecnica attuale: mantenere il cron legacy finché non esista una necessità motivata**. Ogni migrazione richiederà verifica di semantica auth, comportamento retry/concorrenza, quota, riduzione del rischio di doppi trigger e prove sul runtime; evitare doppie schedulazioni o modifiche live per il solo badge Legacy.

**Osservazioni Vercel correlate (lettura provider 10/11/2026):** progetto `logbook` Production, ultimo deployment `READY` sul commit `ac6d70a9` nella regione `fra1`; i commit `main` successivi osservati che non modificano backend hanno deployment Vercel `CANCELED` coerenti con `scripts/vercel-ignore-build.mjs`, non un deploy fallito. L'HEAD del repository è una prova diversa dalla revisione effettivamente in esecuzione. Nessuna variabile decrittata o modifica al provider effettuata.

### Follow-up cron Production e limiti di osservabilità — 2026-11-10 (sola lettura)

**Nuove evidenze dopo il merge della PR #1011:** il progetto Vercel `logbook` espone un deployment Production `READY` con Git SHA `27a7f1668f911a2e86e45506d06f7acb5512dbad` (PR #1011 già integrata). La presenza della env `CRON_SECRET` è stata riconfermata nei metadati Vercel come `sensitive`, target Production; nessun valore decrittato o secret acquisito.

- La richiesta dei log runtime Production filtrati per `/api/account-deletion-cron` negli ultimi 2 giorni (08/11 20:09 UTC → 10/11 20:09 UTC) è stata respinta dal provider con HTTP 400: il piano **Hobby conserva soltanto un'ora di Runtime Logs**. [Documentazione ufficiale Vercel](https://vercel.com/docs/logs/runtime). Il rifiuto non equivale ad assenza di esecuzioni.
- La lettura valida nei 45 minuti precedenti (10/11 19:24–20:09 UTC) non ha trovato log corrispondenti: il cron giornaliero è previsto alle 03:00 UTC, quindi questo intervallo non può attestare l'esecuzione programmata. La query aggregata degli errori runtime della route sugli ultimi 7 giorni non ha restituito errori: nemmeno questo prova che il job sia stato invocato o concluso.
- **Contratto applicativo verificato nel codice e nel test `tests/m7_account_deletion_cron.test.ts`:** `GET` può rispondere HTTP 200 anche con errori di una o più fasi interne, perché i worker indipendenti continuano. La prova di un'esecuzione sana richiede oltre allo status HTTP il riepilogo `[account-deletion-cron] completed` e contatori `accountFailed`, `recoveryErrors`, `erasureErrors`, `inactivityErrors`, `retentionErrors` (oltre a `erasureFailed`). I test non certificano le invocazioni Production.
- **Verifica live ancora mancante:** osservare il prossimo trigger naturale **senza avviare manualmente l'endpoint**. Vercel Hobby ha precisione **oraria**, non al minuto: l'espressione `0 3 * * *` può avviare la chiamata tra **03:00 e 03:59 UTC** (04:00–04:59 CET / 05:00–05:59 CEST), non necessariamente alle 03:00 esatte. Consultare `Vercel → logbook → Cron Jobs → View Logs` (o `Logs` con filtro `requestPath:/api/account-deletion-cron`, Production) durante la finestra e immediatamente dopo, quando le invocazioni sono ancora nell'ultima ora di retention; controllare request/status e contatori. Una singola ricerca senza risultati, fatta fuori finestra, non certifica mancata esecuzione. Non pubblicare secret, token, UID o dati personali. [Vercel, accuratezza e log Cron Jobs](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).
- **Contratto di consegna Vercel:** il trigger Cron Jobs è *best effort*: può mancare una consegna o comparire un duplicato, e Vercel **non ritenta automaticamente** un'invocazione fallita. Il runner TheLogBook usa job durabili, lease e recupero alle chiamate successive per gestire questi scenari, ma il comportamento effettivo in Production rimane non attestato. [Vercel, error handling e delivery](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).
- **Rischio residuo (osservabilità, non guasto dimostrato):** la finestra log Hobby più breve della cadenza giornaliera non permette verifiche retrospettive ordinarie del cron. I job di cancellazione persistono stati, lease ed errori riprendibili in Firestore, ma non è stata interrogata la Production Firestore e non è attestato che esistano o meno job pendenti. Non introdurre costi o modifiche al cron/alla schedulazione sulla base di questa sola evidenza.

**Nuovo controllo in sola lettura — 2026-11-11:** nei metadati del progetto Vercel `logbook` risultano 11 variabili visibili, con `hiddenProductionEnvCount=0`, senza richiedere la decrittazione. `CRON_SECRET`, `FIREBASE_ADMIN_PRIVATE_KEY` e `CLOUD_ACCOUNT_KEK_V1` figurano nel target Production. **Non** risultano configurate `ACCOUNT_INACTIVITY_TRACKING_ENABLED` né `ACCOUNT_INACTIVITY_DELETION_ENABLED`: nel codice `api/account-activity.ts` rifiuta la raccolta attività quando il primo flag non è `true` e `api/account-deletion-cron.ts` richiede entrambi i flag `true` per accodare cancellazioni da inattività. **Pertanto il rollout di cancellazione automatica dopo 12 mesi non è attivo in questo deployment** (stato di sicurezza pre-lancio, non un malfunzionamento dimostrato). L'eventuale attivazione richiede decisione e verifiche privacy/runtime separate; non è stata effettuata.

**Nuovo controllo deployment e Request Logs — 2026-11-11:** ultimo deployment backend `READY` rilevato sul commit `a26981f1c9521bf9528fa3cc1f622b585f756d36`; il tentativo automatico relativo al più recente `main` `959ea61fa20df3eb0fb7661bd8e7b9ecc443166b` era `CANCELED` (la presenza dello script di skip non dimostra autonomamente il motivo della singola cancellazione). Screenshot dei Request Logs fornito dal product owner: il 11/11 circa 10:11 CET `/api/cloud-key`, `/api/account-deletion-device` e `/api/health-consent` mostrano risposte 200 e preflight OPTIONS 204; nessuna richiesta cron nella finestra 09:41–10:39 CET, fuori orario di schedulazione. La query aggregata Vercel degli errori runtime non ha restituito errori per le quattro route sensibili selezionate negli ultimi 7 giorni. **Non** sono prove di riuscita del cron, di assenza di errori applicativi interni, o di assenza di job pendenti.

### Inventario env Vercel — checkpoint storico 2026-10-16 (G-21)

**STORICO:** conteggi e procedura sotto appartengono all'inventario del 16 ottobre, precedente al cloud cifrato e al ritiro del worker legacy. Non sono una allowlist corrente per eliminare env: la KEK e gli altri requisiti del backend attuale vanno verificati nel contratto sopra e nel provider prima di qualunque intervento.

Ricognizione diretta dei **soli nomi, target e tipi** delle env del progetto Vercel `logbook` (18 voci); valori e segreti non consultati. Fonte applicativa: `api/`, `server/`, `server/accountDeletion/cors.ts`, `scripts/prepare-vercel-backend-static.mjs`, `vercel.json`, `vite.config.ts` e `.github/workflows/firebase-hosting-production.yml`. L'assenza di riferimenti nel backend è stata confrontata anche con la ricerca del repository. Questa sezione **non attesta rimozioni live**.

| Decisione per Vercel | Variabili nel checkpoint del 16/10/2026 | Motivazione |
| --- | --- | --- |
| **MANTENERE — 5** | `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `CRON_SECRET`, `PUBLIC_APP_ORIGIN` | Credenziali Admin, autenticazione cron e allowlist dell'origin canonico; necessarie a consenso, account deletion e recovery |
| **CANDIDATE ALLA RIMOZIONE — 4, legacy** | `PUBLIC_APP_LEGACY_ORIGIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` | Nessun uso eseguibile nel backend attuale; l'origin legacy è ritirato e Realtime Database/Storage/Messaging non sono parte del runtime client |
| **CANDIDATE ALLA RIMOZIONE SOLO DA VERCEL — 5** | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Configurazione frontend Firebase Hosting, non necessaria al build backend-only Vercel |

**STORICO 2026-10-16:** quattro variabili Firebase Web core risultavano presenti su Vercel Production e Preview, insieme alla configurazione web aggiuntiva su Production. Questo inventario non certifica lo stato attuale del provider: verificare la configurazione live prima di qualunque rimozione. `VITE_ACCOUNT_DELETION_API_ORIGIN` era presente nel contratto frontend GitHub ma non nell'inventario Vercel.

**Procedura necessaria prima di un'eventuale rimozione live, separata da questa PR:**

1. Ricontrollare inventario e `main` correnti, output e build command effettivi del deployment Vercel Production e disponibilità delle configurazioni del workflow Firebase Hosting; non basarsi soltanto sui file o su vecchie build. Confermare che non sia in corso una migrazione/rollback che richieda una ricostruzione storica del frontend su Vercel.
2. Preservare un meccanismo di ripristino **fuori dal repository** per eventuali valori critici senza stamparli nei log o nei report; l'eliminazione delle env dal provider non viene annullata da un revert Git e potrebbe influire sui prossimi deploy.
3. Solo con autorizzazione esplicita per le impostazioni live, rimuovere da Vercel prima le 4 env legacy, quindi le 5 copie frontend, rispettandone gli scope Production/Preview. **Non** toccare le 5 env runtime backend, le repository variables/secrets di GitHub, il provider Firebase o l'autenticazione App Check.
4. Dopo la modifica e al successivo deploy backend legittimo da `main`, controllare gli endpoint consenso, sessioni, cancellazione/recovery e cron con richieste sicure, oltre al redirect HTTP 301 e all'assenza di un Service Worker PWA servito dall'origin Vercel, senza ripristinare il worker di ritiro pre-lancio. Verificare separatamente il successivo workflow Firebase Hosting e l'assenza di richieste diagnostiche; la sola CI verde non prova il comportamento live.

**Stato dell'inventario:** prima di seguire questa procedura, verificare lo stato attuale del provider. La cancellazione live delle env non è rappresentabile da un commit Git.


## Firebase Hosting build configuration

La configurazione pubblica del frontend Production viene fornita al workflow GitHub Actions che costruisce e distribuisce Firebase Hosting, non al runtime Vercel:

- quattro env Firebase Web core: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`;
- `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`;
- `VITE_ACCOUNT_DELETION_API_ORIGIN`, che punta al backend trusted Vercel.

Il workflow Firebase Hosting Production non carica source map a fornitori diagnostici e non abilita monitoraggio errori esterno nel browser.

Realtime Database, Firebase Storage e Cloud Messaging non fanno parte del runtime corrente; le relative vecchie env client sono ritirate. La configurazione Production non viene duplicata in un file `.env.production` versionato; `.env.example` documenta solo il contratto e CI/E2E usa valori sintetici.

## Google Analytics / GA4 — dismesso

Google Analytics 4/Firebase Analytics non è più usato da TheLogBook. La PR #320 ha rimosso SDK, avvio, consenso e toggle GA4, Measurement ID dal build e domini Analytics dalla Content Security Policy. Il product owner ha successivamente confermato lo scollegamento Google Analytics dal progetto Firebase, la dismissione della proprietà Analytics e la rimozione della repository variable `VITE_FIREBASE_MEASUREMENT_ID`.

**Servizi invariati:** Firebase Hosting, Authentication, Firestore e App Check non dipendono da Analytics e rimangono parte dell'architettura. Il monitoraggio errori esterno è stato ritirato successivamente. La configurazione originaria e le decisioni del cutover sono consultabili nella cronologia Git, non nel runbook operativo corrente.

## Vercel Analytics / Speed Insights

Sono ritirati dal frontend Production dopo il cutover Firebase Hosting. Non esiste più alcun consenso GA4 nell'app.

## GitHub, Actions e CodeQL

Il repository è pubblico: questo è un vincolo di sicurezza e privacy, non solo una scelta di collaborazione.

Al consolidamento del 2026-09-30 il ruleset `protect main branch` è attivo sulla default branch e richiede `Canonical Verification`, status check strict, pull request, risoluzione delle review conversation, cronologia lineare e squash merge; non risultano bypass configurati.

CodeQL è parte del gate canonico. Il nome `Canonical Verification` non deve essere cambiato senza verificare ruleset e integrazioni Vercel collegate.

Dependabot è configurato nel repository per controlli settimanali sia delle dipendenze npm sia delle GitHub Actions, con massimo 10 PR aperte per ciascun ecosistema. È automazione di manutenzione, non un bypass: le sue PR devono attraversare gli stessi guardrail di `main`.

## Snyk

Snyk è un controllo security **supplementare**, non la fonte canonica della decisione di merge.

Il repository contiene `.snyk`, che esclude test/test files dalla relativa analisi. Non esiste un workflow Snyk nel repository corrente: l'eventuale check deriva dall'integrazione esterna.

Limiti quota o indisponibilità Snyk non devono eliminare la copertura SAST bloccante, che resta affidata a CodeQL nel `Canonical Verification`.

**Snyk GitHub PR checks (2026-10-15):** il product owner ha disattivato nell'interfaccia Snyk `Pull request status checks → Code analysis` a seguito di `code/snyk` in errore `Code test limit reached` (quota Snyk Code), mantenendo abilitato `Open Source security and licenses`. Sulla nuova PR #420 il primo controllo GitHub dello SHA `99e000152b7cf06b16ff2e5dfd3f358044020ad5` mostrava soltanto `security/snyk (gernotfound)` in esecuzione, senza un nuovo `code/snyk`; assenza osservata al momento della lettura, non attestazione perpetua della configurazione live. Il controllo bloccante CodeQL dentro `Canonical Verification` non cambia.

## Google Search Console e indicizzazione

La precedente proprietà Search Console corrisponde al vecchio frontend Vercel. Il canonical Production è `https://thelogbook.web.app/` e la relativa proprietà URL-prefix è stata verificata il 2026-10-02 con lo stesso account Google usato per la proprietà legacy.

Il repository mantiene deliberatamente:

- meta tag di verifica Google in `index.html`;
- file statico di verifica Google sotto `public/`;
- `public/robots.txt` con crawling consentito e riferimento alla sitemap;
- `public/sitemap.xml` con URL canonico Production.

Verifica live 2026-10-02: homepage, `robots.txt` e `sitemap.xml` rispondono HTTP 200; la homepage espone canonical autoreferenziale `https://thelogbook.web.app/`; la sitemap `https://thelogbook.web.app/sitemap.xml` è stata inviata tramite Search Console API con 0 warning e 0 errori iniziali.

Aggiornamento 2026-10-03: la URL Inspection della homepage `https://thelogbook.web.app/` riporta `Submitted and indexed`, fetch riuscito e indicizzazione consentita. Nella proprietà legacy `https://logbook-gnf.vercel.app/`, il product owner ha completato dalla UI Search Console la procedura **Cambio di indirizzo** verso `https://thelogbook.web.app/`; la UI conferma che lo spostamento è in corso con data di inizio 3 ottobre 2026. Il redirect HTTP 301 dal vecchio root Vercel al nuovo canonical resta intenzionalmente attivo durante la migrazione.

Non rimuovere i meccanismi di verifica solo perché la proprietà è già stata accettata. Mantenere la proprietà legacy e il redirect 301 per l'intera finestra di migrazione Search Console e monitorare l'indicizzazione del nuovo origin prima di qualsiasi rimozione definitiva.

## GitHub Pages — hosting ritirato

GitHub Pages non è più un hosting TheLogBook.

Audit repository 2026-09-30:

- nessun hostname GitHub Pages è referenziato dal runtime/config corrente;
- non esiste workflow `gh-pages`/Pages né branch `gh-pages`;
- GitHub API riporta `has_pages: false`;
- GitHub Pages non partecipa alla Production; il frontend Production corrente è Firebase Hosting;
- il vecchio test auto-contenuto di base path dinamico `/logbook/` è stato rimosso perché non esercitava la configurazione reale; il contratto PWA corrente verifica `start_url` e `scope` alla radice `/`.

Pulizia esterna completata/verificata il 2026-09-30:
- il vecchio dominio GitHub Pages è stato rimosso da Firebase Authentication → Authorized domains;
- il vecchio referrer GitHub Pages è stato rimosso dalla Browser API key;
- il Web OAuth client descritto non riportava GitHub Pages;
- la Web key reCAPTCHA Enterprise/Fraud Defense manteneva attiva la verifica dominio; dal 2026-10-01 autorizzava il vecchio frontend Vercel e `thelogbook.web.app` in preparazione al cutover. Il vecchio dominio resta una pulizia esterna post-cutover.

## Checklist annuale

1. verificare domini Firebase Auth;
2. verificare restrizioni Browser API key e OAuth origins/redirect;
3. verificare App Check e dominio/key reCAPTCHA Enterprise;
4. verificare env Vercel per nome/scope senza esportarne i valori;
5. verificare cron e Functions;
6. verificare GitHub ruleset/required check;
7. verificare che il frontend non effettui richieste automatiche di monitoraggio errori esterno;
8. verificare Snyk come supplementare e CodeQL come gate;
9. verificare Search Console, sitemap, robots e canonical Production URL;
10. rimuovere origin, chiavi e integrazioni legacy non più necessarie.


## Preparazione live cutover — 2026-10-02 (storico)

Questa sezione conserva le operazioni e verifiche esterne eseguite **prima** della PR #191. Le frasi al presente descrivono esclusivamente quel checkpoint storico; anche `Cutover Production verificato` è una prova del 2 ottobre. Lo stato odierno richiede lettura del repository e del provider competenti, non un rinvio a un altro checkpoint datato.

### Firebase / Google Cloud

- Firebase Hosting: site ID `thelogbook`, dominio target `https://thelogbook.web.app`, progetto ancora su piano **Spark** e nessuna release Hosting presente al momento della verifica.
- Firestore: creati e portati a stato **Abilitato** i due indici compositi di `account_deletions` richiesti dal candidato: `status ASC + retryable ASC` e `status ASC + purgeAfter ASC`.
- Firebase Authentication: `thelogbook.web.app` è presente negli Authorized domains; il dominio Vercel corrente resta temporaneamente autorizzato per cutover/rollback.
- OAuth Web client: verificati origine JavaScript `https://thelogbook.web.app` e redirect `https://thelogbook.web.app/__/auth/handler`; mantenuti i valori Firebase preesistenti.
- Browser API key Firebase: restrizione applicazione su **Siti web**; referrer verificati per Vercel corrente, `thelogbook.web.app` e dominio Firebase necessario al flusso Auth. Le restrizioni API restano esplicite e non sono state ristrette durante il cutover.
- App Check / reCAPTCHA Enterprise: chiave **TheLogBook Web**, verifica dominio attiva, AMP disabilitato, domini autorizzati Vercel + `thelogbook.web.app`. Firestore e Authentication risultavano 100% verificati / 0% non verificati in modalità monitoraggio; enforcement non attivato.
- Il service account Firebase Admin usato dal backend Vercel dispone già del permesso effettivo `firebaseappcheck.appCheckTokens.verify` tramite il ruolo Firebase App Check Admin; non è stato aggiunto un ruolo ridondante durante questa preparazione.

### GitHub Actions / Workload Identity Federation

- Creato Workload Identity Pool `github-logbook` e provider OIDC `github-actions` con issuer GitHub Actions.
- Mapping provider: `google.subject <- assertion.sub`, `attribute.repository_id <- assertion.repository_id`, `attribute.repository_owner_id <- assertion.repository_owner_id`.
- La condition del provider vincola gli ID immutabili del repository e dell'owner di `gernotfound/logbook`; l'impersonation dei deployer è concessa tramite `roles/iam.workloadIdentityUser` al principal del repository, non al pool intero.
- Il deploy Firebase Hosting usa un service account dedicato, senza chiavi private JSON, referenziato dalla repository variable `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`; i privilegi progetto restano limitati a Firebase Hosting Admin e API Keys Viewer. Il workflow `Firebase Hosting Production` usa questa identità solo per `firebase deploy --only hosting`.
- Il deploy Firestore Production usa un secondo service account dedicato e separato, anch'esso senza chiavi private JSON, referenziato dalla repository variable `GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT`; i privilegi progetto sono limitati a Firebase Rules Admin, Cloud Datastore Index Admin, API Keys Viewer e Service Usage Viewer. Il workflow `Firebase Firestore Production` usa questa identità solo per Rules e indici Firestore.
- Entrambi i workflow condividono soltanto il riferimento al provider OIDC tramite `GCP_WORKLOAD_IDENTITY_PROVIDER`; le due variabili service-account non sono duplicati e non sono intercambiabili.
- Configurate le repository variables richieste dal workflow Firebase Hosting: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_ACCOUNT_DELETION_API_ORIGIN`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
- Configurata inoltre la repository variable `GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT` per il workflow Firestore Production.
- Preflight read-only Hosting eseguito da GitHub Actions il 2026-10-02: autenticazione OIDC/WIF riuscita con il service account dedicato e lettura del sito Hosting `thelogbook` riuscita tramite Firebase CLI.
- Verifica live Firestore Production del 2026-10-03: l'impersonation WIF del deployer Firestore è riuscita; il preflight ha letto Rules e indici, Firebase CLI ha verificato l'API Firestore tramite Service Usage Viewer, ha applicato `firestore.rules` e `firestore.indexes.json`, e il read-back finale ha confermato Rules live allineate alla sorgente e i 2 indici compositi `account_deletions` in stato `READY`.

### Vercel backend

- La Production Vercel verificata resta READY sullo SHA corrente di `main`; non è stato effettuato alcun redeploy per la sola modifica delle env e non risultavano runtime error nelle 24 ore osservate.
- Confermata la presenza delle env server-only Firebase Admin e `CRON_SECRET` senza esporne i valori.
- Durante la finestra di cutover erano state configurate `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` e la temporanea `PUBLIC_APP_LEGACY_ORIGIN=https://logbook-gnf.vercel.app`. Il supporto applicativo al legacy origin è stato poi ritirato dopo gli smoke verdi.

## Cutover Production verificato — 2026-10-02

- PR #191 squash-merged; `main` reale dopo il merge: `edf164e3e410a650d1390b9cbe92344fa1fb9501`.
- `Milestone Verification` post-merge #1123 / run `36992742404`: success; `Canonical Verification`, CodeQL, Rules, E2E, build/M7-M8, hardening/stress e unit/integration verdi sullo SHA di `main`.
- Workflow `Firebase Hosting Production` run `36992998590`: success sullo stesso SHA, WIF riuscita, build Production completata e deploy limitato a Hosting.
- Firebase Hosting ha rilasciato il site `thelogbook`; smoke automatico HTTP verde su app shell e `sw.js`, entrambi con cache policy no-cache/no-store/must-revalidate, e canonical `https://thelogbook.web.app/`.
- Vercel Production deployment `dpl_GBkkFGbvLczGmBjVe7MV9A4ssKTu` è READY sullo stesso SHA. Il root Vercel reindirizza al nuovo frontend Firebase; gli endpoint account-deletion restano serverless Vercel.
- Smoke browser reale eseguito dal product owner: il popup Google mostra `thelogbook.web.app` e il login completa correttamente entrando nell'account.
- Nei log Vercel successivi allo smoke, `/api/account-deletion-device` ha risposto con 200 alle richieste applicative e 204 ai preflight; le sonde senza origin autorizzata hanno prodotto 403. Questo verifica il boundary CORS del nuovo origin e il percorso di registrazione recovery autenticato/App Check limited-use.
- Nessun runtime error Vercel è emerso nella finestra post-cutover osservata.
- Le segnalazioni Chrome `runtime.lastError` / `background.js` osservate durante il login non corrispondono a file del repository TheLogBook e sono compatibili con messaggistica di estensioni browser. Gli avvisi Firebase Auth `Cross-Origin-Opener-Policy ... window.closed` sono stati osservati con login riuscito; il frontend non configura un header COOP globale e non viene introdotto un workaround che potrebbe alterare il popup OAuth.
- Pulizia Firebase/Google Cloud del 2026-10-02: vecchio origin Vercel rimosso da Firebase Auth Authorized domains, Browser API key e reCAPTCHA Enterprise; App Check portato in enforcement. Completamento post-cutover 2026-10-03: Web OAuth client verificato senza origin/redirect Vercel e Search Console configurata con proprietà Firebase indicizzata e Cambio di indirizzo avviato dal legacy origin. Il callback email Auth resta deliberatamente sul dominio Firebase predefinito finché il provider rifiuta il cambio con `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`.

## Archivio decisionale — candidato PR #191

Questa sezione conserva il razionale del candidato PR #191 ormai mergiato. Il frontend/PWA Production è `https://thelogbook.web.app`, Firebase resta Spark e Hosting serve esclusivamente asset statici; nessuna Cloud Function, Scheduled Function, Cloud Scheduler o Cloud Run è richiesta dal runtime.

Vercel resta il boundary trusted server-only: `/api/account-deletion`, `/api/account-deletion-device` e il cron giornaliero `/api/account-deletion-cron`. Il frontend usa un origin Vercel esplicito e il backend accetta CORS soltanto dall'origin pubblico configurato (`PUBLIC_APP_ORIGIN`, fallback `https://thelogbook.web.app`), con App Check e autenticazione/credential specifica per il flusso.

Google Analytics 4 e Vercel Analytics/Speed Insights sono dismessi e non appartengono alle integrazioni runtime correnti. Le decisioni originarie del cutover restano disponibili nella storia Git.

### Checklist pre-cutover storica

- confermare che Firebase resti Spark e che il site ID `thelogbook` punti al progetto atteso;
- configurare sul build frontend le env pubbliche necessarie, incluso `VITE_FIREBASE_AUTH_DOMAIN=thelogbook.web.app`, origin backend Vercel;
- verificare che Vercel applichi `framework: null` (preset Other/backend-only) e `fluid: true` dal repository, così non resta dipendente dal preset Vite del frontend e le Functions conservano il runtime atteso; configurare su Vercel `PUBLIC_APP_ORIGIN=https://thelogbook.web.app` senza esporre secret al client; durante la sola finestra di cutover/rollback usare anche `PUBLIC_APP_LEGACY_ORIGIN=https://logbook-gnf.vercel.app`, da rimuovere dopo smoke verdi;
- predisporre Workload Identity Federation per il workflow `Firebase Hosting Production`, vincolando l'impersonation al repository `gernotfound/logbook`; al deployer Hosting servono `roles/firebasehosting.admin` e `roles/serviceusage.apiKeysViewer`, senza ruoli Functions/Cloud Run/Firestore; nessun deploy da PR/branch e nessuna nuova chiave privata JSON se WIF è disponibile;
- eseguire il deploy Hosting soltanto dallo SHA `main` già passato da Canonical Verification; il workflow post-gate ricontrolla che lo SHA sia ancora l'attuale `origin/main` e deploya esclusivamente Hosting;
- verificare `roles/firebaseappcheck.tokenVerifier` sul service account Firebase Admin di Vercel, quindi verificare che possa consumare token App Check limited-use e che un token già consumato venga rifiutato; quindi verificare Auth popup/redirect, App Check, CORS, assenza di GA4, PWA/offline e account deletion multi-device sul runtime reale;
- aggiornare Search Console per il nuovo origin senza rimuovere prematuramente la verifica della Production precedente.

Le voci effettivamente concluse sono registrate nella sezione `Cutover Production verificato — 2026-10-02`; le configurazioni esterne non ancora riesaminate dopo il cutover restano esplicitamente indicate come cleanup pendente.
