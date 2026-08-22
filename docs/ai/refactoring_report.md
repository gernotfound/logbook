# Rapporto di Refactoring, Igiene del Codice e Dead Code Elimination

**Progetto**: LogBook PWA  
**Data**: 2026-08-22  
**Stato Baseline & Integrita**:
- `npx tsc --noEmit`: Exit Code 0 (0 errori di tipo)
- `npm run build`: Exit Code 0 (Bundle di produzione generato con successo, SW precache generato)
- `npm run lint` (oxlint): Exit Code 0 (0 errori)
- `npx vitest run`: 53/54 suite superate (1099/1101 test superati; 2 fallimenti preesistenti di baseline tracciati e isolati in `tests/challenger_m1_adversarial_sleep.test.ts`)

---

## 1. Registro Continuo di Esecuzione (Continuous Task Ledger)

| Fase | Descrizione | Stato | Esito & Evidenze |
| :--- | :--- | :--- | :--- |
| **1. Inventory & Survey** | Mappatura completa e multi-angolare del repository (95 file `src/`, 54 file `tests/`, `public/`, configurazioni). | **COMPLETATO** | Identificati 3 file orfani, 8 funzioni di calcolo morte, 1 ghost export e 72 classi CSS inutilizzate. Classificate 234 entità protette (R3). |
| **2. Baseline Recording** | Registrazione formale dello stato di salute iniziale del repository prima di qualsiasi modifica. | **COMPLETATO** | `tsc` 0 errori, `build` 0 errori, `lint` 0 errori, `vitest` 1099/1101 superati. |
| **3. Proven DCE Execution** | Eliminazione chirurgica dei file orfani verificati, delle funzioni non referenziate, del ghost export e delle classi CSS morte. | **COMPLETATO** | Rimossi `src/lib/foods.ts`, `public/test_manichino.html`, `public/icon-cropped.png`. Bonificati `src/lib/calc/nutrition.ts`, `workout.ts`, `date.ts`, `logic.ts`, `createWorkoutSlice.ts`, `global.css`. |
| **4. PWA Hardening** | Implementazione di miglioramenti architetturali PWA ad alto valore aggiunto (R6). | **COMPLETATO** | Aggiunto listener `vite:preloadError` in `App.tsx`, attributi ARIA per modali in `GlobalDialog.tsx`, e `navigator.storage?.persist?.()` in `main.tsx`. |
| **5. Test Layering Alignment** | Rispetto rigoroso della stratificazione dei test e salvaguardia di tutte le asserzioni. | **COMPLETATO** | 0 test eliminati, 0 asserzioni indebolite, preservate integralmente le 24 suite challenger/stress/adversarial. |
| **6. AGENTS.md Historical Review** | Validazione e preservazione dei contratti architetturali e dei termini di dominio (DOMS, Fast Pre-render, ecc.). | **COMPLETATO** | Verificato al 100% l'allineamento di tutte le 15 sezioni di AGENTS.md con il codice sorgente. |
| **7. Final Verification** | Verifica multi-gate automatica di compilazione, build, linting e test. | **COMPLETATO** | `tsc`, `build`, `lint`, `vitest` eseguiti con 0 regressioni. Precache bundle ridotto di ~217 KB; CSS ridotto di ~10 KB. |

---

## 2. Inventario Completo del Dead Code: Proven vs Probable vs Protected

Ogni simbolo è stato sottoposto al **Protocollo di Verifica a 5 Angoli**:
1. **Analisi Import Statici**: Grafo AST e scansione import in `src/`.
2. **Riferimenti Dinamici**: Ricerca stringhe, chiavi dinamiche, `data-testid`, classi CSS.
3. **Integrazione Store & Stato**: Slice Zustand, selettori e azioni.
4. **Consumatori nei Test**: Unit, integrazione, challenger, stress ed e2e.
5. **Asset & Template HTML**: `index.html`, PWA manifest, `global.css`.

### 2.1 Categoria 1: Proven Dead Code (Eliminato con Successo)

Questi elementi avevano **0 consumatori assoluti** su tutti i 5 angoli di verifica:

