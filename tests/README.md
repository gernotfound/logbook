# Organizzazione delle suite di test

**Contesto:** [AGENTS.md](../AGENTS.md) governa processo e autorizzazioni; [Verifica CI](../.agents/rules/ci-verification.md) definisce il gate canonico corrente `npm run verify:m8` o CI equivalente exact-SHA. I comandi delle milestone sotto sono subset diagnostici, non il gate finale.

- **Regola:** spostare test esistenti solo per area funzionale e in piccoli gruppi, quando import, fixture, script nominativi, include/exclude Vitest, typecheck e CI possono essere aggiornati e verificati sullo stesso SHA.
- **Distribuzione corrente:** molti test restano direttamente in `tests/`; non sono obsoleti per questo motivo. Le suite specializzate `isolated/`, `emulator/`, `fuzz/`, `recovery/`, `gc/` e `hardening/` seguono i rispettivi gate dedicati.
- **MUST:** non modificare soltanto i percorsi per ragioni estetiche: preservare semanticamente test e mocking, aggiornare import relativi, rintracciare riferimenti con `git grep`, poi verificare sia la suite selezionata sia il gate canonico `verify:m8` o CI equivalente exact-SHA.
- **MUST:** gli spostamenti non autorizzano `skip`, riduzione di asserzioni, modifica dei boundary normativi o esclusione dei test dalla copertura TypeScript.
