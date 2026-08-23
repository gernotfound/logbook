# Indagine Architetturale e Tecnica: Requisiti R2 e R3

**Data**: 2026-08-20  
**Autore**: Survey Explorer 2  
**Progetto**: LogBook PWA  
**Oggetto**: 
1. **R2**: Riordino esercizi in sessione live (pulsanti "Su" e "Giù" su ciascun blocco esercizio, mutazione immutabile di `localWorkout.exercises` senza drag & drop).
2. **R3**: Sincronizzazione in tempo reale degli esercizi (derivazione dinamica di nome, note e gruppi muscolari incrociando `exercise.exId` con lo store globale `userData.library`).

---

## 1. Sintesi Esecutiva (Executive Summary)

L'analisi del codebase di **LogBook** evidenzia che l'architettura attuale è già in gran parte orientata all'approccio normalizzato (dove `localWorkout.exercises` memorizza riferimenti `exId` anziché duplicati statici di nomi e muscoli). Tuttavia:
- **Per R2 (Riordino esercizi in sessione)**: La funzione `reorderExercises(fromIndex, toIndex)` è già definita in `src/hooks/workout/useWorkoutSetMutations.ts` (righe 50-58) ed esportata da `useWorkoutSession.ts`, ma **non è agganciata alla UI** di `SessionExerciseCard.tsx` né passata da `TrainingSession.tsx`. Inoltre, mancano i controlli difensivi sui limiti dell'array (boundary conditions), la gestione dello stato dei pannelli espansi (`openHistoryExIndex`, `openSetupExIndex`), e l'attribuzione di un `id` univoco stabile ad ogni elemento `SessionExercise` per garantire chiavi React (`key`) ottimali durante lo swap dei nodi DOM.
- **Per R3 (Sincronizzazione in tempo reale)**: `TrainingSession.tsx` crea già una mappa in memoria `libraryMap = new Map(library.map(l => [l.id, l]))` che passa l'oggetto `libDef` a `SessionExerciseCard`. Quando l'utente modifica un esercizio nella libreria (in `TrainingExercises.tsx`), Zustand aggiorna `userData.library`, propagando il nuovo oggetto `libDef` al componente memorizzato (`React.memo`). Tuttavia, `SessionExerciseCard` attualmente visualizza solo il nome (`libDef.name`) e le note di setup, **omettendo i gruppi muscolari primari e secondari**. Aggiungendo il rendering dei badge muscolari ricavati da `libDef.muscles` e `libDef.secondaryMuscles` (tramite `Logic.MUSCLES`), la sincronizzazione delle proprietà sarà completa, reattiva e a costo zero di re-render grazie al comparatore di `React.memo`.

---

## 2. Analisi Dettagliata dell'Architettura Attuale

### 2.1 Modello Dati e Tipi (`src/types.ts` & `src/lib/schema.ts`)

- **Esercizio in Libreria (`Exercise` in `src/types.ts:49-60`)**:
  ```typescript
  export interface Exercise {
      id: string;
      name: string;
      notes?: string;
      setsCount: number;
      muscles?: string[];
      secondaryMuscles?: string[];
      sets: ExerciseSet[];
      trackingType?: 'weight_reps' | 'time' | 'cardio';
      isDefault?: boolean;
  }
  ```
- **Esercizio in Sessione Live (`SessionExercise` in `src/types.ts:89-96`)**:
  ```typescript
  export interface SessionExercise {
      exId: string;
      sessionNote: string;
      sets: SessionExerciseSet[];
      minReps?: number;
      maxReps?: number;
  }
  ```
- **Sessione di Allenamento (`WorkoutSession` in `src/types.ts:97-116`)**:
  ```typescript
  export interface WorkoutSession {
      id?: string;
      routineId?: string;
      routineName?: string;
      cycleId?: string;
      cycleName?: string;
      date?: string;
      globalStartTime?: number;
      globalEndTime?: number;
      globalDurationStr?: string;
      manualDurationStr?: string;
      moodRating?: number | null;
      pumpRating?: number | null;
      fatigueRating?: number | null;
      waterLiters?: number;
      endTime?: number;
      exercises: SessionExercise[];
      isEditingHistory?: boolean;
      originalHistoryId?: string;
  }
  ```

