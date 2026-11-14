# CI Verification — contratto canonico corrente

**Quando leggere:** gate canonico, check richiesti, exact-SHA, sicurezza workflow e deployment derivati da CI.
**Non inferire:** subset verde o run precedente non certificano il candidato attuale né Production.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Eccezione provider transitoria confermata dall'owner — 12/11/2026

La CI canonica, CodeQL, il `Main Release Gate` e la riconciliazione Firestore **rimangono obbligatori**. Il proprietario ha dichiarato disabilitato tramite GitHub UI il workflow di deploy `Firebase Hosting Production` e ha fornito l'output CLI che conferma `firebase hosting:disable --site thelogbook`. Le regole tecniche sul workflow Hosting riportate sotto descrivono i contratti da preservare **qualora sia deliberatamente riabilitato**, non un'autorizzazione al suo rilancio. **Decisione del proprietario 14/11/2026:** solo il frontend Static Assets può essere pubblicato su `thelogbook.me` come ambiente di sviluppo pubblico. Il workflow Cloudflare è only-main, ammette anche la sequenza automatica dopo la riconciliazione Firestore riuscita sull'HEAD esatto (o dispatch manuale exact-SHA) e deve verificare comunque build, SHA, accesso HTTP e assenza di pubblicazioni `workers.dev`/preview. Non autorizza le API Cloudflare Auth/D1, OAuth/posta Production, dati reali, costi o la dichiarazione di rilascio funzionale completo. Lo stato `disabled_manually` di GitHub e lo stato live Cloudflare sono verifiche provider distinte da CI e documentazione.

**Contratto smoke Cloudflare:** una temporanea propagazione edge può richiedere retry finiti, mai successo fittizio. HTML, SW, manifest, sitemap e file hash devono corrispondere ai byte del build dello SHA esatto. `robots.txt` può contenere esclusivamente il prefisso gestito da Cloudflare Bot Preference Sync, riconoscibile e limitato, seguito dall'intero file applicativo invariato; ogni altra difformità fallisce. La CI deve eseguire test positivi e negativi sul verificatore usato dal workflow. Il deploy verde non certifica Auth, sync, privacy o UX browser.

## Scope

Questa regola disciplina il gate canonico di verifica automatica corrente dopo M8. Le milestone M0–M8 restano composte transitivamente nel comando repository; GitHub Actions può distribuire i leaf command equivalenti su runner indipendenti senza ridurre la copertura.

Gerarchia corrente:

- **workflow GitHub Actions:** `Milestone Verification` (`.github/workflows/verification.yml`): suite completa sulle PR, attestazione dell'integrazione + CodeQL sui push a `main`;
- **check aggregato stabile della PR:** `Canonical Verification`; dopo lo squash merge il check di rilascio è `Main Release Gate` sul nuovo SHA di `main`;
- **analisi SAST richiesta:** job `Security / CodeQL` su JavaScript/TypeScript con query `security-extended`, aggregato dentro `Canonical Verification`;
- **comando repository umbrella:** `npm run verify:m8`;
- **orchestrazione CI:** tre shard Vitest generalisti, shard per coverage diagnostica e altri leaf exact-SHA + matrice E2E di otto shard exact-SHA, quattro per progetto browser su container Playwright ufficiali, verificati da `scripts/check-ci-contract.mjs`.

La parallelizzazione riguarda l'orchestrazione, non la semantica del gate **sulle PR**. Unit, integration, isolated, fuzz, recovery, GC, hardening, stress, Firestore Rules emulator, Playwright, build e controlli M7/M8 restano obbligatori sullo SHA candidato prima del merge. Il push di `main` riutilizza tali verifiche solo quando `scripts/verify-main-release.mjs` dimostra l'identità esatta del tree PR → squash commit, della base e della CI trusted già completata prima del merge; una prova incompleta fallisce chiusa. CodeQL viene eseguito anche sul branch predefinito.

**MUST:** le suite Node di `tests/isolated/**/*.test.ts` girano con `vitest.isolated.config.ts`; le suite React `tests/isolated/**/*.test.tsx` girano con il runner Vitest standard in `jsdom`, inclusi i suoi setup Auth/storage. Escludere l'intera directory `tests/isolated/**` dal runner standard lascerebbe i test TSX presenti ma mai eseguiti, senza fallire la CI. Ogni nuova suite va verificata anche per discovery reale del runner.

## Avvio locale diagnostico

