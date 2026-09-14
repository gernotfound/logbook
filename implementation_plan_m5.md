# M5 — Verification & Coverage Hardening

Baseline canonica: `f63999854b0b2224c3bd56417a89bf170ab32304`.
Stato: **approvato dall'utente il 14 settembre 2026**.

## Obiettivo

Rendere affidabile il segnale di verifica sui flussi guest, catalogo, nutrizione e lifecycle di sync. M5 non introduce feature, nuovi formati dati o nuove semantics di sincronizzazione: i test normativi devono attraversare codice di produzione reale oppure usare un oracle indipendente.

## Scope

- sostituire i placeholder del logout protection con integrazione reale `AuthProvider` / store / dialog / DB boundary;
- verificare guest bootstrap e guest → account migration attraverso i boundary reali già disponibili;
- verificare ricerca e mutazioni nutrizionali attraverso `useNutritionMeals` e `Logic.searchFoods`;
- aggiungere una suite Vitest M5 dedicata, seriale, distinta dallo stress legacy;
- aggiungere typecheck dei test normativi selezionati;
- aggiungere un quality gate che rifiuta skip/todo, assertion tautologiche e marker di placeholder nella suite normativa;
- mantenere integralmente i gate M0–M4 dentro `verify:m5`.

Il vecchio `tests/tier5_adversarial_guest_catalog.test.ts` resta stress supplementare. Non è un acceptance oracle M5.

## Non-obiettivi

- nessun bump di data schema, sync protocol, local envelope o backup schema;
- nessuna modifica a Firestore Rules;
- nessuna nuova dipendenza;
- nessun cleanup generalizzato del corpus test legacy;
- nessuna modifica production soltanto per rendere verde un test.

Se l'hardening espone un difetto production, il finding deve essere riprodotto e classificato prima di modificare `src/`.

## File previsti

- `package.json`
- `vitest.hardening.config.ts`
- `tsconfig.m5-tests.json`
- `scripts/check-m5-test-quality.mjs`
- `tests/logout_protection.test.ts`
- `tests/guest_bootstrap_lifecycle.test.tsx`
- `tests/guest_account_migration_v3.test.tsx` solo se serve rafforzare un oracle
- `tests/catalog_resolution_pipeline.test.ts` come oracle catalogo production
- `tests/hardening/nutrition_guest_flow.test.tsx`
- `tests/hardening/README.md`
- `.agents/rules/verification-hardening.md`

## Gate M5

`npm run verify:m5` deve eseguire, nell'ordine:

1. lint;
2. typecheck M5;
3. quality gate M5;
4. test base;
5. isolated;
6. fuzz;
7. recovery;
8. GC;
9. hardening M5;
10. stress;
11. Firestore Rules emulator;
12. Playwright E2E;
13. no-skips globale;
14. build.

## Acceptance criteria

M5 è proponibile alla validazione indipendente solo se:

- `verify:m5` termina con exit code 0;
- `test:hardening` passa tre volte consecutive;
- `test:typecheck:m5` e `test:quality:m5` passano;
- nessun test normativo contiene assertion tautologiche;
- guest login/logout attraversa `AuthProvider`;
- guest → account attraversa journal/localRepository al boundary testato;
- food search attraversa `Logic.searchFoods`;
- add/update/remove meal attraversano `useNutritionMeals` e `saveUserData`;
- i totali sono confrontati con `calculateLoggedMealTotals` e con risultati attesi espliciti;
- tutti i gate M0–M4 continuano a passare;
- l'HEAD esatto viene congelato prima della validazione Antigravity.

## Rischi e rollback

Il typecheck può esporre debito preesistente nei test. In tal caso si corregge il test se il contratto production è corretto; non si allarga l'API production per accomodare chiamate legacy senza motivazione funzionale.

I nuovi test possono scoprire bug nascosti dai test simulati: il fallimento è un risultato utile e non va neutralizzato indebolendo l'oracle.

Il rollback è il ritorno alla baseline `f63999854b0b2224c3bd56417a89bf170ab32304`; il primo passaggio M5 è limitato a test, configurazione e documentazione.