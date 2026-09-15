# Verification hardening — M5

## Scope normativo

M5 distingue tra test normativi di accettazione e suite legacy/stress. Un test normativo è una prova del comportamento solo se attraversa il codice di produzione responsabile del comportamento oppure usa un oracle indipendente.

`tests/tier5_adversarial_guest_catalog.test.ts` e le altre suite stress restano utili per regressioni e carico, ma non possono essere citate da sole come prova di accettazione M5.

M8 non annulla questi criteri di qualità: aggiorna però il production mutation boundary ordinario. Dove una vecchia formulazione M5 cita uno snapshot-save diretto, prevale il boundary Domain Operations corrente.

## Invarianti MUST

- Un test normativo MUST chiamare il boundary production che pretende di verificare. Vietato reimplementare nel test logout, ricerca, calcolo o persistenza e poi verificare la propria reimplementazione.
- Un test normativo MUST avere almeno un'asserzione osservabile sul risultato, sullo stato persistito o su una collaborazione production significativa.
- Sono vietati `it.skip`, `test.skip`, `describe.skip`, `.todo`, `.only` e assertion tautologiche nei file normativi M5.
- I test guest login/logout MUST attraversare `AuthProvider` / `useAuth`.
- La migrazione guest → account MUST osservare il local journal reale al boundary testato; il successo non può essere dedotto soltanto dallo stato Zustand.
- La ricerca alimenti MUST attraversare `Logic.searchFoods`.
- Le mutazioni meal MUST attraversare `useNutritionMeals` e il production mutation boundary corrente (`dispatchDomainOperation()` / domain commit). Una rejection del boundary di persistenza a valle non può essere trasformata in successo silenzioso. I test possono osservare/mockare `DB` come collaborazione esterna senza prescrivere un direct snapshot-save dal consumer UI/hook.
- Il typecheck M5 MUST compilare i test normativi selezionati insieme ai tipi production importati.
- Una suite jsdom/Vitest non va chiamata Playwright E2E.
- `verify:m5` MUST includere integralmente i gate normativi precedenti M2–M4, oltre a hardening, typecheck e quality gate M5. Nel repository corrente `verify:m5` è un subgate transitivo dell'umbrella `verify:m8`.

## Oracle indipendenti

Per i totali meal, la suite M5 confronta lo stato prodotto dall'hook con `calculateLoggedMealTotals` e con valori numerici attesi espliciti. Il test non copia inline la formula di `useNutritionMeals`.

Per il logout, gli oracle sono chiamate `DB`, stato Zustand, flag guest e dialog action. Il test non esegue manualmente `localStorage.removeItem()` o `resetStore()` come sostituto del logout.

Per le mutazioni meal, il valore normativo è che il percorso reale di produzione propaga correttamente un failure persistente; il nome di una API legacy non deve diventare requisito architetturale se il production boundary è cambiato.

## Evidenza

Non dichiarare M5 verde senza output reale dei comandi. Se l'ambiente che produce la patch non può eseguire il repository, la mancanza di evidenza va dichiarata e la validazione deve essere completata tramite CI o revisione indipendente sull'HEAD esatto.