Solo quando il lavoro locale è disponibile e autorizzato: leggere `package.json`, `.node-version` e i workflow per Node/npm e Java richiesti dall'Emulator; eseguire `npm ci`, predisporre `.env` da `.env.example` con configurazione locale appropriata e avviare con `npm run dev`. Non copiare credenziali Production o secret server nel bundle client, né avviare le suite contro i provider reali. Il setup/dev server non costituisce validazione: il gate finale resta `verify:m8` o CI equivalente sullo SHA esatto.

## Limiti del mandato

Il gate verifica il candidato del branch; non autorizza merge o deploy. Se l'utente richiede soltanto aggiornamenti sul branch, mantenere la PR draft e auto-merge disabilitato dopo le verifiche, come prescritto da AGENTS. Il bump previsto per la CI non prova prenotazione della prossima versione: un futuro avanzamento di main richiede riallineamento e nuova validazione.

## Exact HEAD

- MUST: il bump minor applicativo richiesto per ogni integrazione in `main` deve essere incluso **prima** della verifica candidata; ogni merge concorrente richiede nuovo calcolo della versione, nuovo SHA e nuova validazione.
- MUST: `test:version-bump` prova senza riscritture che la versione del candidato incrementi esattamente di uno il minor della base Git della PR, **eccetto la transizione di prodotto una tantum da major 1 a versione 2.0.0 autorizzata per il cutover cloud cifrato** (`github.event.pull_request.base.sha`), con patch zero e due campi root coerenti in `package-lock.json`. Sui push `main` usa il commit genitore; in locale usa il merge-base con `origin/main` quando possibile. Le regressioni negative sono obbligatorie nel leaf di `verify:m8` e della CI. Dopo un merge concorrente ricalcolare la versione e riverificare il nuovo SHA.
- MUST: non creare workflow che riscrivano automaticamente commit dopo il gate. Un eventuale controllo automatico della versione deve essere read-only e confrontare la base Git appropriata.

- MUST: ogni shard che esegue codice della PR fa checkout esplicito di `github.event.pull_request.head.sha`, non del merge ref sintetico.
- MUST: in ogni shard, prima dei test, `git rev-parse HEAD` viene confrontato con lo SHA atteso; una divergenza termina lo shard.
- MUST: nel job container E2E, la verifica usa `git -c safe.directory="$GITHUB_WORKSPACE" rev-parse HEAD` per gestire il mount del workspace senza modificare globalmente la trust policy Git; il confronto con lo SHA atteso resta identico.
- MUST: tutti gli shard della stessa run verificano lo stesso exact SHA.
- MUST: anche il job CodeQL fa checkout e verifica esplicita dello stesso exact SHA prima dell'analisi.
- MUST: ogni report di validazione indica lo SHA esatto realmente verificato.
- MUST: ogni revisione indipendente citata come evidenza si riferisce allo stesso SHA candidato o dichiara esplicitamente una baseline diversa.

## Clean worktree

- MUST: `verify:m8` include transitivamente `verify:m7` → `verify:m6` → `test:repo-hygiene`.
- MUST: la CI parallela include lo stesso `test:repo-hygiene` tra i leaf command obbligatori.
- MUST: modifiche tracciate o file non tracciati non ignorati presenti prima della verifica rendono il risultato non autorevole e fanno fallire il gate.
- MUST: i file testuali controllati dal gate sono UTF-8 valido senza BOM.
- MUST: `test:repo-hygiene` verifica anche i collegamenti interni relativi nei Markdown tracciati; un target locale mancante o un path che esce dal repository blocca la CI. I link web esterni e i frammenti/anchor non costituiscono prova live e sono esclusi da questo controllo.
- MUST: il gate non riscrive automaticamente file malformati.

### Repository documentation hygiene

- MUST: i file task-specific `implementation_plan*.md` sono artefatti di lavoro del branch e devono essere rimossi prima della validazione finale e del merge.
- MUST: report generati task-specific come `audit_logbook_*.md`, `remediation_logbook_*.md` e le directory legacy `audit-report/` o `docs/ai/` non devono essere tracciati nel candidato finale.
- MUST: le istruzioni normative correnti vivono in `AGENTS.md` e `.agents/rules/`; le guide operative stabili vivono in `docs/`; gli audit storici deliberatamente conservati vivono in `docs/audits/`.
- NOTE: cronologia Git e discussioni PR preservano piano, evidenze e report di uno specifico task; copie obsolete in `main` non sono fonte di verità operativa.

## Single source of truth

