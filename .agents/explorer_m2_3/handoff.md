# Handoff Report: Milestone M2 - Explorer 3 (R2 & R3)

**Data**: 2026-08-20  
**Autore**: Explorer 3 (Milestone M2: Schema, Types, React Keys, Storage Integrity & Unit Test Plan)  
**Destinatario**: Sub-Orchestrator M2 (`c8025315-288a-4ea3-9d26-09fefa53d606`)  
**Target Files**: `src/types.ts`, `src/lib/schema.ts`, `src/components/Training/session/SessionExerciseCard.tsx`, `src/components/Training/TrainingSession.tsx`, `src/hooks/workout/useWorkoutSetMutations.ts`, `src/hooks/useWorkoutSession.ts`, `src/store/slices/createWorkoutSlice.ts`, `tests/workout_reorder_and_live_sync_r2_r3.test.tsx`

---

## 1. Observation

1. **`src/types.ts:89-95`**:
   `SessionExercise` è attualmente definita senza il campo `id`:
   ```typescript
   export interface SessionExercise {
       exId: string;
       sessionNote: string;
       sets: SessionExerciseSet[];
       minReps?: number;
       maxReps?: number;
   }
   ```
2. **`src/lib/schema.ts:198-204`**:
   `SessionExerciseSchema` non elenca esplicitamente `id`, ma usa `.passthrough()`:
   ```typescript
   export const SessionExerciseSchema = z.object({
       exId: safeString(''),
       sessionNote: safeString(''),
       sets: z.array(SessionExerciseSetSchema).catch([]).default([]),
       minReps: safeOptionalNumber(),
       maxReps: safeOptionalNumber(),
   }).passthrough().catch({ exId: '', sessionNote: '', sets: [] }).default({ exId: '', sessionNote: '', sets: [] });
   ```
3. **`src/components/Training/TrainingSession.tsx:398`**:
   La chiave React utilizzata nel `.map` degli esercizi è instabile quando `exItem.id` è assente:
   ```tsx
   key={exItem.id || `${exItem.exId}_${exIndex}`}
   ```
4. **`src/components/Training/TrainingSession.tsx:72-73` & `109-114`**:
   Gli stati dei pannelli espansi sono tracciati per indice numerico:
   ```typescript
   const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
   const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
   ```
   Attualmente non vengono riallineati durante lo swap di posizione degli esercizi.
5. **`src/components/Training/session/SessionExerciseCard.tsx:50-51` & `320-330`**:
   - `SessionExerciseCard` estrae `exName = libDef ? libDef.name : ...` ed `exNotes`, ma non renderizza i badge dei muscoli primari (`libDef.muscles`) e secondari (`libDef.secondaryMuscles`) (R3).
   - Il comparatore di `React.memo` non confronta `totalExercises`, necessario per aggiornare lo stato `disabled` del pulsante ⬇️ quando vengono aggiunti/rimossi esercizi extra.
6. **`src/hooks/workout/useWorkoutSetMutations.ts:50-58`**:
   `reorderExercises` effettua `splice` senza verificare che `fromIndex` o `toIndex` siano entro i limiti `[0, prev.exercises.length - 1]`.
7. **Test suite baseline**:
   Eseguito `npm.cmd test`: 40 file di test e 746 test superati con successo (`exit code 0`).
   Eseguito `npm.cmd run lint`: 0 errori (`exit code 0`).
   Eseguito `npm.cmd run build`: bundle compilato con successo (`exit code 0`).

---

## 2. Logic Chain

