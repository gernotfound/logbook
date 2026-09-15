# CI Verification — contratto canonico corrente

## Scope

Questa regola disciplina il gate canonico di verifica automatica corrente dopo M8. Le milestone M0–M8 restano composte transitivamente nel gate; i rispettivi documenti possono descrivere subgate storici senza sostituire il gate umbrella corrente.

Gerarchia corrente:

- **workflow GitHub Actions:** `Milestone Verification` (`.github/workflows/verification.yml`);
- **job/check stabile:** `Canonical Verification`;
- **comando repository umbrella:** `npm run verify:m8`.

Un solo workflow di orchestrazione non significa che unit, integration, isolated, fuzz, recovery, GC, stress, Firestore Rules emulator o Playwright siano state eliminate: continuano a essere eseguite transitivamente tramite `verify:m8`.

## Exact HEAD

- MUST: su `pull_request`, il workflow deve fare checkout esplicito di `github.event.pull_request.head.sha`, non del merge ref sintetico.
- MUST: prima dei test, `git rev-parse HEAD` deve essere confrontato con lo SHA atteso e una divergenza deve terminare il job.
- MUST: ogni report di validazione indica lo SHA esatto realmente verificato.
- MUST: ogni revisione indipendente citata come evidenza deve riferirsi allo stesso SHA candidato o dichiarare esplicitamente una baseline diversa.

## Clean worktree

- MUST: `verify:m8` include transitivamente `verify:m7` → `verify:m6` → `test:repo-hygiene`.
- MUST: modifiche tracciate o file non tracciati non ignorati presenti prima della verifica rendono il risultato non autorevole e fanno fallire il gate.
- MUST: i file testuali controllati dal gate sono UTF-8 valido senza BOM.
- MUST: il gate non riscrive automaticamente file malformati.

## Single source of truth

- MUST: GitHub Actions invoca `npm run verify:m8`; non ricostruisce manualmente un sottoinsieme alternativo.
- MUST: `verify:m8` include integralmente `verify:m7`, che include M6/M5 e quindi i gate precedenti richiesti.
- MUST: M8 aggiunge test Domain Operations V4 e il boundary checker che impedisce nuovi consumer UI/hook snapshot-based fuori dall'allowlist documentata.
- MUST: workflow temporanei di migrazione non devono esistere nell'HEAD candidato.
- MUST: workflow legacy che duplicano test/E2E non restano attivi in parallelo.

## Workflow security

- MUST: usare `pull_request`, mai `pull_request_target`, per eseguire codice della PR.
- MUST: `permissions: contents: read` nel gate canonico salvo futura necessità documentata.
- MUST: nessun secret production è richiesto dal gate repository.
- MUST: i test M7 server continuano a mockare Firebase Admin.
- MUST: il runner E2E usa esclusivamente configurazione Firebase dummy/test.
- MUST: `FIREBASE_ADMIN_*` e `CRON_SECRET` restano configurazione runtime e non fixture CI.

## Trigger

- MUST: il workflow parte per PR verso `main`.
- MUST: il workflow parte sui push a `main`.
- SHOULD: run obsolete della stessa PR/ref vengono cancellate tramite `concurrency`.
- NOTE: l'HEAD corrente conserva ancora un trigger push per `feat/m8-domain-operations-v4`, branch non più presente nel repository. È scaffolding milestone inattivo; la sua rimozione richiede una modifica tecnica coordinata di `.github/workflows/verification.yml` e `scripts/check-ci-contract.mjs` e non viene dichiarata completata da questo refresh documentale.

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

Il workflow esegue:

```bash
set -o pipefail
npm run verify:m8 2>&1 | tee m8-verification.log
```

`pipefail` preserva il codice di uscita non-zero del comando; `2>&1` unisce stdout e stderr nel log. Non esiste un controllo generico che renda rosso il job per la sola presenza di output su stderr o della parola `warning`.

- MUST: nessun documento può affermare che “qualsiasi stderr” è automaticamente bloccante finché tale controllo non viene implementato.
- SHOULD: warning inattesi, React `act(...)`, unhandled rejection e framework warning nelle suite candidate vanno corretti o spiegati; non sopprimerli indiscriminatamente per ottenere silenzio.

## External checks

- NOTE: il workflow GitHub esegue `npm audit --audit-level=high` come step separato prima di `verify:m8`. È registry-dependent e può cambiare senza commit; resta bloccante nel workflow ma non fa parte della semantica deterministica del comando repository `verify:m8`.
- VERIFY: required status checks/rulesets sono configurazione GitHub esterna; non dichiararli required senza leggere il ruleset effettivo.
- VERIFY: Vercel Deployment Checks è configurazione esterna; non assumere che blocchi il deploy solo perché il job GitHub si chiama `Canonical Verification`.
- VERIFY: Vercel Preview verifica build/routing ma non sostituisce il gate repository.
- VERIFY: ruoli IAM Google Cloud e secret provisionati non sono dimostrati dalla configurazione repository se non esiste IaC/evidenza diretta.

## Acceptance

Un candidato è tecnicamente validato dal gate repository soltanto quando `npm run verify:m8` termina con exit code 0 sull'HEAD esatto. Se si usa GitHub Actions come evidenza, deve essere il job `Canonical Verification` del workflow `Milestone Verification` sullo stesso SHA.

Per revisioni indipendenti richieste dal livello di rischio del task, congelare lo SHA candidato e far revisionare/testare quello stesso SHA. Non sostituire evidenza eseguibile con il solo consenso tra agenti.