- MUST: `npm run verify:m8` resta il comando repository umbrella e continua a comporre integralmente `verify:m7`, quindi M6/M5 e i gate precedenti richiesti.
- MUST: GitHub Actions può appiattire quella composizione tra matrice di shard e job E2E dedicato soltanto se `test:ci-contract` prova meccanicamente che il multiset complessivo dei leaf command è equivalente all'espansione corrente di `verify:m8`.
- MUST: gli shard non invocano umbrella `verify:mN` seriali; eseguono leaf command per ottenere parallelismo reale.
- MUST: `test:install-scripts` confronta i pacchetti con lifecycle script nel lockfile con un elenco di versioni esplicitamente approvate. La matrice CI e Hosting verificano anche il lockfile prima di `npm ci`; `allowScripts` in `package.json` non disabilita automaticamente gli script di npm.
- MUST: `test:ci-production-secrets` rifiuta la reintroduzione di configurazioni di monitoraggio esterno nel workflow Hosting e verifica la separazione delle identità WIF dedicate ai due workflow Production. Questi controlli statici non dimostrano i ruoli IAM live.
- MUST: la CI e i workflow Firebase Production controllano la major npm 11.x effettiva. `packageManager` nel manifest è una dichiarazione di versione, non prova che il runner usi quella versione esatta: non aggiungere installazioni globali non lockate. Il workflow Hosting non usa segreti per upload di diagnostica o source map esterne.
- NOTE: il job core genera e conserva per 30 giorni un SBOM CycloneDX dello SHA della PR, senza attribuire a questo inventario una firma o provenance del deployment.
- MUST: `npm audit --audit-level=high` e `test:security-static` (Gitleaks + zizmor) restano bloccanti nella CI ma non appartengono alla semantica deterministica di `verify:m8`, perché dipendono da registry/release esterni.
- MUST: `test:typecheck-coverage` confronta tutti i file `.ts`, `.tsx`, `.mts` e `.cts` tracciati da Git (incluse le dichiarazioni), oltre ai moduli `cloudflare/**/*.mjs`, con i file effettivamente inclusi rispettivamente nei progetti `tsconfig.m5-tests.json`, `tsconfig.m7-server.json` e `tsconfig.cloudflare.json`, usando `tsc --listFilesOnly` della versione TypeScript risolta dal lockfile. Il progetto Cloudflare abilita `allowJs` e `checkJs` senza emettere output; Il nuovo leaf `test:typecheck:cloudflare` esegue il progetto JS Cloudflare, aggiunto a `verify:m7` e alla matrice GitHub; `test:typecheck:m7` conserva il suo contratto storico. Il controllo JavaScript non dimostra la correttezza dei binding Workers/D1 live né tipizza completamente i parametri senza annotazioni JSDoc. Un nuovo file fuori da entrambi o una modifica alle configurazioni che riduce la copertura fa fallire `verify:m8` e il job canonico CI. La stessa verifica esegue regressioni su repository Git temporanei.
- MUST: `test:dead-code` è un leaf deterministico e bloccante di `verify:m8`: Knip verifica `files,dependencies,unlisted,exports,types`, inclusi export e tipi inutilizzati. Solo eventuali analisi separate dal gate (per esempio `analyze:dead-exports`) restano advisory.
- MUST: `lint:a11y` blocca sulle regole JSX accessibility ad alta confidenza e `lint:type-aware` applica `typescript/no-floating-promises`.
- MUST: `lint:baseline` confronta l'identità dei warning correnti (suite, file, regola, messaggio e riga sorgente) con `config/lint-warning-baseline.json`; warning nuovi, sostituiti o rimossi fanno fallire il gate finché il delta non viene revisionato esplicitamente e la baseline non viene rigenerata. Un semplice limite numerico non è sufficiente perché può nascondere la sostituzione di warning benigni con warning critici.
- MUST: `test:quality-guardrails` confronta lo SHA della PR con `github.event.pull_request.base.sha` (o `HEAD^` nei push su main) usando storia Git completa. La baseline può soltanto diminuire per identità e molteplicità: nuovi warning e sostituzioni con conteggio invariato bloccano la PR anche dopo `lint:baseline:update`.
- MUST: il gate previene anche downgrade delle regole/configurazioni lint (incluse categorie implicite, eccezioni nuove e opzioni delle regole esistenti), disattivazioni dei controlli TypeScript (incluso `noCheck`), esclusioni dei file JS/TS tracciati tramite `.gitignore`, altri ignore file, configurazioni Oxlint annidate o nuovi nomi che Oxlint ignora automaticamente come minificati, rimozione di leaf preesistenti di `verify:m8` e nuove direttive di soppressione anche inline e nei sorgenti alla radice. La CI esegue le regressioni negative del gate e il suo controllo main-relative nello shard statico; `test:ci-contract` tutela la composizione del comando canonico.
- MUST: la baseline dei warning può descrivere solo debito già esistente e revisionato; un aggiornamento della baseline è consentito per **rimuovere** warning, non per accettarne altri. Nei path di persistenza non si aggiunge `void` meccanicamente alle Promise per far sparire `no-floating-promises`.
- NOTE: i gate versionati nel repository non possono essere immuni da una modifica deliberata simultanea del checker e del workflow; il ruleset GitHub e una review delle modifiche ai gate restano protezioni distinte.
- MUST: M8 aggiunge test Domain Operations V4 e il boundary checker che impedisce nuovi consumer UI/hook snapshot-based fuori dall'allowlist documentata.
- MUST: workflow temporanei di migrazione non devono esistere nell'HEAD candidato.
- MUST: workflow legacy che duplicano test/E2E non restano attivi in parallelo.

