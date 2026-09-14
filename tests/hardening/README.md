# M5 hardening suite

Questa directory e `vitest.hardening.config.ts` definiscono il gate normativo M5.

## Comandi

- `npm run test:hardening` — esegue i test di accettazione M5 in un worker singolo.
- `npm run test:typecheck:m5` — typecheck dei test normativi selezionati insieme ai contratti production importati.
- `npm run test:quality:m5` — rifiuta skip/todo, marker di lavoro incompleto e assertion tautologiche nei file normativi.
- `npm run verify:m5` — gate cumulativo M0–M5.

## Cosa vale come prova

I test M5 devono attraversare il boundary production che dichiarano di verificare. In particolare:

- logout guest/autenticato: `AuthProvider` + `useAuth`;
- migrazione guest → account: `AuthProvider` + `localRepository`/journal al boundary testato;
- catalogo: `catalogService` e `deltaResolver` reali;
- nutrizione: `useNutritionMeals`, `Logic.searchFoods` e store reale; `DB` resta il boundary esterno mocked nella suite jsdom;
- totali meal: confronto con `calculateLoggedMealTotals` e valori attesi espliciti.

Il vecchio `tests/tier5_adversarial_guest_catalog.test.ts` resta nel gate stress e può fornire copertura supplementare, ma non sostituisce questi acceptance oracle.

## Confini della suite

Questa è integrazione Vitest/jsdom, non Playwright E2E. La persistenza browser/process boundary resta coperta dal gate Playwright già incluso in `verify:m5`; recovery, fuzz e GC restano nelle rispettive suite M2–M4.
