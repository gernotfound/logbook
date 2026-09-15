# CI Verification — M8 Invariants

## Scope

Questa regola disciplina il gate canonico di verifica automatica corrente. M8 estende M7: exact-head, repository hygiene, workflow security, M7 server account deletion, PWA native Vercel e tutti i gate M0–M6 restano transitivamente obbligatori.

## Exact HEAD

- MUST: su `pull_request`, il workflow deve fare checkout esplicito di `github.event.pull_request.head.sha`, non del merge ref sintetico.
- MUST: prima dei test, `git rev-parse HEAD` deve essere confrontato con lo SHA atteso e una divergenza deve terminare il job.
- MUST: ogni report di validazione indica lo SHA esatto realmente verificato.
- MUST: Antigravity usa lo stesso HEAD congelato e `npm run verify:m8`.

## Clean worktree

- MUST: `verify:m8` include transitivamente `verify:m7` → `verify:m6` → `test:repo-hygiene`.
- MUST: modifiche tracciate o file non tracciati non ignorati presenti prima della verifica rendono il risultato non autorevole e fanno fallire il gate.
- MUST: i file testuali controllati dal gate sono UTF-8 valido senza BOM.
- MUST: il gate non riscrive automaticamente file malformati.

## Single source of truth

- MUST: GitHub Actions invoca `npm run verify:m8`; non ricostruisce manualmente un sottoinsieme alternativo.
- MUST: `verify:m8` include integralmente `verify:m7`.
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
- MUST: durante M8 parte anche sui push a `feat/m8-domain-operations-v4`, così l'HEAD può essere verificato prima della Draft PR.
- MUST NOT: `feat/m7-server-account-deletion` resta il branch di sviluppo corrente del gate.
- SHOULD: run obsolete della stessa PR/ref vengono cancellate tramite `concurrency`.

## M8 Domain Operations contract

- MUST: le quattro versioni persistite restano Data Schema 1, Sync Protocol 1, Local Envelope 4, Backup Schema 3.
- MUST: `DomainOperation` è un layer di intento locale, non un nuovo protocollo persistito.
- MUST: ordinary UI/hook mutations attraversano `dispatchDomainOperation()` salvo boundary bulk esplicitamente allowlisted.
- MUST: business state e SemanticOperation generate vengono rese durevoli atomically nello stesso update IndexedDB.
- MUST: il compiler opera su projection scope dichiarate dall'intento e riusa il protocollo `SemanticOperation` già validato.
- MUST: ID assenti/duplicati e reorder incompleti falliscono; non degradano in snapshot array atomici.
- MUST: test di equivalenza dimostrano reducer business ↔ replay semantico per le famiglie principali.

## M7 contract preservato

- MUST: `vite.config.ts` resta una configurazione Vite/PWA; Nitro e Workflow non fanno parte dell'architettura.
- MUST: le Functions native account deletion mantengono il limite configurato e il recovery cron approvato.
- MUST: il contract PWA M7 continua a verificare service worker e manifest.
- MUST: M8 non modifica Firestore Rules; se una modifica Rules diventasse necessaria, è un cambio di scope da approvare prima del deploy.

## External checks

- NOTE: `npm audit` è registry-dependent e può cambiare senza commit. Resta bloccante nel workflow GitHub Actions ma non fa parte della semantica deterministica di `verify:m8`.
- VERIFY: required status checks/rulesets sono configurazione GitHub esterna; non dichiararli required senza leggere il ruleset effettivo.
- VERIFY: Vercel Preview verifica build/routing ma non sostituisce il gate repository.

## Acceptance

M8 è pronto per validazione indipendente solo quando GitHub Actions ha eseguito l'HEAD esatto con `npm run verify:m8` exit code 0.

M8 è approvabile per merge solo quando Antigravity esegue lo stesso comando sullo stesso SHA congelato, ispeziona il codice reale e restituisce il verdetto concordato.

Poiché lo scope M8 non modifica `firestore.rules`, non è previsto alcun deploy Rules M8. Se il diff finale includesse Rules, il milestone non può essere congelato finché lo scope non viene riesaminato.