## Parallelizzazione e isolamento

- MUST: la matrice usa `fail-fast: false` per raccogliere l'esito di tutti gli shard dello stesso SHA.
- MUST: Java viene installato solo nello shard Firestore Rules salvo nuova dipendenza documentata.
- MUST: Chromium e il WebKit mirato per Mobile Safari vengono forniti esclusivamente dalla matrice E2E dedicata, con quattro shard per progetto (`--project=chromium` e `--project=mobile-safari`, ciascuno `--shard=1/4`…`4/4`) e `fail-fast: false`, tramite l'immagine ufficiale `mcr.microsoft.com/playwright:vX.Y.Z-noble`; la versione `X.Y.Z` MUST coincidere con `node_modules/@playwright/test` risolto in `package-lock.json`. Il job E2E non esegue `playwright install --with-deps` sul runner host e usa `--ipc=host`; i test PWA/Service Worker restano Chromium-only e WebKit esegue soltanto suite esplicitamente selezionate.
- MUST: suite intenzionalmente single-worker, incluse recovery/fuzz/GC/hardening dove configurato, mantengono i propri limiti interni; la CI parallelizza tra suite, non forza concorrenza dentro scenari che richiedono isolamento.
- MUST: la suite Vitest standard può essere divisa per file con `--shard=i/N` soltanto se tutti gli indici `1..N` sono presenti esattamente una volta e il CI contract ricompone gli shard nell'unico leaf canonico `npm run test` (attualmente tre).
- MUST: il checker `test:discovery` confronta i file test tracciati con la selezione reale di ogni runner Vitest/Node e dei singoli progetti/shard Playwright; file orfani e doppie assegnazioni inattese falliscono il gate. `test:coverage:critical` produce dati diagnostici da una selezione documentata di test per i boundary Auth, sync/storage, consenso e cancellazione, senza soglie arbitrarie e senza sostituire i test Emulator/E2E.
- MUST: il runner Vitest generale, quando avviato tramite `npm run test`, esclude i file dedicati a `test:m7` e `test:m8` e l'intera cartella `tests/hardening/`, già coperta da `test:hardening`; il runner `npm run test:isolated` delega `m8_domain_commit` a `test:m8`. I comandi eseguibili canonici non cambiano, il partizionamento avviene nella discovery basata su `npm_lifecycle_event`; un `vitest run` diagnostico diretto mantiene la discovery ordinaria. L'unione dei runner deve coprire ogni file almeno una volta e non eseguire quelli dedicati due volte.
- MUST: il contract PWA M7 che legge `dist/` deve essere eseguito nello stesso shard che produce il build richiesto, oppure ricevere artefatti verificati dello stesso exact SHA.
- SHOULD: gli shard vanno bilanciati usando durate osservate in GitHub Actions; evitare micro-shard il cui overhead di setup supera il beneficio.

## Workflow security