#### Osservazione Chiave sulla Normalizzazione dei Dati:
`SessionExercise` memorizza unicamente `exId` (e le metriche relative alla sessione: serie eseguite, ripetizioni, carichi, note di sessione). **Non memorizza duplicati statici di `name`, `muscles`, `secondaryMuscles` o `trackingType`**.
Questo garantisce che la persistenza (`localStorage['logbook_local_workout']`) sia leggera e intrinsecamente predisposta alla sincronizzazione dinamica.

### 2.2 Flusso dello Stato e Storage 3-Tier (`useAppStore.ts`)

```
+-------------------------------------------------------------------+
|                           ZUSTAND STORE                           |
|  +-----------------------------+  +----------------------------+  |
|  |     userData.library        |  |        localWorkout        |  |
|  | (Tier 2: Cached IndexedDB)  |  |  (Tier 3: Sync LocalStorage|  |
|  +--------------+--------------+  +-------------+--------------+  |
+-----------------|-------------------------------|-----------------+
                  |                               |
                  v                               v
       useWorkoutSession() hook        useWorkoutSession() hook
                  |                               |
                  +---------------+---------------+
                                  |
                                  v
                        TrainingSession.tsx
               (libraryMap = new Map(library.map...))
               (libDef = libraryMap.get(exItem.exId))
                                  |
                                  v
                     SessionExerciseCard.tsx
                     (React.memo con libDef)
```

1. `userData.library` risiede in `createDataSlice.ts` ed è sincronizzata con IndexedDB (`logbook_cached_user_data`) e Firestore.
2. `localWorkout` risiede in `createWorkoutSlice.ts` ed è sincronizzato sincronicamente su `localStorage['logbook_local_workout']` ad ogni modifica (con debouncer protetto da `visibilitychange`).
3. In `TrainingSession.tsx` (righe 392-421), l'iterazione su `activeWorkout.exercises` effettua un lookup $O(1)$ in `libraryMap` per ricavare `libDef = libraryMap.get(exItem.exId)` e passarlo come prop a `SessionExerciseCard`.

---

## 3. Analisi Requisito R2: Riordino Esercizi in Sessione Live

### 3.1 Obiettivo
Consentire all'utente di modificare l'ordine di esecuzione degli esercizi durante una sessione attiva (ad esempio, se una panca o un macchinario è occupato da un altro atleta) mediante pulsanti "Su" (⬆️) e "Giù" (⬇️) posti su ogni card esercizio.
**Vincolo mobile esplicito**: Evitare librerie di drag & drop (`dnd`, `framer-motion`) che interferiscono con lo scrolling touch verticale, creano lag su dispositivi mobili a bassa frequenza e causano conflitti con le tastiere virtuali.

### 3.2 Stato Attuale nel Codice

Nel file `src/hooks/workout/useWorkoutSetMutations.ts` (righe 50-58) è già presente una prima bozza di funzione:
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

### 3.3 Problemi e Limitazioni Identificate

1. **Assenza di controlli sui limiti (Boundary conditions)**:
   Se `fromIndex` o `toIndex` sono minori di `0` o maggiori/uguali a `prev.exercises.length`, `splice` produce mutazioni corrotte dell'array.
2. **Nessun collegamento con la UI**:
   - `TrainingSession.tsx` estrae `reorderExercises` da `useWorkoutSession()`, ma non lo passa a `SessionExerciseCard`.
   - `SessionExerciseCard.tsx` non possiede pulsanti ⬆️ / ⬇️ nel proprio header.
3. **Disallineamento degli stati dei pannelli aperti (`openHistoryExIndex`, `openSetupExIndex`)**:
   In `TrainingSession.tsx` (righe 72-73), i pannelli espansi sono tracciati per indice numerico:
   ```typescript
   const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
   const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
   ```
   Se l'esercizio all'indice 0 (con pannello storico aperto) viene spostato all'indice 1, l'indice `0` rimarrebbe erroneamente aperto per il *nuovo* esercizio all'indice 0, a meno che non si aggiorni coerentemente lo stato dei pannelli durante il reorder.
