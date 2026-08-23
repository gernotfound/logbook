# Handoff Report: R2 Technical Investigation & Implementation Blueprint

## 1. Observation

### Codebase Paths & Line References
1. **`src/hooks/workout/useWorkoutSetMutations.ts` (righe 50-58)**:
   ```typescript
   const reorderExercises = useCallback((fromIndex: number, toIndex: number) => {
       setLocalWorkout((prev) => {
           if (!prev) return prev;
           const newExercises = [...prev.exercises];
           const [removed] = newExercises.splice(fromIndex, 1);
           newExercises.splice(toIndex, 0, removed);
           return { ...prev, exercises: newExercises };
       });
   }, [setLocalWorkout]);
   ```
   - **Osservazione**: La funzione `reorderExercises` esistente non valida `fromIndex` né `toIndex`. Non controlla se `fromIndex === toIndex`, se gli indici sono negativi (`< 0`) o oltre la lunghezza dell'array (`>= total`). Non verifica la presenza di `prev.exercises`. Inoltre, non è definita una funzione comoda `moveExercise(index, direction)`.
2. **`src/components/Training/session/SessionExerciseCard.tsx` (righe 118-144, 320-330)**:
   - L'header contiene solo i pulsanti `🗑️`, `🕒 Storico` e `⚙️ Setup`. Non sono presenti i pulsanti ⬆️ e ⬇️ per lo spostamento.
   - L'interfaccia `SessionExerciseCardProps` non include `totalExercises` né `onMoveExercise`.
   - Il comparatore personalizzato di `React.memo` (righe 320-330) monitora `exItem`, `libDef`, `pastWorkouts`, `isHistoryOpen`, `isSetupOpen`, `openSpecialMenuId`, `exIndex`, ma omette `totalExercises`.
3. **`src/components/Training/TrainingSession.tsx` (righe 72-74, 109-114, 392-421)**:
   - `openHistoryExIndex` e `openSetupExIndex` sono memorizzati come indici numerici (`number | null`). Quando due esercizi vengono scambiati di posto, tali indici non venivano riallineati, provocando lo shift indesiderato del pannello aperto sul nuovo esercizio adiacente.
   - La chiave React passata alla card (riga 398) è `key={exItem.id || \`${exItem.exId}_${exIndex}\`}`. Poiché `SessionExercise` non riceveva un `id` generato alla creazione, la chiave variava al mutare di `exIndex`, forzando React a distruggere e ricreare il DOM.
4. **`src/types.ts` & `src/lib/schema.ts`**:
   - In `src/types.ts:89-95`, `SessionExercise` non dichiarava `id?: string;`.
   - In `src/lib/schema.ts:198-204`, `SessionExerciseSchema` non includeva `id: safeOptionalString()`.
5. **Comandi eseguiti**:
   - `npm.cmd test`: 40 test files passati, 746 test passati con successo.
   - `npm.cmd run build`: `tsc --noEmit && vite build` completato in 6.70s con zero errori.

---

## 2. Logic Chain

1. **Dall'osservazione dei limiti dell'array in `useWorkoutSetMutations.ts`**:
   - `Array.prototype.splice` tratta gli indici negativi come offset dalla fine dell'array. Se un indice non valido (es. `-1`) viene passato, l'array viene corrotto silenziosamente.
   - Introducendo una guard clause `if (fromIndex < 0 || fromIndex >= total || toIndex < 0 || toIndex >= total || fromIndex === toIndex) return prev;`, qualsiasi mutazione illegale viene intercettata a monte in modo immutabile.
2. **Dall'osservazione dell'interazione utente in `SessionExerciseCard.tsx`**:
   - Gli utenti necessitano di controlli visivi chiari a passo unitario (`⬆️` e `⬇️`) con feedback immediato e disabilitazione visiva (`opacity: 0.3`, `cursor: not-allowed`).
   - L'inserimento nell'header a destra del titolo preserva lo spazio per la digitazione delle serie.
   - I pulsanti con dimensioni $\ge 36\text{px}$ e padding touch garantiscono l'usabilità con una mano sola in palestra.
   - L'aggiornamento di `React.memo` con `prev.totalExercises === next.totalExercises` assicura che il re-render sia mirato solo quando cambia il conteggio o l'indice degli esercizi.