1. Da **Obs 1** e **Obs 2**, l'aggiunta di `id?: string;` all'interfaccia `SessionExercise` e `id: safeOptionalString()` in `SessionExerciseSchema` fornisce un identificatore univoco deterministico (es. `se_1740000000_abc123`) per ogni istanza di esercizio durante la sessione live.
2. Poiché `safeOptionalString()` trasforma numeri in stringhe, accetta stringhe e restituisce `undefined` in caso di campo assente o corrotto, tutti i dati storici e i workout memorizzati in `localStorage` o `IndexedDB` rimangono perfettamente validi senza regressioni.
3. Da **Obs 3**, quando gli esercizi possiedono un `id` univoco stabile, la chiave React diventa `key={exItem.id}`. Quando due esercizi vengono scambiati di posto (`fromIndex` $\leftrightarrow$ `toIndex`), la chiave React rimane legata all'oggetto esercizio anziché alla posizione dell'array. Di conseguenza, React esegue il reorder dei nodi DOM esistenti senza distruggere i componenti, preservando il focus degli input, il testo non salvato e prevenendo sfarfallii o glitch di rendering.
4. Da **Obs 4**, aggiornando sincronicamente `openHistoryExIndex` e `openSetupExIndex` nella funzione `handleMoveExercise` di `TrainingSession.tsx` (`if (prev === fromIndex) return toIndex; if (prev === toIndex) return fromIndex;`), i pannelli aperti rimangono coerentemente ancorati all'esercizio che l'utente stava visualizzando.
5. Da **Obs 5**, derivando dinamicamente `primaryMuscles` e `secondaryMuscles` tramite `Logic.MUSCLES.find(m => m.id === mId)`, `SessionExerciseCard` mostrerà istantaneamente i badge aggiornati non appena l'utente modifica l'esercizio nella libreria, sfruttando la reattività di Zustand senza richiedere il riavvio della sessione (R3).
6. Da **Obs 6**, introducendo controlli di guardia difensivi su `fromIndex` e `toIndex` in `reorderExercises`, si prevengono mutazioni anomale dell'array anche a fronte di chiamate con indici non validi.
7. Da **Obs 7**, il test plan pianificato per `tests/workout_reorder_and_live_sync_r2_r3.test.tsx` coprirà esaustivamente le mutazioni, i componenti e l'integrazione senza rompere la suite esistente.

---

## 3. Caveats

- **Nessuna dipendenza da librerie di Drag & Drop**: Come da vincolo architetturale (`AGENTS.md` e `ORIGINAL_REQUEST.md`), il riordino deve avvenire esclusivamente tramite pulsanti compatti ⬆️ e ⬇️ ("Su" / "Giù"), senza introdurre librerie pesanti di drag and drop (`framer-motion`, `@dnd-kit`, `react-beautiful-dnd`) che degradano le prestazioni su mobile e confliggono con lo scroll touch.
- **Risoluzione Fallback per Esercizi Rimossi**: Se un esercizio viene eliminato dalla libreria durante una sessione attiva, `libDef` sarà `undefined`. Il componente deve continuare a visualizzare il fallback `"Esercizio rimosso"` e non mostrare badge senza sollevare errori runtime.

---

## 4. Conclusion

L'architettura attuale di LogBook è pienamente predisposta per il completamento pulito di R2 e R3:
- Aggiunta non distruttiva di `id?: string` in `src/types.ts` e `src/lib/schema.ts`.
- Generazione automatica di `id` nei punti di ingresso (`startWorkout`, `addExtraExercise`, `startEditHistoricalWorkout`, `getInitialLocalWorkout`).
- Implementazione robusta di `reorderExercises` e `moveExercise` in `useWorkoutSetMutations.ts`.
- UI con pulsanti ⬆️ e ⬇️ e badge muscolari dinamici in `SessionExerciseCard.tsx`.
- Sincronizzazione degli accordion in `TrainingSession.tsx`.
- Nuova suite di test Vitest in `tests/workout_reorder_and_live_sync_r2_r3.test.tsx`.

Tutti i dettagli e le proposte di codice complete sono documentati in `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_m2_3\analysis.md`.

---

## 5. Verification Method

Per verificare in modo indipendente le conclusioni:
1. **Verifica statica e tipi**:
   ```powershell
   npm.cmd run build
   ```
   (Conferma che `tsc --noEmit` e `vite build` compilano a zero errori).
2. **Verifica linting**:
   ```powershell
   npm.cmd run lint
   ```
3. **Verifica test suite**:
   ```powershell
   npm.cmd test
   ```
4. **Ispezione file analizzati**:
   - `src/types.ts:89-95`
   - `src/lib/schema.ts:198-204`
   - `src/components/Training/session/SessionExerciseCard.tsx`
   - `src/components/Training/TrainingSession.tsx`
   - `src/hooks/workout/useWorkoutSetMutations.ts`
   - `src/store/slices/createWorkoutSlice.ts`
