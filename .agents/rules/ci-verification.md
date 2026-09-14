# CI Verification — M6 Invariants

## Scope

Questa regola disciplina il gate canonico di verifica automatica introdotto in M6.

## Exact HEAD

- MUST: su `pull_request`, il workflow deve fare checkout esplicito di `github.event.pull_request.head.sha`, non affidarsi implicitamente al merge ref sintetico.
- MUST: prima dei test, `git rev-parse HEAD` deve essere confrontato con lo SHA atteso e una divergenza deve terminare il job.
- MUST: ogni report di validazione deve indicare lo SHA esatto realmente verificato.

## Clean worktree

- MUST: `verify:m6` deve partire con `test:repo-hygiene`.
- MUST: modifiche tracciate o file non tracciati non ignorati presenti prima della verifica rendono il risultato non autorevole e devono far fallire il gate.
- MUST: i file testuali tracciati controllati dal gate devono essere UTF-8 valido senza BOM.
- MUST: il gate non deve riscrivere automaticamente file malformati.

## Single source of truth

- MUST: GitHub Actions deve invocare `npm run verify:m6`; non deve ricostruire manualmente un sottoinsieme alternativo della pipeline.
- MUST: `verify:m6` deve includere transitivamente l'intero `verify:m5`.
- MUST: i workflow legacy che duplicano porzioni di test/E2E non devono restare attivi in parallelo.

## Workflow security

- MUST: usare `pull_request`, mai `pull_request_target`, per eseguire codice della PR.
- MUST: impostare `permissions: contents: read` salvo futura necessità documentata.
- MUST: nessun secret production è richiesto dal gate M6.
- MUST: il runner E2E continua a usare esclusivamente configurazione Firebase dummy/test.

## Trigger

- MUST: il workflow deve partire per PR verso `main`.
- MUST: il workflow deve partire per PR verso `feat/ui-workout-guest-flow` finché quel branch resta il target di integrazione del programma milestone.
- SHOULD: cancellare run obsolete della stessa PR/ref tramite `concurrency`.

## External checks

- NOTE: `npm audit` è registry-dependent e può cambiare senza un commit. Può essere bloccante in GitHub Actions, ma non fa parte della semantica deterministica di `verify:m6`.
- VERIFY: required status checks/rulesets sono configurazione GitHub esterna al repository; non dichiarare un check "required" senza leggere il ruleset effettivo.

## Acceptance

M6 è approvabile solo quando GitHub Actions e la validazione indipendente Antigravity hanno eseguito lo stesso HEAD esatto con `npm run verify:m6` exit code 0.
