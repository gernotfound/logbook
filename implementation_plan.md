# Piano — pulizia documentale e igiene repository

Data: 20 settembre 2026. Baseline: `83f539045bfeb5bfd895394dc30a1316d03bfa0c` (`main`).
Stato: autorizzato dal product owner.

## Obiettivo

Rimuovere da `main` report, audit e piani di implementazione storici che non sono più fonte di verità operativa, preservando soltanto documentazione normativa e guide tecniche correnti. Evitare che lo stesso accumulo si ripresenti.

## Scope

- rimuovere i `implementation_plan*.md` storici dalla root;
- rimuovere `audit_logbook_2026.md` e `remediation_logbook_2026.md` dalla root;
- rimuovere la directory legacy `audit-report/` e il report AI `docs/ai/audit_struttura_ui.md`;
- mantenere `README.md`, `AGENTS.md`, `.agents/rules/`, le guide operative in `docs/` e gli audit intenzionalmente archiviati in `docs/audits/`;
- rafforzare `scripts/check-repo-hygiene.mjs` e `.agents/rules/ci-verification.md` affinché artefatti task-specific non tornino in `main`.

## Rischi e invarianti

- Nessuna modifica a codice applicativo, dati utente, schema, sincronizzazione, Firestore Rules, dipendenze o configurazione runtime.
- La cronologia Git e le PR restano l'archivio dei documenti eliminati.
- `docs/audits/` resta l'unica area destinata ad audit storici deliberatamente conservati.
- I piani `implementation_plan.md` possono esistere temporaneamente sul branch di lavoro per rispettare Strict Planning Mode, ma devono essere rimossi prima del merge.
- I Preview Deployment dei branch di sviluppo restano disabilitati dal `vercel.json` corrente (`main: true`, `**: false`).

## Verifica

- revisione del diff finale per confermare che siano toccati solo documentazione e repository hygiene;
- `npm run verify:m8` tramite il gate canonico GitHub Actions sull'esatto HEAD della PR;
- verifica che non venga creato un Preview Deployment Vercel per questo branch;
- dopo merge: verifica dell'HEAD effettivo di `main`, `Canonical Verification` verde e deployment Vercel production sul commit di `main`.

## Rollback

Le rimozioni sono integralmente recuperabili dalla cronologia Git. Nessun dato di produzione o formato persistito viene modificato.
