# Report di Indagine Tecnica: Tracciamento Dolori (DOMS) e Auto-Guarigione (R5 & R6)

## 1. Executive Summary
Questa indagine approfondita analizza l'architettura del codebase di **LogBook** per l'implementazione dei requisiti **R5** (Tracciamento Dolori muscolari / DOMS in Home e a fine sessione con manichino SVG interattivo e ricerca testuale) e **R6** (Logica di auto-guarigione automatica dei dolori al salvataggio della sessione).

Tutti i componenti necessari (manichino SVG `MuscleModel`, percorsi anatomici `MuscleModelPaths`, mappature muscolari `Logic.MUSCLES` e `Logic.GROUP_MAP`, motore di ricerca fuzzy `Fuse.js`, algoritmi di espansione simmetrica `toggleSmartMuscleSelection`, pipeline di persistenza a 3 livelli e Zod Gateway) sono già presenti e pienamente operativi nel codebase.

---

## 2. Analisi dei Componenti del Manichino SVG

### 2.1 `src/components/Training/MuscleModel.tsx`
- **Ruolo**: Componente React che renderizza il manichino anatomico SVG fronte/retro.
- **Props supportate**:
  ```ts
  interface MuscleModelProps {
      selectedMuscles?: string[];
      secondaryMuscles?: string[];
      muscleColors?: Record<string, string>;
      interactive?: boolean;
      onToggleMuscle?: (muscleId: string) => void;
  }
  ```
- **Meccanismo di colorazione custom (`muscleColors`)**:
  - La prop `muscleColors` accetta una mappa `Record<string, string>` (es. `{ chest: 'var(--danger-color, #ef4444)', biceps_left: 'var(--danger-color, #ef4444)' }`).
  - La funzione interna `getPathStyle(id)` verifica se `id` (percorso SVG atomico) o `logicId = REVERSE_GROUP_MAP[id]` (ID logico di alto livello) o una chiave di `Logic.GROUP_MAP` corrisponde a una voce in `muscleColors`.
  - In caso di corrispondenza, applica il colore impostato con transizione CSS fluida (`transition: 'fill 0.3s ease'`).
- **Interattività (`interactive={true}`)**:
  - Quando `interactive={true}`, il cursore diventa `pointer` e l'evento `onClick` sul target SVG ricava il `logicId` tramite `REVERSE_GROUP_MAP` e invoca `onToggleMuscle(logicId)`.
- **Tooltip anatomico**:
  - Al passaggio del mouse (`onMouseMove`), su dispositivi non-touch viene visualizzato un tooltip elegante (`position: fixed`, dark glassmorphic) con il nome del muscolo in lingua italiana ricavato da `MUSCLE_NAMES_MAP`.

### 2.2 `src/components/Training/MuscleModelPaths.tsx`
- Contiene la definizione vettoriale di tutti i percorsi SVG anatomici (fronte e retro), suddivisi per gruppi e laterali (`chest-upper-left`, `chest-lower-left`, `shoulder-front-left_1`, `biceps-left_1`, `nape_1`, `traps-upper-left`, `lats-mid-left`, `quads-left_1`, `gluteus-maximus-left`, ecc.).

### 2.3 `src/lib/constants/muscles.ts` (e `src/lib/logic.ts`)
- **`MUSCLES`**: Array di 76 definizioni muscolari con ID e nomi localizzati in italiano (es. `{ id: 'chest', name: 'Petto' }`, `{ id: 'biceps', name: 'Bicipiti' }`, `{ id: 'biceps_left', name: 'Bicipite sinistro' }`).
- **`GROUP_MAP`**: Mappa che associa ciascun ID logico/composto all'elenco dei percorsi SVG atomici corrispondenti in `MuscleModelPaths.tsx`.

---

## 3. Motore di Ricerca e Selezione Muscoli (Search-Select)

### 3.1 Algoritmo di Ricerca Fuzzy e Stemming Italiano
- Riferimento principale: `src/hooks/useTrainingExercises.ts` (righe 7-50 e 102-150).
- **Funzione `normalizeStem`**: Normalizza le declinazioni anatomiche italiane (es. `pettorali` / `pettorale` $\rightarrow$ `petto`, `bicipiti` $\rightarrow$ `bicipit`, `deltoidi` $\rightarrow$ `deltoid`, `quadricipiti` $\rightarrow$ `quadricipit`).
- **Istanza statica `STATIC_MUSCLE_FUSE`**: Istanza pre-calcolata di `Fuse.js` sulle definizioni muscolari per query istantanee O(1) con soglia di confidenza 0.38.
- **Ordinamento dei risultati**: Combina corrispondenze dirette e fuzzy, ordinando per rilevanza semantica e prefissi.

