# Audit refactoring — piano operativo

Data audit: 2026-09-16  
Branch: `refractoring-160726`

## Obiettivo

Ridurre il costo cognitivo e di contesto delle modifiche future senza introdurre refactor cosmetici o aumentare il rischio di regressione. Un file grande non è automaticamente un problema: diventa candidato allo split quando combina responsabilità indipendenti, costringe a leggere molto codice non pertinente per una modifica locale o rende difficile isolare test e dipendenze.

La dimensione del sorgente non è, da sola, una causa di peggioramento delle performance runtime. È però rilevante per manutenzione e lavoro assistito da AI: leggere un file da 20–30 KB, più chiamanti e test, consuma molto più contesto di un modulo focalizzato.

## Baseline verificata

Il repository corrente ha già completato parte del vecchio refactoring storico: `TrainingSession`, `CycleEditor`, `schema.ts` e `db.ts` sono già modularizzati. Il vecchio `REFACTORING_PLAN.md` era quindi obsoleto ed è stato rimosso.

Pulizia preliminare già eseguita sul branch:

- rimosso `REFACTORING_PLAN.md` obsoleto;
- rimosso `test_debug.ts` dalla root;
- rimosso `tsconfig.node.tsbuildinfo` generato;
- aggiunto `*.tsbuildinfo` a `.gitignore`.

Nessun file applicativo è stato modificato durante questa pulizia.

## Criterio di refactoring

Non introdurre un limite rigido di righe. Usare invece questi segnali:

- `> 16–20 KB` + almeno due responsabilità indipendenti: revisione consigliata;
- `> 25 KB` + responsabilità multiple o forte fan-out di modifiche: candidato prioritario;
- file statici/dati/asset isolati: esenti se non obbligano i consumer a leggerne il contenuto;
- facade pubbliche possono restare piccole e re-esportare moduli interni;
- test omnibus `> 30–40 KB`: normalmente da dividere per feature/comportamento, mantenendo invariati gli oracle e i test case.

Lo split deve migliorare la località del contesto: una modifica deve richiedere di leggere il minor numero possibile di moduli non pertinenti.

## Inventario prioritario

| Area | Dimensione osservata | Valutazione | Rischio |
|---|---:|---|---|
| `tests/telemetry_e2e.test.ts` | ~103 KB | Test omnibus; beneficio molto alto dallo split per feature/tier | Basso |
| `tests/e2e_enhancements_r1_r6.test.tsx` | ~101 KB | Test omnibus per R1–R6 | Basso |
| `tests/e2e_requirements_r1_r6.test.tsx` | ~79 KB | Test omnibus per requisiti | Basso |
| `tests/tier5_adversarial_guest_catalog.test.ts` | ~51 KB | Suite ampia, da separare solo lungo confini reali | Basso/medio |
| `tests/e2e_guest_catalog.test.ts` | ~50 KB | Suite ampia guest/catalog | Basso/medio |
| `src/lib/telemetryHub.ts` | ~32 KB | lifecycle + rate limit + queue + retry + transport + tracking | SENSITIVE |
| `src/components/Training/MuscleModelPaths.tsx` | ~31 KB | Quasi solo geometria SVG statica; già isolata | NON prioritario |
| `src/styles/global.css` | ~29 KB | token + base + componenti + feature style nello stesso file | SENSITIVE |
| `src/lib/sync/domainOperations.ts` | ~27 KB | tipi + reducer + validazione + scope/compiler semantico | CRITICAL |
| `src/contexts/AuthContext.tsx` | ~27 KB | auth lifecycle + hydration + guest migration + bootstrap | CRITICAL |
| `src/components/Training/TrainingExercises.tsx` | ~27 KB | editor + selezione muscoli + archivio + azioni UI | SENSITIVE |
| `src/lib/sync/semanticProjection.ts` | ~24 KB | parsing meta + merge policy + diff + causal semantics | CRITICAL |
| `src/components/Nutrition/NutritionMeals.tsx` | ~23 KB | navigazione + riepilogo + ricerca + pasti + editing | SENSITIVE |
| `src/hooks/useWorkoutSession.ts` | ~21 KB | lifecycle workout + storico + completion + persistenza locale | CRITICAL |
| `src/components/SettingsView.tsx` | ~20 KB | account + PWA + diagnostica + privacy + export | SENSITIVE |
| `src/hooks/useTrainingExercises.ts` | ~19 KB | form + draft + ricerca + selezione + CRUD | SENSITIVE |

Altri moduli di persistenza/sync (`localRepository.ts`, `merge.ts`, `export.ts`) sono rilevanti ma non vanno rifattorizzati per soli motivi dimensionali prima di aver completato le fasi a rischio minore.

## Piano di esecuzione

### Fase 0 — Baseline e guardrail

Prima del primo refactor applicativo:

1. congelare lo SHA di baseline del branch;
2. eseguire il gate canonico `npm run verify:m8` sull'HEAD esatto;
3. registrare eventuali failure preesistenti prima di attribuirle al refactor;
4. mantenere invariati i quattro numeri di versione persistiti (Data Schema 1, Sync Protocol 1, Local Envelope 4, Backup Schema 3);
5. nessun nuovo bypass del boundary Domain Operations.

### Fase 1 — Spezzare i test omnibus

È la prima fase raccomandata perché riduce molto il contesto necessario senza modificare il runtime.

