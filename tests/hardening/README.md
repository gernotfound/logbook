# M5 hardening suite

**Contesto:** [AGENTS.md](../../AGENTS.md) governa processo e autorizzazioni; [Verifica CI](../../.agents/rules/ci-verification.md) definisce il gate canonico corrente `npm run verify:m8` o CI equivalente exact-SHA. I comandi delle milestone sotto sono subset diagnostici, non il gate finale.

Questa directory e `vitest.hardening.config.ts` definiscono il gate normativo M5.

## Comandi

- `npm run test:hardening` — esegue i test di accettazione M5 in un worker singolo.
- `npm run test:typecheck:m5` — typecheck dei test normativi selezionati insieme ai contratti production importati.
- `npm run test:quality:m5` — rifiuta skip/todo, test `.only`, marker di lavoro incompleto e assertion tautologiche nei file normativi; i test sotto `tests/hardening/` vengono scoperti automaticamente.
- `npm run verify:m5` — gate cumulativo M0–M5.

## Cosa vale come prova

I test M5 devono attraversare il boundary production che dichiarano di verificare. In particolare:

- guest login/logout della PWA Kinde-first: `GuestOnlyAuthProvider` + `useAuth`; sessione Kinde: `KindeAccountSessionProvider` (in modalità pubblica solo identità); i test del vecchio `AuthProvider` Firebase coprono solo il boundary legacy, non il runtime corrente;
- trasferimento guest → account Kinde: non ancora abilitato nella PWA; quando sarà attivato, i test dovranno attraversare il nuovo lifecycle e osservare il journal locale reale, senza dedurre il successo soltanto dallo stato Zustand;
- catalogo: `catalogService` e `deltaResolver` reali;
- nutrizione: `useNutritionMeals` e il suo indice `createFoodSearcher` da `src/lib/calc/foodSearch.ts`, con identificativi e ordinamento attesi espliciti; il confronto con il motore standalone non è un oracle indipendente. Le suite jsdom possono simulare il boundary esterno `DB` senza sostituire il percorso di mutazione effettivo;
- totali meal: confronto con `calculateLoggedMealTotals` e valori attesi espliciti.

Le suite stress `tests/stress/catalog/tier5_adversarial_guest_catalog_*.test.ts`, ora suddivise per scenario, forniscono copertura supplementare ma non sostituiscono questi acceptance oracle.

## Confini della suite

Questa è integrazione Vitest/jsdom, non Playwright E2E. La persistenza browser/process boundary resta coperta dal gate Playwright già incluso in `verify:m5`; recovery, fuzz e GC restano nelle rispettive suite M2–M4.