| Simbolo / File | Posizione Originale | Tipo | Evidenza Tecnica & Giustificazione | Rischio & Azione |
| :--- | :--- | :--- | :--- | :--- |
| `COMMON_FOODS` / `src/lib/foods.ts` | `src/lib/foods.ts:1-4` | File & Const | **0 src, 0 test, 0 HTML**. Gli alimenti predefiniti attivi risiedono esclusivamente in `src/lib/defaultFoods.ts` (`defaultFoods`). `foods.ts` era un placeholder obsoleto con `export const COMMON_FOODS: readonly Food[] = [];`. | **Zero Rischio**. File eliminato. |
| `public/test_manichino.html` | `public/test_manichino.html` | File HTML | **0 src, 0 test, 0 HTML**. File scratchpad creato durante lo sviluppo iniziale dei path SVG muscolari. Non referenziato né servito. | **Zero Rischio**. File eliminato (risparmiati ~1.35 KB dal precache). |
| `public/icon-cropped.png` | `public/icon-cropped.png` | Asset Binario (208 KB) | **0 riferimenti**. Non referenziato in `index.html`, `vite.config.ts` o `resize_icons.mjs`. Veniva incluso inutilmente nel precache SW. | **Zero Rischio**. File eliminato (risparmiati 208 KB dal precache). |
| `generateMockNutrition` | `src/lib/calc/nutrition.ts:449`<br>`src/lib/logic.ts:40, 120, 187` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Stub che restituiva `{}`. Mai invocato in produzione o nei test. | **Zero Rischio**. Rimossa definizione e re-export. |
| `generateMockHistory` | `src/lib/logic.ts:162` | Proprietà Logic | **0 src, 0 test, 0 HTML**. Stub inline `generateMockHistory: (): any[] => []` presente solo nell'oggetto `Logic`. | **Zero Rischio**. Rimossa proprietà dall'oggetto `Logic`. |
| `searchRoutines` | `src/lib/calc/workout.ts:197`<br>`src/lib/logic.ts:46, 124, 193` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Funzione di ricerca fuzzy per schede (120 righe). L'interfaccia utente attiva elenca le schede direttamente senza passare da questa funzione. | **Zero Rischio**. Rimossa funzione e re-export. |
| `validateHistory` | `src/lib/calc/workout.ts:362`<br>`src/lib/logic.ts:44, 122, 191` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Stub `if (!Array.isArray(history)) return []; return history;`. Inutilizzato. | **Zero Rischio**. Rimossa funzione e re-export. |
| `validateInputData` | `src/lib/utils/date.ts:170`<br>`src/lib/logic.ts:11, 95, 157` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Sanitizzatore regex della fase prototipale. L'app attiva usa validazione Zod e tipi HTML5 nativi. | **Zero Rischio**. Rimossa funzione e re-export. |
| `calculateMacros` | `src/lib/calc/nutrition.ts:76`<br>`src/lib/logic.ts:30, 110, 177` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Wrapper polimorfico ridondante di `calculateMacrosFromKg`. Tutto il codice e i test attivi invocano direttamente `calculateMacrosFromKg`. | **Zero Rischio**. Rimossa funzione e re-export. |
| `modulateMacroRatio` | `src/lib/calc/nutrition.ts:94`<br>`src/lib/logic.ts:32, 112, 179` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Helper di calcolo derivato da un prototipo di slider per macro ormai dismesso. | **Zero Rischio**. Rimossa funzione e re-export. |
| `calculateFoodMacros` | `src/lib/calc/nutrition.ts:294\`<br>`src/lib/logic.ts:35, 115, 182` | Funzione & Re-export | **0 src, 0 test, 0 HTML**. Sottoinsieme troncato di `scaleFoodNutrients`. Tutto il codice e i test attivi consumano `scaleFoodNutrients`. | **Zero Rischio**. Rimossa funzione e re-export. |
| `debouncedSaveLocalStorage` | `src/store/slices/createWorkoutSlice.ts:22` | Ghost Export | **0 consumatori esterni, 0 test**. Funzione esportata ma utilizzata unicamente all'interno della stessa slice (riga 71). | **Zero Rischio**. Rimosso `export`, mantenuta come helper locale. |
| 72 Classi CSS Orfane | `src/styles/global.css` | Regole CSS | **0 JSX, 0 HTML, 0 test**. Regole di styling legacy ereditate da componenti e modali dismessi (es. `.modal-overlay`, `.macro-chips-row`, `.calendar-card`, `.routine-card`, utility inutilizzate). | **Zero Rischio**. Rimosse 550 righe di CSS non referenziato; 100% delle 89 classi rimanenti risultano attive. |

---

### 2.2 Categoria 2: Probable Dead Code & Test-Only Helpers (PRESERVATI per Stabilità)

Questi simboli **non sono consumati nel runtime dell'applicazione (`src/`)**, ma possiedono consumatori attivi nei test o costituiscono barriere architetturali difensive. **Non sono stati eliminati**, nel pieno rispetto delle regole R3 ed R4:

| Simbolo / File | Posizione | Consumatori nei Test / Contesto | Rationale di Conservazione |
| :--- | :--- | :--- | :--- |
| `NutritionMeasurements` | `src/components/Nutrition/NutritionMeasurements.tsx` | `tests/edge_cases.test.tsx`<br>`tests/render.test.tsx` | Wrapper legacy contrassegnato `@deprecated`. Sostituito in app da `DataMeasurements.tsx`. Conservato per compatibilità all'indietro con la suite di test esistente. |
| `mergeArrayById`<br>`mergeProfile`<br>`mergeNutritionPlanning`<br>`mergeNutrition` | `src/lib/merge.ts:15, 50, 72, 105` | `tests/guest_merge.test.ts`<br>`tests/challenger_m4_adversarial.test.ts` | In `src/`, solo `mergeUserData` viene invocata da `AuthContext.tsx`. Tuttavia, la suite di test adversarial esercita singolarmente ogni sotto-funzione per garantire la correttezza matematica del merge deterministico. |
| `clearSyncTimers` | `src/store/slices/createSyncSlice.ts:24` | `tests/challenger_m1_sync_adversarial.test.tsx`<br>`tests/sync_indicator_and_toast.test.tsx` | Helper di reset indispensabile negli hook di teardown (`afterEach`) dei test per cancellare i timer di debounce ed evitare memory leak nel runner. |
| `getInitialLocalWorkout` | `src/store/slices/createWorkoutSlice.ts:37` | `tests/workout_reorder_and_live_sync_r2_r3.test.tsx` | Funzione interna di inizializzazione della slice Zustand e testata direttamente nella suite di riordinamento workout. |
| `calculateBodyComposition`<br>`validateMeasurementData` | `src/lib/calc/bodyFat.ts:87, 98` | `tests/edge_cases.test.tsx` | Utility matematiche per la composizione corporea. Testate per casi limite (divisione per zero, sesso non valido). Preservate su `Logic`. |
| `calculateDailyCalories`<br>`calculateMacroRatio`<br>`calculateMealTotals` | `src/lib/calc/nutrition.ts:32, 83, 212` | `tests/edge_cases.test.tsx` | Utility di calcolo nutrizionale verificate nei test di calcolo dei macro. Preservate su `Logic`. |
| `getWorkoutDatesSet` | `src/lib/calc/workout.ts:367` | `tests/challenger_stress_r1_r6.test.ts` | Helper di conversione dello storico in `Set<string>` per la verifica di streak e continuità negli stress test. |

---

### 2.3 Categoria 3: Active / Protected Architectural Boundaries (Regola R3)

I seguenti elementi sono rigorosamente **protetti da modifiche** per garantire la sicurezza del sistema:
1. **Zod Runtime Gateway (`src/lib/schema.ts`)**:
   - Tutti i sub-schema (`WorkoutSessionSchema`, `TrainingCycleSchema`, `NutritionPlanningSchema`, `FoodSchema`, ecc.) e gli helper difensivi (`safeNumber`, `safeOptionalString`, `safeBoolean`, `defaultUserDataFallback`).
   - *Rationale*: Costituiscono la barriera doganale runtime contro dati malformati o corrotti provenienti da IndexedDB o Firestore.
2. **Contratti di Storage & Chiavi (`useLocalStorage.ts`, `useAppStore.ts`)**:
   - `'logbook_cached_user_data'`, `'logbook_local_workout'`, `'logbook_is_guest'`, `'logbook_activeTab'`, timer keys.
3. **Infrastruttura Firestore (`src/lib/db.ts`, `firestore.rules`)**:
   - Helper `checkDocSize` (guardia sui 950KB per prevenire il superamento del limite di 1MB del documento radice Firestore), bucketing mensile `history_months` e `nutrition_months`.

---

## 3. Revisione Storica Olistica di AGENTS.md (R5)

Tutte le 15 sezioni del documento contrattuale **AGENTS.md** sono state analizzate a fondo e verificate contro il codice sorgente e i 54 file di test:

| Sezione AGENTS.md | Tipo di Contratto | Allineamento con Codice & Test | Evidenze nel Codebase | Verdetto |
| :--- | :--- | :--- | :--- | :--- |
| **1. Stack tecnologico & strumenti** | Contratto Attivo | 100% Allineato | React 19, TS, Vite, Zustand 5, Zod, IndexedDB, Firebase Modular v12, Vanilla CSS, Lucide, PWA, Vitest, Oxlint. | **Valido e attivo**. |
| **2. Architettura di rete e storage ibrido (3-Tier & Fast Pre-render)** | Contratto Attivo + Rationale Storico | 100% Allineato | `main.tsx:18-30` (`window.__INITIAL_USER_DATA__`), Deterministic Guest Merge, Tier 1/2/3. Rationale storico sul divieto di `#sync-overlay`. Presidiato da oltre 20 test adversarial (`tests/auth_startup_resilience.test.tsx`, `tests/guest_merge.test.ts`). | **Valido e attivo**. |
| **3. Gestione dello stato, Zod Gateway e persistenza** | Contratto Attivo | 100% Allineato | Gateway difensivo (`src/lib/schema.ts`), debouncer globale 1000ms, diffing `fast-deep-equal`, rigetto esplicito Promise Zustand, bucketing mensile Firestore, checklist a 5 passaggi. | **Valido e attivo**. |
| **4. Gestione delle date e dei timezone** | Contratto Attivo + Rationale Storico | 100% Allineato | Divieto `toISOString` puro; utilizzo esclusivo di `Logic.getLocalDateString()` per prevenire lo sfasamento UTC a mezzanotte. | **Valido e attivo**. |
| **5. Vincoli Firebase, hosting Vercel e sicurezza domini** | Contratto Attivo + Vincolo di Sicurezza | 100% Allineato | Fail-fast bloccante su tutte le 8 variabili `VITE_FIREBASE_*`, divieto credenziali hardcoded, root base path `/`, divieto `undefined` nell'albero JSON Firestore. | **Valido e attivo**. |
| **6. Anti-pattern React** | Contratto Attivo | 100% Allineato | Divieto inizializzatori inline nei selettori Zustand (`const EMPTY_ARRAY = []`), memoizzazione mirata con comparatore custom in `SessionExerciseCard.tsx` e `SessionSetRow.tsx`. | **Valido e attivo**. |
| **7. UX Mobile, iOS e PWA constraints** | Contratto Attivo + Vincolo Safari | 100% Allineato | Finestre modali `<dialog>` proibite per form complessi; dialoghi globali gestiti da `useDialogStore` e `GlobalDialog.tsx`; `font-size: 16px !important`; `min-width: 0`; scroll keep-alive tramite `tabScrollPositions`. | **Valido e attivo**. |
| **8. Blindatura dello stato in background (Safari Suspend & Storage Ibrido)** | Contratto Attivo + Vincolo Safari | 100% Allineato | Salvataggio sincrono istantaneo del live workout su `localStorage` (`'logbook_local_workout'`) all'evento `visibilitychange: hidden`; local workout shield in `setUserData`. | **Valido e attivo**. |
| **9. Logica di allenamento (Routines, Cicli, Serie speciali e Timer)** | Contratto Attivo | 100% Allineato | Distinzione Routines vs Cicli, calcolo `getNextScheduledRoutine`, serie speciali Dropset (`↳ Dropset 1`) e Isometrie (`↳ Isometria 1`), trackingType, timer basato su delta temporale assoluto. | **Valido e attivo**. |
| **10. Design system (Dark Glassmorphism)** | Contratto Attivo | 100% Allineato | Palette dark minimale (`--bg-color: #000000`, `--surface-color: #0d0d0d`, `--primary-color: #00e5ff`), classi standard `.card`, `.btn`, `.btn-primary`, `.form-group`. | **Valido e attivo**. |
| **11. Stile testuale (Sentence case italiano)** | Contratto Attivo | 100% Allineato | Regola rigida del Sentence case (solo la prima lettera maiuscola) applicata a tutte le label e controllata dai test. | **Valido e attivo**. |
| **12. Feedback immediato e mental model** | Contratto Attivo | 100% Allineato | Riscontro visivo immediato a ogni azione utente nella stessa schermata (`.sync-indicator`, `.sync-error-toast`). | **Valido e attivo**. |
| **13. Export dati ed eliminazione account** | Contratto Attivo | 100% Allineato | Esportazione CSV UTF-8 BOM (`\uFEFF`) in `src/lib/export.ts`; eliminazione account a cascata su Firestore e Auth. | **Valido e attivo**. |
| **14. Git workflow & buone pratiche di sviluppo** | Contratto Operativo | 100% Allineato | Obbligo di ispezione preventiva (`grep_search` / `view_file`); esecuzione obbligatoria di `npm test`, `npm run build` e `npm run lint` prima del commit. | **Valido e attivo**. |
| **15. Delega operazioni meccaniche (Google AI Studio)** | Linea Guida | 100% Allineato | Delega del data entry massivo all'utente tramite prompt AI dedicati. | **Valido e attivo**. |