### 3.2 Espansione e Contrazione Simmetrica (`toggleSmartMuscleSelection`)
- Riferimento: `src/hooks/useTrainingExercises.ts` (righe 151-208).
- Gestisce intelligentemente la simmetria corporea:
  - Se l'utente seleziona sia `biceps_left` che `biceps_right`, la selezione si contrae automaticamente in `biceps`.
  - Se l'utente seleziona `biceps`, vengono coinvolti entrambi i lati; cliccando su un solo lato si disattiva solo quello.

---

## 4. Integrazione UI Home e Fine Sessione (R5)

### 4.1 Card Dolori in `HomeView.tsx`
- **File target**: `src/components/Home/HomeView.tsx` e `src/hooks/useHomeView.ts`.
- **Posizionamento**: Sotto `HomeWorkoutWidget` (riga 43) o come card dedicata sopra/accanto alla panoramica.
- **Struttura della Card**:
  - **Header**: `⚡ Dolori muscolari (DOMS)` con badge numerico `(N attivi)` o badge di stato.
  - **Input di ricerca**: `<input type="text" placeholder="🔍 Cerca muscolo dolorante..." />` con pulsante `✕` di reset e dropdown dei risultati filtrati.
  - **Chips / Badge muscoli doloranti**: Elenco dei muscoli attualmente in `activePains` con pulsante `✕` per la rimozione rapida con feedback visivo immediato.
  - **Manichino SVG**: Componente `<MuscleModel />` con `interactive={true}`, `muscleColors` che colora in `var(--danger-color, #ef4444)` tutti i muscoli doloranti, e `onToggleMuscle` per il toggle diretto al click.
  - **Persistenza**: Ogni aggiunta o rimozione richiama `useAppStore.getState().saveUserData((prev) => ({ ...prev, activePains: updatedPains }))`.

### 4.2 Editor Dolori a Fine Sessione in `TrainingSession.tsx` / `SessionRatings.tsx`
- **File target**: `src/components/Training/TrainingSession.tsx` e `src/components/Training/session/SessionRatings.tsx`.
- **Posizionamento**: Nella sezione di valutazione finale ("Valuta sessione", righe 454-464 di `TrainingSession.tsx`).
- **Struttura del Componente**:
  - Tasto/Accordion: `"⚡ Dolori muscolari (DOMS)"` con badge contatore dei dolori correnti.
  - All'espansione, mostra:
    - Input di ricerca con completamento automatico per selezionare nuovi muscoli indolenziti.
    - Badges dei dolori selezionati con pulsante `✕`.
    - Manichino SVG `<MuscleModel />` con muscoli doloranti evidenziati in rosso.
  - I dolori selezionati sono tracciati nel workout attivo (`localWorkout.pains` o stato locale della sessione).

---

## 5. Checklist Obbligatoria in 5 Passaggi (+ Rules & Merge) per `UserData.activePains`

In base alle regole architetturali di `AGENTS.md` (Sezione 3), l'introduzione di `activePains` richiede l'aggiornamento coerente di tutti i seguenti file:

### Passaggio 1: `src/types.ts`
- Aggiungere `activePains?: string[];` all'interfaccia `UserData`:
  ```ts
  export interface UserData {
      profile?: UserProfile;
      library?: Exercise[];
      routines?: WorkoutRoutine[];
      history?: WorkoutSession[];
      nutrition?: Record<string, NutritionDay>;
      customFoods?: Food[];
      activeWorkout?: WorkoutSession | null;
      nutritionPlanning?: NutritionPlanning;
      trainingCycles?: TrainingCycle[];
      activeCycleId?: string | null;
      supplements?: Supplement[];
      activePains?: string[]; // <--- Nuova proprietà R5/R6
  }
  ```
- Opzionale (per tracciamento sessione): aggiungere `pains?: string[];` a `WorkoutSession`.

