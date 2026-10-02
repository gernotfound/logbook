# CI Verification — contratto canonico corrente

## Scope

Questa regola disciplina il gate canonico di verifica automatica corrente dopo M8. Le milestone M0–M8 restano composte transitivamente nel comando repository; GitHub Actions può distribuire i leaf command equivalenti su runner indipendenti senza ridurre la copertura.

Gerarchia corrente:

- **workflow GitHub Actions:** `Milestone Verification` (`.github/workflows/verification.yml`);
- **check aggregato stabile:** `Canonical Verification`;
- **analisi SAST richiesta:** job `Security / CodeQL` su JavaScript/TypeScript con query `security-extended`, aggregato dentro `Canonical Verification`;
- **comando repository umbrella:** `npm run verify:m8`;
- **orchestrazione CI:** matrice di shard exact-SHA verificata da `scripts/check-ci-contract.mjs`.

La parallelizzazione riguarda l'orchestrazione, non la semantica del gate. Unit, integration, isolated, fuzz, recovery, GC, hardening, stress, Firestore Rules emulator, Playwright, build e controlli M7/M8 restano obbligatori.

## Exact HEAD

- MUST: ogni shard che esegue codice della PR fa checkout esplicito di `github.event.pull_request.head.sha`, non del merge ref sintetico.
- MUST: in ogni shard, prima dei test, `git rev-parse HEAD` viene confrontato con lo SHA atteso; una divergenza termina lo shard.
- MUST: tutti gli shard della stessa run verificano lo stesso exact SHA.
- MUST: anche il job CodeQL fa checkout e verifica esplicita dello stesso exact SHA prima dell'analisi.
- MUST: ogni report di validazione indica lo SHA esatto realmente verificato.
- MUST: ogni revisione indipendente citata come evidenza si riferisce allo stesso SHA candidato o dichiara esplicitamente una baseline diversa.

## Clean worktree

- MUST: `verify:m8` include transitivamente `verify:m7` → `verify:m6` → `test:repo-hygiene`.
- MUST: la CI parallela include lo stesso `test:repo-hygiene` tra i leaf command obbligatori.
- MUST: modifiche tracciate o file non tracciati non ignorati presenti prima della verifica rendono il risultato non autorevole e fanno fallire il gate.
- MUST: i file testuali controllati dal gate sono UTF-8 valido senza BOM.
- MUST: il gate non riscrive automaticamente file malformati.

### Repository documentation hygiene

- MUST: i file task-specific `implementation_plan*.md` sono artefatti di lavoro del branch e devono essere rimossi prima della validazione finale e del merge.
- MUST: report generati task-specific come `audit_logbook_*.md`, `remediation_logbook_*.md` e le directory legacy `audit-report/` o `docs/ai/` non devono essere tracciati nel candidato finale.
- MUST: le istruzioni normative correnti vivono in `AGENTS.md` e `.agents/rules/`; le guide operative stabili vivono in `docs/`; gli audit storici deliberatamente conservati vivono in `docs/audits/`.
- NOTE: cronologia Git e discussioni PR preservano piano, evidenze e report di uno specifico task; copie obsolete in `main` non sono fonte di verità operativa.

## Single source of truth

- MUST: `npm run verify:m8` resta il comando repository umbrella e continua a comporre integralmente `verify:m7`, quindi M6/M5 e i gate precedenti richiesti.
- MUST: GitHub Actions può appiattire quella composizione in shard paralleli soltanto se `test:ci-contract` prova meccanicamente che il multiset dei leaf command della matrice è equivalente all'espansione corrente di `verify:m8`.
- MUST: gli shard non invocano umbrella `verify:mN` seriali; eseguono leaf command per ottenere parallelismo reale.
- MUST: `npm audit --audit-level=high` resta bloccante nella CI ma non appartiene alla semantica deterministica di `verify:m8`.
- MUST: M8 aggiunge test Domain Operations V4 e il boundary checker che impedisce nuovi consumer UI/hook snapshot-based fuori dall'allowlist documentata.
- MUST: workflow temporanei di migrazione non devono esistere nell'HEAD candidato.
- MUST: workflow legacy che duplicano test/E2E non restano attivi in parallelo.

## Parallelizzazione e isolamento

- MUST: la matrice usa `fail-fast: false` per raccogliere l'esito di tutti gli shard dello stesso SHA.
- MUST: Java viene installato solo nello shard Firestore Rules salvo nuova dipendenza documentata.
- MUST: Chromium Playwright viene installato solo nello shard E2E salvo nuova dipendenza documentata.
- MUST: suite intenzionalmente single-worker, incluse recovery/fuzz/GC/hardening dove configurato, mantengono i propri limiti interni; la CI parallelizza tra suite, non forza concorrenza dentro scenari che richiedono isolamento.
- MUST: la suite Vitest standard può essere divisa per file con `--shard=i/N` soltanto se tutti gli indici `1..N` sono presenti esattamente una volta e il CI contract ricompone la coppia nell'unico leaf canonico `npm run test`.
- MUST: il contract PWA M7 che legge `dist/` deve essere eseguito nello stesso shard che produce il build richiesto, oppure ricevere artefatti verificati dello stesso exact SHA.
- SHOULD: gli shard vanno bilanciati usando durate osservate in GitHub Actions; evitare micro-shard il cui overhead di setup supera il beneficio.