- MUST: usare `pull_request`, mai `pull_request_target`, per eseguire codice della PR.
- MUST: gli shard di verifica mantengono `permissions: contents: read`.
- MUST: il solo job CodeQL può aggiungere `security-events: write`, limitato al caricamento dei risultati di code scanning; non estendere tale permesso agli shard applicativi.
- MUST: nessun secret production è richiesto dal gate repository.
- MUST: tutte le GitHub Actions di terze parti usate dal workflow canonico sono pin-nate a commit SHA completi e immutabili; il commento di versione serve alla manutenzione/Dependabot, non alla risoluzione runtime. I checkout impostano `persist-credentials: false` per non lasciare il token Git nel workspace.
- MUST: l'immagine container Playwright usa un tag di versione esatto, mai `latest`, e `test:ci-contract` impedisce drift tra immagine e lockfile.
- MUST: i test M7 server continuano a mockare Firebase Admin.
- MUST: il runner E2E usa esclusivamente configurazione Firebase dummy/test.
- MUST: `FIREBASE_ADMIN_*` e `CRON_SECRET` restano configurazione runtime e non fixture CI.

## Trigger

- MUST: il workflow parte per PR verso `main`.
- MUST: il workflow parte sui push a `main`, con `Main Release Gate` read-only e CodeQL, senza ripetere shard/E2E già attestati sulla PR. Il Release Gate deve verificare commit single-parent, una sola PR merge associata, target e base SHA, identità del tree candidato/`main`, check `Canonical Verification` del run trusted GitHub sullo SHA della PR e `main` ancora corrente. Se manca una prova, il deployment non procede.
- MUST NOT: branch milestone ritirati, incluso `feat/m8-domain-operations-v4`, restano trigger push del workflow canonico.
- SHOULD: run obsolete della stessa PR/ref vengono cancellate tramite `concurrency`.

## Domain Operations contract

- MUST: i valori e le baseline delle quattro versioni persistite hanno fonte in `src/lib/schemaEvolution.ts`; ogni cambiamento richiede evoluzione esplicita e verifiche dei boundary interessati, non il solo bump PWA.
- MUST: `DomainOperation` è un layer di intento locale, non un nuovo protocollo persistito.
- MUST: ordinary UI/hook mutations attraversano `dispatchDomainOperation()` salvo boundary bulk esplicitamente allowlisted da `.agents/rules/domain-operations.md`.
- MUST: business state e `SemanticOperation` generate vengono rese durevoli nello stesso update IndexedDB.
- MUST: il compiler opera su projection scope dichiarate dall'intento e riusa il protocollo `SemanticOperation` validato.
- MUST: ID assenti/duplicati e reorder incompleti falliscono; non degradano in snapshot array atomici.
- MUST: test di equivalenza dimostrano reducer business ↔ replay semantico per le famiglie principali.

Il checker automatico M8 protegge direttamente i consumer sotto `src/hooks` e `src/components`; non va interpretato come blanket exemption per nuovi consumer snapshot introdotti altrove. Nuovi boundary interni richiedono classificazione architetturale contro la regola canonica Domain Operations.

## M7 contract preservato

- MUST: `vite.config.ts` resta una configurazione Vite/PWA; Nitro e Workflow non fanno parte dell'architettura corrente.
- MUST: le Functions native account deletion mantengono il limite configurato e il recovery cron documentato.
- MUST: il contract PWA M7 continua a verificare service worker e manifest.
- MUST: eventuali modifiche future a `firestore.rules` richiedono test pertinenti e deploy Rules esplicito; il gate repository corrente usa l'emulator e **non** effettua il deploy delle Rules.

## Semantica del failure

Ogni shard esegue il proprio comando con:

```bash
set -o pipefail
${{ matrix.command }} 2>&1 | tee "verification-${{ matrix.id }}.log"
```

`pipefail` preserva il codice di uscita non-zero del leaf chain; `2>&1` unisce stdout e stderr nel log. La matrice generale e gli otto job E2E non usano `continue-on-error`; un risultato E2E `success` richiede il successo di tutti gli shard. Ogni shard conserva un artefatto distinto con indice e SHA. Il job `Canonical Verification` **sulle PR** usa `needs: shards`, `needs: e2e` e `needs: codeql` e fallisce se uno qualunque dei tre risultati non è `success`. Sui push a `main`, la verifica distinta `Main Release Gate` attesta le prove della PR senza eseguire né dichiarare rieseguiti quei test; CodeQL controlla nuovamente il branch predefinito.

- MUST: il check aggregato resta denominato esattamente `Canonical Verification` finché required checks/Vercel esterni dipendono da quel nome.
- MUST: nessun documento può affermare che “qualsiasi stderr” è automaticamente bloccante finché tale controllo non viene implementato.
- SHOULD: warning inattesi, React `act(...)`, unhandled rejection e framework warning nelle suite candidate vanno corretti o spiegati; non sopprimerli indiscriminatamente per ottenere silenzio.