4. **Chiavi React (`key`) instabili**:
   In `TrainingSession.tsx` riga 398:
   ```tsx
   key={exItem.id || `${exItem.exId}_${exIndex}`}
   ```
   Poiché `SessionExercise` non riceveva un campo `id` univoco alla creazione, la chiave ricade su `${exItem.exId}_${exIndex}`. Spostando l'esercizio, l'indice `exIndex` muta e React distrugge e rimonta completamente il nodo DOM anziché riordinarlo fluidamente.
   Attribuendo un `id` generato (es. `Logic.generateId('se')`) ad ogni esercizio di sessione, la chiave React diventa stabile e il riordino preserva lo stato degli input e l'animazione naturale del DOM.

### 3.4 Proposta di Implementazione per R2

#### A. Rafforzamento della logica in `useWorkoutSetMutations.ts`
```typescript
const reorderExercises = useCallback((fromIndex: number, toIndex: number) => {
    setLocalWorkout((prev) => {
        if (!prev || !prev.exercises) return prev;
        const total = prev.exercises.length;
        if (
            fromIndex < 0 ||
            fromIndex >= total ||
            toIndex < 0 ||
            toIndex >= total ||
            fromIndex === toIndex
        ) {
            return prev;
        }
        const newExercises = [...prev.exercises];
        const [removed] = newExercises.splice(fromIndex, 1);
        newExercises.splice(toIndex, 0, removed);
        return { ...prev, exercises: newExercises };
    });
}, [setLocalWorkout]);

const moveExercise = useCallback((index: number, direction: -1 | 1) => {
    reorderExercises(index, index + direction);
}, [reorderExercises]);
```

#### B. Gestione dello spostamento e dei pannelli in `TrainingSession.tsx`
```tsx
const handleMoveExercise = useCallback((index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    reorderExercises(index, targetIndex);
    
    // Aggiorna coerentemente i pannelli espansi
    setOpenHistoryExIndex(prev => {
        if (prev === index) return targetIndex;
        if (prev === targetIndex) return index;
        return prev;
    });
    setOpenSetupExIndex(prev => {
        if (prev === index) return targetIndex;
        if (prev === targetIndex) return index;
        return prev;
    });
}, [reorderExercises]);
```

#### C. Aggiunta dei controlli visivi in `SessionExerciseCard.tsx`
Nel blocco di intestazione di `SessionExerciseCardInner`:
```tsx
<div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
    {/* Pulsanti di riordino R2 */}
    <button
        type="button"
        className="btn-icon"
        disabled={exIndex === 0}
        style={{ 
            opacity: exIndex === 0 ? 0.3 : 1,
            padding: '4px 6px',
            fontSize: '0.85rem',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--glass-border)',
            borderRadius: '6px',
            cursor: exIndex === 0 ? 'not-allowed' : 'pointer'
        }}
        onClick={() => onMoveExercise && onMoveExercise(-1)}
        aria-label="Sposta esercizio in alto"
        title="Sposta in alto"
    >
        ⬆️
    </button>
    <button
        type="button"
        className="btn-icon"
        disabled={totalExercises !== undefined && exIndex === totalExercises - 1}
        style={{ 
            opacity: (totalExercises !== undefined && exIndex === totalExercises - 1) ? 0.3 : 1,
            padding: '4px 6px',
            fontSize: '0.85rem',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--glass-border)',
            borderRadius: '6px',
            cursor: (totalExercises !== undefined && exIndex === totalExercises - 1) ? 'not-allowed' : 'pointer'
        }}
        onClick={() => onMoveExercise && onMoveExercise(1)}
        aria-label="Sposta esercizio in basso"
        title="Sposta in basso"
    >
        ⬇️
    </button>

    <button
        className="btn-small"
        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }}
        onClick={onRemoveExercise}
        aria-label="Rimuovi esercizio dalla sessione"
    >
        🗑️
    </button>
    <button
        className={`btn-small toggle-btn ${isHistoryOpen ? 'active-highlight' : ''}`}
        style={isHistoryOpen ? { background: 'var(--primary-color)', color: '#000' } : {}}
        onClick={onToggleHistory}
    >
        🕒 Storico
    </button>
    <button
        className={`btn-small toggle-btn ${isSetupOpen ? 'active-highlight' : ''}`}
        style={isSetupOpen ? { background: 'var(--primary-color)', color: '#000' } : {}}
        onClick={onToggleSetup}
    >
        ⚙️ Setup
    </button>
</div>
```