## Workflow security

- MUST: usare `pull_request`, mai `pull_request_target`, per eseguire codice della PR.
- MUST: gli shard di verifica mantengono `permissions: contents: read`.
- MUST: il solo job CodeQL può aggiungere `security-events: write`, limitato al caricamento dei risultati di code scanning; non estendere tale permesso agli shard applicativi.
- MUST: nessun secret production è richiesto dal gate repository.
- MUST: tutte le GitHub Actions di terze parti usate dal workflow canonico sono pin-nate a commit SHA completi e immutabili; il commento di versione serve alla manutenzione/Dependabot, non alla risoluzione runtime.
- MUST: i test M7 server continuano a mockare Firebase Admin.
- MUST: il runner E2E usa esclusivamente configurazione Firebase dummy/test.
- MUST: `FIREBASE_ADMIN_*` e `CRON_SECRET` restano configurazione runtime e non fixture CI.

## Trigger

- MUST: il workflow parte per PR verso `main`.
- MUST: il workflow parte sui push a `main`.
- MUST NOT: branch milestone ritirati, incluso `feat/m8-domain-operations-v4`, restano trigger push del workflow canonico.
- SHOULD: run obsolete della stessa PR/ref vengono cancellate tramite `concurrency`.

## Domain Operations contract

- MUST: le quattro versioni persistite restano Data Schema 1, Sync Protocol 1, Local Envelope 4, Backup Schema 3 finché `schemaEvolution.ts` non viene modificato con migrazione approvata.
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

`pipefail` preserva il codice di uscita non-zero del leaf chain; `2>&1` unisce stdout e stderr nel log. La matrice non usa `continue-on-error`. Il job `Canonical Verification` usa `needs: shards` e fallisce se il risultato aggregato non è `success`.

- MUST: il check aggregato resta denominato esattamente `Canonical Verification` finché required checks/Vercel esterni dipendono da quel nome.
- MUST: nessun documento può affermare che “qualsiasi stderr” è automaticamente bloccante finché tale controllo non viene implementato.
- SHOULD: warning inattesi, React `act(...)`, unhandled rejection e framework warning nelle suite candidate vanno corretti o spiegati; non sopprimerli indiscriminatamente per ottenere silenzio.

## External checks

- MUST: la copertura SAST bloccante non dipende da quote o disponibilità di un servizio terzo: CodeQL è parte del gate aggregato `Canonical Verification`.
- NOTE: eventuali check Snyk esterni restano supplementari. Un errore operativo come quota/limite raggiunto non equivale a una vulnerabilità rilevata e non sostituisce il risultato CodeQL.
- NOTE: `npm audit --audit-level=high` è registry-dependent e può cambiare senza commit; resta bloccante nel workflow ma non fa parte della semantica deterministica del comando repository `verify:m8`.
- VERIFY: required status checks/rulesets sono configurazione GitHub esterna; non dichiararli required senza leggere il ruleset effettivo.
- VERIFY: Vercel Deployment Checks è configurazione esterna; non assumere che blocchi il deploy solo perché il job GitHub si chiama `Canonical Verification`.
- MUST: Firebase Hosting Production parte soltanto dopo `Milestone Verification` verde su push a `main`, usa lo stesso exact SHA e rifiuta di deployare se `origin/main` è già avanzato.
- MUST: il workflow Hosting usa `firebase deploy --only hosting`; Rules e indici Firestore non sono side effect del deploy frontend.
- MUST: le action del workflow Hosting che ricevono token/segreti o partecipano al deploy Production sono pin-nate a commit SHA immutabili; il commento di versione serve solo alla manutenzione/Dependabot.
- VERIFY: Vercel Preview verifica build/routing ma non sostituisce il gate repository.
- VERIFY: ruoli IAM Google Cloud e secret provisionati non sono dimostrati dalla configurazione repository se non esiste IaC/evidenza diretta.

## Acceptance

Localmente, un candidato è tecnicamente validato dal gate repository quando `npm run verify:m8` termina con exit code 0 sull'HEAD esatto. In GitHub Actions, l'evidenza equivalente è una run `Milestone Verification` sullo stesso SHA in cui tutti gli shard e `Security / CodeQL` sono verdi e il check aggregato `Canonical Verification` è `success`.

Per revisioni indipendenti richieste dal livello di rischio del task, congelare lo SHA candidato e far revisionare/testare quello stesso SHA. Non sostituire evidenza eseguibile con il solo consenso tra agenti.