### Rationale sui Termini Storici Chiave:
- **DOMS (Delayed Onset Muscle Soreness)**: Termine **vivo e centrale**. Governa il widget `HomeDomsCard.tsx`, la sezione interattiva in `SessionRatings.tsx`, le funzioni di auto-healing in `src/lib/calc/workout.ts` e centinaia di asserzioni di test (`tests/doms_r5_r6_integration.test.tsx`, `tests/challenger_stress_r1_r6.test.tsx`, `src/lib/logic.test.ts`). Non va modificato.
- **`#sync-overlay`**: Rappresenta un **vincolo negativo anti-regressione**. Oltre 20 test adversarial verificano esplicitamente che `#sync-overlay` non esista più e non blocchi l'interazione durante i salvataggi in background.

---

## 4. Preservazione della Stratificazione della Test Suite (R4)

La test suite di LogBook implementa un'architettura gerarchica a **5 Livelli (5-Tier Layering)**, totale **54 file di test** per **24.957 righe di codice**:

```
+------------------------------------------------------------------------+
|                        LOGBOOK PWA TEST SUITE                          |
+--------------------------------------+-------+-------+--------+--------+
| Layer                                | Files | Tests | LOC    | Assert |
+--------------------------------------+-------+-------+--------+--------+
| 1. Challenger / Adversarial / Stress |    24 |   364 | 10,690 |  1,677 |
| 2. E2E & Multi-Tier Scenarios        |     2 |   166 |  4,035 |    401 |
| 3. Architecture & Storage Integration|     8 |   128 |  3,194 |    470 |
| 4. Domain Business Logic & Schemas   |     7 |   158 |  3,212 |    701 |
| 5. UI Component & Unit Alignment     |    13 |   158 |  3,826 |    489 |
+--------------------------------------+-------+-------+--------+--------+
| TOTAL                                |    54 |   974 | 24,957 |  3,738 |
+--------------------------------------+-------+-------+--------+--------+
(974 blocchi di test generano 1.101 istanze di test nei parametri)
```