#### D. Aggiornamento del comparatore `React.memo`
```typescript
export const SessionExerciseCard = React.memo(SessionExerciseCardInner, (prev, next) => {
    return (
        prev.exItem === next.exItem &&
        prev.libDef === next.libDef &&
        prev.pastWorkouts === next.pastWorkouts &&
        prev.isHistoryOpen === next.isHistoryOpen &&
        prev.isSetupOpen === next.isSetupOpen &&
        prev.openSpecialMenuId === next.openSpecialMenuId &&
        prev.exIndex === next.exIndex &&
        prev.totalExercises === next.totalExercises
    );
});
```

---

## 4. Analisi Requisito R3: Sincronizzazione in Tempo Reale degli Esercizi

### 4.1 Obiettivo
Durante un allenamento attivo (`localWorkout`), se l'utente naviga nella tab "Esercizi" e modifica le proprietà di un esercizio presente nella libreria (es. cambia il nome da "Panca piana" a "Panca piana con manubri", modifica le note di setup globali, o aggiorna i gruppi muscolari primari e secondari), tali modifiche devono riflettersi istantaneamente nella sessione attiva mediante matching dell'ID (`exercise.exId`), senza richiedere il riavvio della sessione né corrompere i dati inseriti nelle serie.

### 4.2 Analisi della Reattività e Performance

1. **Reattività Zustand**:
   - `userData.library` viene modificata in `useTrainingExercises.ts` tramite `saveUserData(prev => ({ ...prev, library: updatedLibrary }))`.
   - `useWorkoutSession` si sottoscrive a `useAppStore(state => state.userData?.library)`.
   - `TrainingSession.tsx` ricalcola `libraryMap` tramite `useMemo(() => new Map(library.map(l => [l.id, l])), [library])`.
2. **Preservazione dell'Isolamento e Memoizzazione**:
   - Quando `library` cambia, solo l'esercizio modificato riceve un nuovo riferimento oggetto `libDef`.
   - Gli altri esercizi mantengono lo stesso riferimento oggetto `libDef`.
   - Il comparatore personalizzato di `SessionExerciseCard` valuta `prev.libDef === next.libDef`:
     - Solo la card dell'esercizio modificato esegue il re-render.
     - Tutte le altre card rimangono intatte, preservando la digitazione rapida e prevenendo freeze su mobile.

### 4.3 Visualizzazione dei Gruppi Muscolari in `SessionExerciseCard`

Attualmente `SessionExerciseCard.tsx` mostra solo il nome (`exName`) e le note di setup, mentre i muscoli non vengono renderizzati.
Per completare pienamente il requisito R3, `SessionExerciseCard` deve mostrare i gruppi muscolari associati all'esercizio (derivati dinamicamente da `libDef` incrociato con `Logic.MUSCLES`).

#### Implementazione dei Badge Muscolari in `SessionExerciseCard.tsx`:
```tsx
const primaryMuscles = useMemo(() => {
    if (!libDef?.muscles || libDef.muscles.length === 0) return [];
    return libDef.muscles.map((mId: string) => {
        const found = Logic.MUSCLES.find(m => m.id === mId);
        return { id: mId, name: found ? found.name : mId };
    });
}, [libDef?.muscles]);

const secondaryMuscles = useMemo(() => {
    if (!libDef?.secondaryMuscles || libDef.secondaryMuscles.length === 0) return [];
    return libDef.secondaryMuscles.map((mId: string) => {
        const found = Logic.MUSCLES.find(m => m.id === mId);
        return { id: mId, name: found ? found.name : mId };
    });
}, [libDef?.secondaryMuscles]);
```