### Passaggio 2: `src/lib/schema.ts` (Zod Gateway)
- Aggiornare `defaultUserDataFallback`:
  ```ts
  export const defaultUserDataFallback: UserData = {
      profile: {},
      library: [],
      routines: [],
      history: [],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      nutritionPlanning: undefined,
      trainingCycles: [],
      activeCycleId: null,
      supplements: [],
      activePains: [] // <--- Valore di default difensivo
  };
  ```
- Registrare il sub-schema in `UserDataSchema`:
  ```ts
  export const UserDataSchema = z.object({
      profile: UserProfileSchema.optional().catch({}).default({}),
      library: z.array(ExerciseSchema).optional().catch([]).default([]),
      routines: z.array(WorkoutRoutineSchema).optional().catch([]).default([]),
      history: z.array(WorkoutSessionSchema).optional().catch([]).default([]),
      nutrition: z.record(z.string(), NutritionDaySchema).optional().catch({}).default({}),
      customFoods: z.array(FoodSchema).optional().catch([]).default([]),
      activeWorkout: WorkoutSessionSchema.nullable().optional().catch(null).default(null),
      nutritionPlanning: NutritionPlanningSchema.optional().catch(undefined),
      trainingCycles: z.array(TrainingCycleSchema).optional().catch([]).default([]),
      activeCycleId: z.union([z.string(), z.null()]).optional().catch(null).default(null),
      supplements: z.array(SupplementSchema).optional().catch([]).default([]),
      activePains: z.array(safeString()).optional().catch([]).default([]), // <--- Zod Schema
  }).passthrough().catch(defaultUserDataFallback).default(defaultUserDataFallback);
  ```
- Aggiungere il parser in `DomainParsers`:
  ```ts
  parseActivePains: (data: unknown) => {
      const arr = Array.isArray(data) ? data : [];
      return arr.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  ```

### Passaggio 3: `src/lib/db.ts` (Firestore I/O)
- In `DB.loadUserData`:
  - Dichiarare `activePains: []` nell'oggetto iniziale `state`.
  - Mappare da `docSnap.data()`: `if (data.activePains) state.activePains = data.activePains;`.
  - Validare con domain parser: `state.activePains = DomainParsers.parseActivePains(state.activePains);`.
- In `DB.saveUserData`:
  - Dichiarare `activePains: []` in `oldState`.
  - Includere `!deepEqual(state.activePains, oldState.activePains)` nella condizione di update del documento utente principale (`users/{uid}`).
  - Serializzare `activePains: state.activePains || []` in `userDocData`.

### Passaggio 4: `src/contexts/AuthContext.tsx`
- Includere `activePains: []` nell'oggetto `defaultUserData` (riga 17).

### Passaggio 5: `src/lib/export.ts`
- Verificare che le funzioni di esportazione CSV non vengano influenzate negativamente da `activePains`.

### Passaggio 6 (Critico per Firestore Rules): `firestore.rules`
- Nel blocco `match /users/{userId}` (riga 33-43), aggiungere `'activePains'` alla whitelist `incomingData().keys().hasOnly([...])`.

### Passaggio 7 (Critico per Guest Login & Merge): `src/lib/merge.ts`
- In `mergeUserData`:
  ```ts
  activePains: Array.from(new Set([
      ...(cloud.activePains || []),
      ...(guest.activePains || [])
  ]))
  ```
- In `hasUserData`: includere `(data.activePains && data.activePains.length > 0)` nel controllo dei dati creati dall'utente.

---

## 6. Logica di Guarigione Automatica Dolori (R6)

### 6.1 Flusso di Esecuzione in `endWorkout` (`src/hooks/useWorkoutSession.ts`)
Quando l'utente termina l'allenamento premendo "🏁 Termina sessione" (`endWorkout`, righe 239-278):