Target iniziali:

- `telemetry_e2e.test.ts` → file per feature/tier coerente;
- `e2e_enhancements_r1_r6.test.tsx` → file per requisito/feature;
- `e2e_requirements_r1_r6.test.tsx` → file per requisito/feature;
- successivamente valutare `e2e_guest_catalog.test.ts` e `tier5_adversarial_guest_catalog.test.ts`.

Vincoli:

- nessuna asserzione eliminata o indebolita;
- nessuna duplicazione degli oracle;
- setup/mocks condivisi estratti solo se realmente comuni;
- naming compatibile con i pattern Vitest correnti;
- non chiamare E2E una suite jsdom/Vitest nel nuovo naming/documentazione: il Playwright E2E resta distinto.

Acceptance: stesso comportamento coperto, stessi test sostanziali, suite incluse nei gate corretti, `verify:m8` verde.

### Fase 2 — Decomposizione UI a comportamento invariato

Ordine raccomandato:

1. `SettingsView.tsx`: separare i tre tab e la diagnostica; mantenere `useSettings` invariato;
2. `NutritionMeals.tsx`: estrarre navigatore data, riepilogo macro, ricerca alimento e sezione pasto;
3. `TrainingExercises.tsx`: estrarre editor, selettore muscoli e archivio esercizi.

Regola: lo stato resta nel parent/hook esistente salvo necessità dimostrata. I nuovi componenti ricevono props tipizzate e non introducono accesso diretto al DB o nuovi mutation boundary.

Acceptance: test mirati, lint/typecheck/build, `verify:m8`, più verifica reale dell'interfaccia sui flussi modificati.

### Fase 3 — CSS per dominio mantenendo una entrypoint stabile

Mantenere `src/styles/global.css` come entrypoint e dividerne internamente il contenuto in moduli caricati in ordine esplicito, ad esempio:

- `tokens.css`;
- `base.css`;
- `layout.css`;
- `controls.css`;
- `training.css`;
- `nutrition.css`.

Non introdurre CSS Modules o un cambio di strategia styling nello stesso refactor.

Acceptance: tutte le custom properties esistenti preservate, ordine di cascade invariato, test UI pertinenti, build e verifica visuale/browser.

### Fase 4 — Decomposizione di servizi/hook con facade compatibile

1. `telemetryHub.ts`: separare types, queue/storage, transport/retry e rate-limit/session mantenendo `telemetryHub.ts` come facade pubblica stabile;
2. `useTrainingExercises.ts`: estrarre helper puri per normalizzazione/selezione muscoli e, se utile, persistenza draft; mantenere la API pubblica dell'hook inizialmente invariata.

Acceptance: import pubblici esistenti ancora validi, test telemetry/exercise mirati verdi, nessun cambiamento di semantica, gate canonico verde.

### Fase 5 — Refactor CRITICAL, uno alla volta

Solo dopo stabilizzazione delle fasi precedenti:

- `domainOperations.ts`: separare tipi/contratti, reducer e compiler/scope mantenendo `domainOperations.ts` come facade;
- `AuthContext.tsx`: separare caricamento autenticato, guest→account migration e lifecycle provider senza modificare il contratto pubblico;
- valutare poi `semanticProjection.ts`, `localRepository.ts`, `merge.ts`, `export.ts` solo quando un beneficio misurabile giustifica il rischio;
- `useWorkoutSession.ts` solo con coverage mirata di start/edit/end/delete, local workout e failure/offline.

Per ogni intervento CRITICAL: commit/PR separato, SHA candidato congelato, test mirati + `verify:m8`, revisione indipendente; per modifiche a persistenza/sync/auth valutare anche audit esterno.

## File da non spezzare per sola dimensione

### `MuscleModelPaths.tsx`

È grande ma quasi interamente geometria SVG statica, già isolata dal comportamento di `MuscleModel.tsx`. Dividerla in più componenti solo per ridurne le righe aumenterebbe file e import senza ridurre il contesto richiesto alle normali modifiche. Va trattata come asset sorgente e letta solo quando si interviene sulla mappa muscolare.

### `schema.ts` e `db.ts`

Sono già stati trasformati in entrypoint/facade sopra moduli più piccoli. Non ripetere il vecchio piano.

### `types.ts`

La dimensione corrente non giustifica uno split per dominio se ciò aumenta soltanto il numero di import e il coupling.

## Best practice operative

- un refactor non deve cambiare contemporaneamente architettura e comportamento di prodotto;
- preservare import path pubblici quando possibile mediante facade/barrel;
- estrarre prima funzioni pure e componenti presentazionali, poi orchestratori;
- evitare `React.memo`/`useCallback` automatici: usarli solo quando il profiling o la stabilità delle props lo giustificano;
- nessun refactor opportunistico fuori dal target della fase;
- commit piccoli, semanticamente isolati e facilmente revertibili;
- ogni fase deve avere diff comprensibile e verifiche proprie prima di passare alla successiva.

## Risultato atteso

Il successo non è "nessun file sopra N righe". Il risultato atteso è che le modifiche comuni richiedano meno contesto, che i confini di responsabilità siano espliciti, che i test pertinenti siano localizzabili e che le aree CRITICAL mantengano integralmente gli invarianti di persistenza, sync, auth e Domain Operations.