E nel template JSX (subito sotto al titolo dell'esercizio):
```tsx
{(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
    <div className="flex flex-wrap gap-4 items-center" style={{ marginBottom: '8px' }}>
        {primaryMuscles.map(m => (
            <span 
                key={m.id} 
                className="badge badge-primary" 
                style={{ fontSize: '0.7rem', padding: '2px 8px', fontWeight: 600 }}
            >
                {m.name}
            </span>
        ))}
        {secondaryMuscles.map(m => (
            <span 
                key={m.id} 
                className="badge" 
                style={{ 
                    fontSize: '0.7rem', 
                    padding: '2px 8px', 
                    background: 'rgba(0, 229, 255, 0.15)', 
                    color: '#fff', 
                    border: '1px solid var(--secondary-color, #4db6ac)',
                    fontWeight: 500
                }}
            >
                {m.name}
            </span>
        ))}
    </div>
)}
```

### 4.4 Gestione Fallback per Esercizi Eliminati o Ad-Hoc

Se un esercizio viene rimosso dalla libreria mentre è in corso un allenamento (o se viene importato uno storico con ID non più presenti in `library`):
- `libDef` sarà `undefined`.
- Fallback nome: `const exName = libDef ? libDef.name : ((exItem as any).name || "Esercizio rimosso");`
- Fallback note: `const exNotes = libDef ? (libDef.notes || '') : "";`
- Fallback muscoli: nessun badge mostrato (array vuoti), nessun crash di rendering.
- Fallback trackingType: `libDef?.trackingType || (exItem as any).trackingType || 'weight_reps'`.

---

## 5. Proposte di Modifica Dettagliate per File

### File 1: `src/types.ts`
Aggiungere `id?: string;` a `SessionExercise` (per garantire React keys stabili durante il reordering):
```typescript
export interface SessionExercise {
    id?: string;
    exId: string;
    sessionNote: string;
    sets: SessionExerciseSet[];
    minReps?: number;
    maxReps?: number;
}
```

### File 2: `src/lib/schema.ts`
Aggiungere `id: safeOptionalString()` a `SessionExerciseSchema`:
```typescript
export const SessionExerciseSchema = z.object({
    id: safeOptionalString(),
    exId: safeString(''),
    sessionNote: safeString(''),
    sets: z.array(SessionExerciseSetSchema).catch([]).default([]),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
}).passthrough().catch({ exId: '', sessionNote: '', sets: [] }).default({ exId: '', sessionNote: '', sets: [] });
```

### File 3: `src/hooks/workout/useWorkoutSetMutations.ts`
Rafforzare `reorderExercises` con controlli sui confini ed esportare `moveExercise`:
```typescript
const reorderExercises = useCallback((fromIndex: number, toIndex: number) => {
    setLocalWorkout((prev) => {
        if (!prev || !prev.exercises) return prev;
        const total = prev.exercises.length;
        if (
            fromIndex < 0 ||
            fromIndex >= total ||
            toIndex < 0 ||
            toIndex >= total ||
            fromIndex === toIndex
        ) {
            return prev;
        }
        const newExercises = [...prev.exercises];
        const [removed] = newExercises.splice(fromIndex, 1);
        newExercises.splice(toIndex, 0, removed);
        return { ...prev, exercises: newExercises };
    });
}, [setLocalWorkout]);

const moveExercise = useCallback((index: number, direction: -1 | 1) => {
    reorderExercises(index, index + direction);
}, [reorderExercises]);
```

### File 4: `src/hooks/useWorkoutSession.ts`
Assicurarsi che `startWorkout`, `addExtraExercise` e `startEditHistoricalWorkout` assegnino un `id: Logic.generateId('se')` agli esercizi della sessione, e che `moveExercise` sia esportato insieme a `reorderExercises`.

### File 5: `src/components/Training/TrainingSession.tsx`
- Recuperare `reorderExercises` (o `moveExercise`) da `useWorkoutSession()`.
- Gestire il riallineamento dei pannelli `openHistoryExIndex` e `openSetupExIndex`.
- Passare `totalExercises={(activeWorkout.exercises || []).length}` e `onMoveExercise={(dir) => handleMoveExercise(exIndex, dir)}` a `SessionExerciseCard`.

### File 6: `src/components/Training/session/SessionExerciseCard.tsx`
- Aggiungere `totalExercises?: number;` e `onMoveExercise?: (direction: -1 | 1) => void;` all'interfaccia delle props.
- Renderizzare i pulsanti ⬆️ e ⬇️ nell'header della card.
- Renderizzare i badge dei gruppi muscolari (primari e secondari) derivati da `libDef` e `Logic.MUSCLES`.
- Aggiornare il comparatore `React.memo` per includere `totalExercises` ed `exIndex`.

---

## 6. Casi Limite (Edge Cases) e Piano di Verifica

### 6.1 Matrice dei Casi Limite
| Caso Limite | Comportamento Atteso | Soluzione Adottata |
|---|---|---|
| **Pressione "Su" sul primo esercizio** (`index === 0`) | Il pulsante è visivamente disabilitato (`disabled`, opacità ridotta 0.3) e il click non produce alcuna mutazione. | Controllo `disabled={exIndex === 0}` e guard clause in `reorderExercises`. |
| **Pressione "Giù" sull'ultimo esercizio** (`index === total - 1`) | Il pulsante è visivamente disabilitato e il click non produce alcuna mutazione. | Controllo `disabled={exIndex === totalExercises - 1}` e guard clause. |
| **Sessione con 1 solo esercizio** | Entrambi i pulsanti sono disabilitati. | `exIndex === 0` e `exIndex === 1 - 1 === 0` disabilitano sia Su che Giù. |
| **Spostamento con pannello Storico/Setup aperto** | Il pannello rimane aperto sullo stesso esercizio spostato, senza "saltare" all'esercizio adiacente. | Aggiornamento sincrono di `openHistoryExIndex` / `openSetupExIndex` in `TrainingSession.tsx`. |
| **Modifica contemporanea del nome in libreria** | Il nuovo nome e i nuovi muscoli appaiono all'istante nella card della sessione senza perdita dei dati digitati nelle serie. | Derivazione reattiva tramite `libraryMap.get(exId)` e `React.memo` basato sul riferimento `libDef`. |
| **Esercizio eliminato dalla libreria durante la sessione** | Nessun crash: fallback su "Esercizio rimosso", badge muscoli nascosti. | Helper difensivi `libDef ? libDef.name : ...` e gestione array vuoti. |

### 6.2 Piano di Verifica Unitario e Manuale
1. **Unit Test per `reorderExercises` (`src/lib/calc/workout.test.ts` o nuovo test dedicato)**:
   - Verificare che lo swap `[A, B, C]` con `reorder(0, 1)` diventi `[B, A, C]`.
   - Verificare che indici fuori limite (`-1`, `99`) non mutino l'array.
   - Verificare la preservazione di tutti i campi delle serie (`kg`, `reps`, `dropsets`, `isometrics`).
2. **Manuale QA Checklist**:
   - Avviare un allenamento con 3 esercizi (A, B, C).
   - Verificare che su A il tasto ⬆️ sia disabilitato e ⬇️ abilitato.
   - Cliccare ⬇️ su A: l'ordine diventa B, A, C. I pesi e le serie di A e B restano inalterati.
   - Aprire il pannello "Setup" di A e cliccare ⬇️: l'ordine diventa B, C, A e il pannello "Setup" di A rimane aperto.
   - Andare nella tab "Esercizi", rinominare l'esercizio B in "B Modificato" e cambiare i muscoli.
   - Tornare nella sessione attiva: verificare che B mostri immediatamente "B Modificato" e i nuovi badge muscolari.