1. **Recupero dello stato corrente**:
   - `localWorkout` attivo contenente gli esercizi svolti (`finishedWorkout.exercises`).
   - `userData.library` per mappare ciascun `exId` alla relativa definizione (incluso `muscles`, ovvero i muscoli primari).
   - `userData.activePains` (elenco dei dolori attivi prima della sessione).
   - `sessionPains` (elenco dei dolori eventualmente selezionati/modificati dall'utente nel pannello "Dolori" a fine sessione).

2. **Estrazione dei muscoli primari allenati**:
   ```ts
   const trainedPrimaryMuscles = new Set<string>();
   (finishedWorkout.exercises || []).forEach(ex => {
       const libEx = libraryMap.get(ex.exId);
       if (libEx && Array.isArray(libEx.muscles)) {
           libEx.muscles.forEach(mId => {
               if (mId) {
                   trainedPrimaryMuscles.add(mId);
                   // Espansione laterale (es. chest -> chest_left, chest_right)
                   trainedPrimaryMuscles.add(`${mId}_left`);
                   trainedPrimaryMuscles.add(`${mId}_right`);
               }
           });
       }
   });
   ```

3. **Riconciliazione e Auto-guarigione**:
   - Se un muscolo era dolorante in `activePains`:
     - Se appartiene a `trainedPrimaryMuscles` ed è stato ri-selezionato esplicitamente in `sessionPains` $\rightarrow$ rimane dolorante.
     - Se appartiene a `trainedPrimaryMuscles` e **non** è stato selezionato in `sessionPains` (o il form è rimasto vuoto/non compilato per quel muscolo) $\rightarrow$ viene rimosso silenziosamente (guarito!).
     - Se **non** è stato allenato come primario in questa sessione $\rightarrow$ rimane tra i dolori attivi (a meno che l'utente non lo abbia deselezionato esplicitamente).
   - Eventuali nuovi dolori aggiunti in `sessionPains` vengono inclusi nella lista finale.

4. **Salvataggio atomico in Zustand & Cloud**:
   ```ts
   await saveUserData((prev) => {
       if (!prev) return prev;
       return {
           ...prev,
           history: [finishedWorkout, ...(prev.history || [])],
           activeWorkout: null,
           activePains: finalActivePains
       };
   });
   ```

---

## 7. Mappatura dei File e Linee Guida di Modifica

| File | Righe di riferimento | Modifica prevista |
|---|---|---|
| `src/types.ts` | Righe 98-117, 225-237 | Aggiunta `activePains?: string[]` in `UserData` e `pains?: string[]` in `WorkoutSession` |
| `src/lib/schema.ts` | Righe 340-370 | Aggiunta `activePains` in `UserDataSchema`, `defaultUserDataFallback` e `DomainParsers` |
| `src/lib/db.ts` | Righe 36-90, 150-200 | Mapping e diffing `activePains` in `loadUserData` e `saveUserData` |
| `src/contexts/AuthContext.tsx` | Riga 17-33 | Aggiunta `activePains: []` in `defaultUserData` |
| `src/lib/merge.ts` | Righe 184-236 | Merge deterministico `activePains` in `mergeUserData` e check in `hasUserData` |
| `firestore.rules` | Righe 33-43 | Aggiunta `'activePains'` nella whitelist `incomingData().keys().hasOnly([...])` |
| `src/hooks/useWorkoutSession.ts` | Righe 239-278 | Implementazione logica di auto-guarigione in `endWorkout` |
| `src/components/Training/session/SessionRatings.tsx` (o `TrainingSession.tsx`) | Righe 24-94 | Sezione a tendina "Dolori" con ricerca, chips e manichino SVG interattivo |
| `src/components/Home/HomeView.tsx` | Righe 38-87 | Card "Dolori muscolari" con manichino SVG interattivo e ricerca per toggle immediato |
| `src/hooks/useHomeView.ts` | Righe 89-105, 388-397 | Esposizione `activePains` e `painColors` allo stato di `HomeView` |

---

## 8. Strategia di Test & Validazione

Per garantire la massima robustezza e prevenire regressioni, la suite di test dovrà verificare:
1. **Zod Gateway Resilience**: `UserDataSchema.parse()` preserva correttamente `activePains` senza scartare o corrompere l'array.
2. **Deterministic Guest Merge**: La fusione dei dati Guest e Cloud preserva e deduplica correttamente i dolori attivi.
3. **Interactive UI Toggles**:
   - Il click su un muscolo nel manichino in `HomeView` o in `TrainingSession` colora il muscolo di rosso (`#ef4444`).
   - La ricerca testuale trova i muscoli con stemming italiano (`"pettorali"` $\rightarrow$ `"Petto"`) e aggiunge il badge corrispondente.
4. **Auto-Healing Behavior**:
   - Sessione con "Panca Piana" (primario: `chest`) completata lasciando il campo dolori vuoto $\rightarrow$ `chest` viene rimosso da `activePains`.
   - Muscoli non allenati (es. `quads`) rimangono presenti in `activePains`.
   - Se `chest` viene ri-selezionato a fine sessione, `chest` rimane presente in `activePains`.