## External checks

- MUST: la copertura SAST bloccante non dipende da quote o disponibilità di un servizio terzo: CodeQL è parte del gate aggregato `Canonical Verification`.
- MUST: il core shard esegue inoltre Gitleaks e zizmor con release versionate e checksum SHA-256 verificati. Gitleaks analizza il delta Git completo dell'evento con redazione totale dei valori rilevati; zizmor analizza i workflow. Questi controlli supplementari non sostituiscono CodeQL.
- NOTE: eventuali check Snyk esterni restano supplementari. Un errore operativo come quota/limite raggiunto non equivale a una vulnerabilità rilevata e non sostituisce il risultato CodeQL.
- NOTE: `npm audit --audit-level=high` è registry-dependent e può cambiare senza commit; resta bloccante nel workflow ma non fa parte della semantica deterministica del comando repository `verify:m8`.
- VERIFY: required status checks/rulesets sono configurazione GitHub esterna; non dichiararli required senza leggere il ruleset effettivo.
- VERIFY: Vercel Deployment Checks è configurazione esterna; non assumere che blocchi il deploy solo perché il job GitHub si chiama `Canonical Verification`.
- MUST: Firebase Hosting Production parte soltanto dopo il completamento riuscito di `Firebase Firestore Production`, che a sua volta deriva da `Milestone Verification` verde su push a `main`; usa lo stesso exact SHA e rifiuta di deployare se `origin/main` è già avanzato. Questo serializza i cutover che cambiano contemporaneamente Rules e client.
- MUST: il workflow Hosting usa `firebase deploy --only hosting`; Rules e indici Firestore non sono side effect del deploy frontend.
- MUST: Firebase Firestore Production è un workflow separato, parte soltanto dopo lo stesso gate canonico su push a `main`, ricontrolla l'exact SHA e riconcilia sempre lo stato desiderato con il provider live; non usa il commit padre come proxy dell'ultimo stato distribuito.
- MUST: il deploy Firestore avviene solo quando la riconciliazione rileva Rules divergenti o configurazione indice desiderata realmente mancante/divergente; indici compositi già presenti ma non `READY` e field exemption già associate a una Long Running Operation attiva di soli delta `REMOVE` richiedono attesa/verifica senza un deploy ridondante, mentre uno stato live non determinabile è failure.
Il read-back globale degli indici compositi MUST rilevare anche indici in collection group rimossi dal manifest. Se il provider restituisce indici compositi inattesi, il workflow fallisce prima di ogni deploy, senza rimuoverli automaticamente: occorre un intervento distinto e verificato.
Il read-back delle exemption single-field MUST usare la lista esplicita database-wide `collectionGroups/-/fields` con filtro `indexConfig.usesAncestorConfig=false OR ttlConfig:*`; una lettura per singolo collection group non è un oracolo valido per le wildcard collection-level.
Il confronto MUST tollerare l'omissione JSON di `usesAncestorConfig: false` prevista dalla serializzazione protobuf, ma deve continuare a rifiutare `usesAncestorConfig: true` e qualunque override con indici residui.
- MUST: il deploy Firestore usa `--only firestore:rules,firestore:indexes`, non usa `--force`, autentica una identità WIF dedicata distinta dall'Hosting deployer e verifica il provider dopo la mutazione.
- MUST: le action privilegiate dei workflow Hosting e Firestore sono pin-nate a commit SHA immutabili; il commento di versione serve solo alla manutenzione/Dependabot.
- MUST: i branch di sviluppo non generano Vercel Preview (`vercel.json`); verifiche locali/CI non richiedono di abilitarle e non attestano Production.
- VERIFY: ruoli IAM Google Cloud e variabili/secret provisionati non sono dimostrati dalla configurazione repository se non esiste IaC/evidenza diretta.

## Acceptance

Localmente, un candidato è tecnicamente validato dal gate repository quando `npm run verify:m8` termina con exit code 0 sull'HEAD esatto. In GitHub Actions, l'evidenza equivalente è una run `Milestone Verification` sullo stesso SHA in cui matrice di shard, job dedicato `Verification / Playwright E2E` e `Security / CodeQL` sono verdi e il check aggregato `Canonical Verification` è `success`.

Per revisioni indipendenti richieste dal livello di rischio del task, congelare lo SHA candidato e far revisionare/testare quello stesso SHA. Non sostituire evidenza eseguibile con il solo consenso tra agenti.