3. **Dall'osservazione della gestione dello stato in `TrainingSession.tsx`**:
   - L'aggiornamento sincrono di `openHistoryExIndex` e `openSetupExIndex` (scambiando `targetIndex` e `index`) mantiene il pannello contestuale aperto esattamente per l'esercizio che l'utente ha mosso.
   - L'assegnazione di `id: Logic.generateId('se')` su `SessionExercise` stabilizza la chiave React nel Virtual DOM, garantendo riordini fluidi senza smontare lo stato interno degli input o il DOM.
4. **Dall'architettura di storage (AGENTS.md & `createWorkoutSlice.ts`)**:
   - L'operazione `reorderExercises` aggiorna `localWorkout` in memoria Zustand ed esegue il debounced save su `localStorage['logbook_local_workout']`, protetto dal listener `visibilitychange` per prevenire perdite in caso di background suspend.

---

## 3. Caveats

1. **Requisito R3 (Gruppi muscolari e sincronizzazione libreria)**:
   - È oggetto di indagine parallela da parte di Explorer 2 / implementatore. In `SessionExerciseCardProps`, l'aggiunta di `totalExercises` ed `onMoveExercise` per R2 è ortogonale e pienamente compatibile con i badge muscolari di R3.
2. **Supporto Drag & Drop**:
   - Non implementato per vincolo esplicito di progetto (prevenzione conflitti scroll mobile/touch). L'approccio con pulsanti ⬆️ / ⬇️ è la soluzione designata e standard.
3. **Dati storici legacy**:
   - Per vecchie sessioni storiche prive di `SessionExercise.id`, il fallback `${exItem.exId}_${exIndex}` e la sanitizzazione in `getInitialLocalWorkout` / `startEditHistoricalWorkout` con `Logic.generateId('se')` garantiscono la retrocompatibilità totale senza migration break.

---

## 4. Conclusion

L'implementazione del requisito R2 è pronta per essere eseguita con precisione chirurgica sui 6 file target:
1. `src/types.ts`: estensione interfaccia `SessionExercise` con `id?: string;`.
2. `src/lib/schema.ts`: aggiornamento `SessionExerciseSchema` con `id: safeOptionalString()`.
3. `src/hooks/workout/useWorkoutSetMutations.ts`: blindatura `reorderExercises` con boundary guards ed export di `moveExercise`.
4. `src/hooks/useWorkoutSession.ts`: esportazione di `moveExercise` e assegnazione `id: Logic.generateId('se')`.
5. `src/components/Training/session/SessionExerciseCard.tsx`: aggiunta pulsanti ⬆️ e ⬇️ con dark glassmorphic styling, touch targets, disabled states, accessibility e aggiornamento `React.memo`.
6. `src/components/Training/TrainingSession.tsx`: implementazione `handleMoveExercise` con riallineamento sincronizzato di `openHistoryExIndex` / `openSetupExIndex` e binding props.

---

## 5. Verification Method

1. **Comandi di verifica del progetto**:
   - Eseguire `npm.cmd test` (deve completarsi con 100% pass rate su tutti i file).
   - Eseguire `npm.cmd run build` (deve compilare con `tsc --noEmit` senza errori di tipo o violazioni di schema).
2. **File da ispezionare**:
   - `src/hooks/workout/useWorkoutSetMutations.ts`
   - `src/components/Training/session/SessionExerciseCard.tsx`
   - `src/components/Training/TrainingSession.tsx`
   - `src/types.ts`
   - `src/lib/schema.ts`
3. **Condizioni di invalidazione**:
   - Se cliccando ⬆️ sul primo esercizio o ⬇️ sull'ultimo l'array `exercises` viene mutato o corrotto.
   - Se aprendo il pannello "Setup" di un esercizio e spostandolo, il pannello salta all'esercizio adiacente.
   - Se `npm.cmd run build` o `npm.cmd test` falliscono.
