# CI Verification — M7 Invariants

## Scope

Questa regola disciplina il gate canonico di verifica automatica corrente. M7 estende M6: gli invarianti exact-head, hygiene, sicurezza workflow e l'intero `verify:m5` restano transitivamente obbligatori.

## Exact HEAD

- MUST: su `pull_request`, il workflow deve fare checkout esplicito di `github.event.pull_request.head.sha`, non affidarsi implicitamente al merge ref sintetico.
- MUST: prima dei test, `git rev-parse HEAD` deve essere confrontato con lo SHA atteso e una divergenza deve terminare il job.
- MUST: ogni report di validazione deve indicare lo SHA esatto realmente verificato.
- MUST: la validazione Antigravity deve usare lo stesso HEAD congelato e `npm run verify:m7`.

## Clean worktree

- MUST: `verify:m7` deve includere transitivamente `verify:m6`, che parte con `test:repo-hygiene`.
- MUST: modifiche tracciate o file non tracciati non ignorati presenti prima della verifica rendono il risultato non autorevole e devono far fallire il gate.
- MUST: i file testuali tracciati controllati dal gate devono essere UTF-8 valido senza BOM.
- MUST: il gate non deve riscrivere automaticamente file malformati.

## Single source of truth

- MUST: GitHub Actions deve invocare `npm run verify:m7`; non deve ricostruire manualmente un sottoinsieme alternativo della pipeline.
- MUST: `verify:m7` deve includere transitivamente l'intero `verify:m6`, e quindi l'intero `verify:m5`.
- MUST: M7 aggiunge almeno typecheck server, test mirati della cancellazione server e contract native Vercel/PWA.
- MUST: i workflow legacy che duplicano porzioni di test/E2E non devono restare attivi in parallelo.

## Workflow security

- MUST: usare `pull_request`, mai `pull_request_target`, per eseguire codice della PR.
- MUST: impostare `permissions: contents: read` salvo futura necessità documentata.
- MUST: nessun secret production è richiesto dal gate repository. I test server devono mockare Firebase Admin e non devono dipendere da credenziali reali.
- MUST: il runner E2E continua a usare esclusivamente configurazione Firebase dummy/test.
- MUST: le variabili `FIREBASE_ADMIN_*` e `CRON_SECRET` sono configurazione runtime Vercel, non fixture CI e non devono essere committate.

## Trigger

- MUST: il workflow deve partire per PR verso `main`.
- MUST: durante lo sviluppo M7 deve partire anche sui push a `feat/m7-server-account-deletion`, così il gate può essere osservato prima dell'apertura della Draft PR.
- MUST NOT: mantenere `feat/ui-workout-guest-flow` come target di integrazione M7.
- SHOULD: cancellare run obsolete della stessa PR/ref tramite `concurrency`.

## M7 native Vercel contract

- MUST: `vite.config.ts` resta una configurazione Vite/PWA; Nitro e Workflow non sono parte dell'architettura M7 approvata.
- MUST: le Functions native account deletion devono mantenere un limite configurato di 300 secondi e un budget applicativo inferiore al limite di piattaforma.
- MUST: il cron account deletion è giornaliero e funge solo da recovery; il percorso primario è il POST sincrono budget-aware e il polling GET può avanzare job incompleti.
- MUST: il gate deve verificare che la build PWA produca service worker e manifest attesi.

## External checks

- NOTE: `npm audit` è registry-dependent e può cambiare senza un commit. Può essere bloccante in GitHub Actions, ma non fa parte della semantica deterministica di `verify:m7`.
- VERIFY: required status checks/rulesets sono configurazione GitHub esterna al repository; non dichiarare un check "required" senza leggere il ruleset effettivo.
- VERIFY: un Preview Vercel può verificare build/routing delle Functions, ma un test runtime distruttivo richiede configurazione server-side corretta e non sostituisce il gate repository.

## Acceptance

M7 è pronto per validazione indipendente solo quando GitHub Actions ha eseguito l'HEAD esatto con `npm run verify:m7` exit code 0. M7 è approvabile per merge solo quando Antigravity esegue lo stesso comando sullo stesso SHA congelato e restituisce il verdetto previsto dal protocollo. Le Firestore Rules di produzione si distribuiscono solo dopo tale approvazione e dal medesimo SHA validato.