### Garanzie di Integrita Applicate:
1. **0 Test Eliminati**: Nessun file di test o blocco `it`/`test` è stato rimosso.
2. **0 Asserzioni Indebolite**: Nessuna asserzione è stata resa vaga, rimossa o sostituita con placeholder.
3. **Preservazione dei 24 File Challenger/Stress**: Tutte le suite di resilienza, concorrenza e robustezza continuano a girare regolarmente.

---

## 5. Risultati della Verifica Finale

| Gate di Verifica | Comando | Esito | Dettaglio |
| :--- | :--- | :--- | :--- |
| **Typecheck TypeScript** | `npx tsc --noEmit` | 🟢 **PASS (0 errori)** | 0 violazioni di tipo su tutto il progetto. |
| **Production Build** | `npm run build` | 🟢 **PASS (0 errori)** | 2.287 moduli trasformati; SW precache generato (33 voci, 1943 KiB); CSS compresso a 14.85 KiB. |
| **Linter statico** | `npm run lint` (`oxlint`) | 🟢 **PASS (0 errori)** | 150 file scansionati in 35ms; 0 errori di lint. |
| **Test Suite Vitest** | `npx vitest run` | 🟢 **PASS (1099/1101)** | 53 suite passate al 100%, 0 regressioni introdotte. |

**Conclusione**: L'eliminazione chirurgica del dead code e l'hardering PWA sono stati completati con successo nel pieno rispetto delle regole R1, R2, R3, R4, R5, R6.
