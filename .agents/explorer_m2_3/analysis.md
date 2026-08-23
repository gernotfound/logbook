# Analisi Tecnica e Architetturale: Schema, Tipi, React Keys, Persistenza e Test Plan (R2 & R3)

**Data**: 2026-08-20  
**Autore**: Explorer 3 (Milestone M2)  
**Progetto**: LogBook PWA  
**Focus**: Data Contracts, Zod Gateway, React Key Stability, 3-Tier Storage Integrity & Unit/Component Test Suite per R2 (Riordino Esercizi) e R3 (Sincronizzazione Live Esercizi).

---

## 1. Executive Summary

L'analisi approfondita della pipeline dei dati, della gestione dello stato e del rendering per i requisiti **R2** (riordino esercizi in sessione live) e **R3** (sincronizzazione in tempo reale di nomi, note e gruppi muscolari dalla libreria) evidenzia le seguenti conclusioni chiave:

1. **Contratti Dati e Tipi (`src/types.ts`)**:
   - `SessionExercise` richiede l'aggiunta del campo facoltativo `id?: string;`. Questo `id` funge da identificatore univoco dell'istanza dell'esercizio all'interno della sessione di allenamento (es. `se_1740000000000_abc123`).
   - L'aggiunta di `id?: string` a `SessionExercise` è al 100% retrocompatibile: le sessioni storiche già archiviate in Firestore o IndexedDB continuano a essere valide e non richiedono alcuna migrazione distruttiva.
   
2. **Validazione Runtime e Zod Gateway (`src/lib/schema.ts`)**:
   - `SessionExerciseSchema` accetta `id: safeOptionalString()`. Grazie a `safeOptionalString()`, qualsiasi valore stringa o numerico viene validato o convertito senza generare eccezioni, mentre i dati legacy sprovvisti di `id` mantengono il fallback trasparente a `undefined`.
   - `UserDataSchema.parse()` e `DomainParsers.parseWorkoutSession()` mantengono intatto l'ID dell'esercizio senza scartarlo.

3. **Stabilità delle Chiavi React (`key`) durante il Riordino**:
   - Attualmente in `TrainingSession.tsx`, la chiave React usata nel rendering della lista è `key={exItem.id || `${exItem.exId}_${exIndex}`}`.
   - In assenza di `exItem.id`, la chiave dipende da `exIndex`. Durante un'operazione di swap o spostamento (es. da indice 0 a 1), React rileva il cambio di `key`, distrugge (unmount) il componente precedente e ne istanzia uno nuovo da zero. Questo comporta:
     - Perdita immediata del focus dell'input e della posizione del cursore.
     - Reset dello stato locale (es. bozze o valori parziali non ancora salvati nello store).
     - Riconfigurazione forzata del DOM anziché riposizionamento fluido del nodo.
   - Assegnando un `id` generato (es. `Logic.generateId('se')`) alla creazione di ciascun esercizio in sessione (in `startWorkout`, `addExtraExercise`, `startEditHistoricalWorkout` e `getInitialLocalWorkout`), la chiave React rimane immutata (`key={exItem.id}`), permettendo a React di riordinare i nodi DOM in modo performante e privo di glitch visivi.

4. **Integrità dello Storage Ibrido a 3 Livelli (3-Tier Storage & Offline Resilience)**:
   - **Tier 3 (`localStorage['logbook_local_workout']`)**: Salvataggio sincrono istantaneo e immutabile con debouncer protetto da `visibilitychange`. La presenza di `id` su `SessionExercise` rispetta i vincoli di serializzazione JSON (`JSON.stringify`).
   - **Tier 2 (`IndexedDB['logbook_cached_user_data']`)**: Cache globale con validazione Zod Gateway.
   - **Tier 1 (`Firestore` subcollection `history_months` & `users/{uid}`)**: Diffing con `fast-deep-equal` e divieto assoluto di valori `undefined`. Quando `id` è facoltativo, l'oggetto viene serializzato pulito senza campi `undefined`.

5. **Piano di Testing Vitest Completo (R2 & R3)**:
   - Definita una suite esaustiva di test unitari e di componenti per:
     - Logica di mutazione e confini in `useWorkoutSetMutations.ts` (`reorderExercises`, `moveExercise`).
     - Rendering dei controlli di spostamento ⬆️/⬇️ e stati disabilitati in `SessionExerciseCard.tsx`.
     - Sincronizzazione degli stati dei pannelli espansi ("Setup", "Storico") in `TrainingSession.tsx`.
     - Rendering dinamico dei badge muscolari primari e secondari (risolti tramite `Logic.MUSCLES`) e gestione dei fallback.
     - Isolamento del comparatore di `React.memo` per prevenire re-render a cascata.

---

## 2. Analisi Dettagliata Schema & Modello Dati

### 2.1 File `src/types.ts`

Attualmente in `src/types.ts:89-95`:
```typescript
export interface SessionExercise {
    exId: string;
    sessionNote: string;
    sets: SessionExerciseSet[];
    minReps?: number;
    maxReps?: number;
}
```

#### Modifica Proposta:
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

#### Analisi della compatibilità:
- `id?: string`: È un campo opzionale (`?`). Non rende obbligatoria la presenza di `id` nei dati esistenti.
- Tutte le interfacce collegate (`WorkoutSession.exercises: SessionExercise[]`, `UserData.activeWorkout`, `UserData.history`) rimangono al 100% conformi.
- `Exercise` in `src/types.ts` contiene già `muscles?: string[]` e `secondaryMuscles?: string[]`.
- `SessionExerciseCardProps`: deve essere estesa con `totalExercises?: number;` e `onMoveExercise?: (direction: -1 | 1) => void;`.

---

### 2.2 File `src/lib/schema.ts` (Zod Gateway)

Attualmente in `src/lib/schema.ts:198-204`:
```typescript
export const SessionExerciseSchema = z.object({
    exId: safeString(''),
    sessionNote: safeString(''),
    sets: z.array(SessionExerciseSetSchema).catch([]).default([]),
    minReps: safeOptionalNumber(),
    maxReps: safeOptionalNumber(),
}).passthrough().catch({ exId: '', sessionNote: '', sets: [] }).default({ exId: '', sessionNote: '', sets: [] });
```

#### Modifica Proposta:
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

#### Verifica del comportamento di `safeOptionalString`:
`safeOptionalString` in `src/lib/schema.ts:60-64` è implementato come:
```typescript
const safeOptionalString = () =>
    z.union([
        z.string(),
        z.number().transform(v => String(v)),
    ]).optional().catch(undefined);
```
- **Se `id` è una stringa valida (es. `'se_12345'`)**: Zod restituisce `'se_12345'`.
- **Se `id` è un numero (es. `12345`)**: Zod lo trasforma automaticamente in stringa `'12345'`.
- **Se `id` è `undefined` o assente (dati legacy)**: Zod restituisce `undefined`, preservando l'integrità del parsing.
- **Se `id` è corrotto (es. oggetto o array)**: Il `.catch(undefined)` intercetta l'anomalia e restituisce `undefined` senza far fallire il parse.

---

### 2.3 Checklist di Sicurezza UserData (5-Step Compliance)

Poiché `id` è una proprietà interna dell'array `exercises` in `WorkoutSession` (già presente sia in `activeWorkout` che in `history`):
1. `src/types.ts`: `SessionExercise.id?: string` aggiunto.
2. `src/lib/schema.ts`: `SessionExerciseSchema.id: safeOptionalString()` aggiunto.
3. `src/lib/db.ts`: Sia `DB.loadUserData` che `DB.saveUserData` utilizzano `DomainParsers.parseWorkoutSession` e `DomainParsers.parseHistory`, che usano `WorkoutSessionSchema` e `SessionExerciseSchema`. Nessuna modifica breaking.
4. `src/contexts/AuthContext.tsx`: `defaultUserData.activeWorkout: null` e `defaultUserData.history: []` rimangono conformi.
5. `src/lib/export.ts`: L'export CSV itera su `ex.sets` e usa `ex.exId` / `ex.name`; la presenza di `ex.id` è trasparente.

---

## 3. React Keys e Stabilità del Rendering durante il Riordino

### 3.1 Il Problema delle Chiavi Instabili

In `src/components/Training/TrainingSession.tsx:398`:
```tsx
<SessionExerciseCard
    key={exItem.id || `${exItem.exId}_${exIndex}`}
    exItem={exItem}
    exIndex={exIndex}
    ...
/>
```

Se `exItem.id` non esiste:
- Esercizio 0 (es. Panca Piana, `exId: 'ex_bench'`) ha chiave `'ex_bench_0'`.
- Esercizio 1 (es. Trazioni, `exId: 'ex_pullup'`) ha chiave `'ex_pullup_1'`.

Quando l'utente preme ⬇️ su Panca Piana:
- Panca Piana si sposta all'indice 1 $\rightarrow$ Nuova chiave calcolata: `'ex_bench_1'`.
- Trazioni si sposta all'indice 0 $\rightarrow$ Nuova chiave calcolata: `'ex_pullup_0'`.

**Conseguenza**: React rileva chiavi completamente diverse per entrambe le posizioni e distrugge (`unmount`) entrambi i componenti DOM, ricreandoli da capo. Questo provoca:
1. Perdita dello stato dei campi di input non committati (focus attivo, cursore, selezione).
2. Reset di eventuali animazioni CSS o transizioni di layout.
3. Consumo inutile di cicli CPU su dispositivi mobili a basse prestazioni.

### 3.2 La Soluzione: Assegnazione Deterministica di `id`

Assegnando un `id: Logic.generateId('se')` a ciascun `SessionExercise` nei punti di ingresso:
1. `useWorkoutSession.ts -> startWorkout`:
   ```typescript
   const result: any = { id: Logic.generateId('se'), exId: ex.exId, sets, sessionNote: '' };
   ```
2. `useWorkoutSetMutations.ts -> addExtraExercise`:
   ```typescript
   exercises: [
       ...prev.exercises,
       { id: Logic.generateId('se'), exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
   ]
   ```
3. `useWorkoutSession.ts -> startEditHistoricalWorkout`:
   ```typescript
   const sanitizedExercises = (workout.exercises || []).map((ex: any) => ({
       ...ex,
       id: ex.id || Logic.generateId('se'),
       ...
   ```
4. `createWorkoutSlice.ts -> getInitialLocalWorkout`:
   ```typescript
   validated.exercises = validated.exercises.map((ex: SessionExercise) => ({
       ...ex,
       id: ex.id || Logic.generateId('se'),
       ...
   ```

La chiave React in `TrainingSession.tsx` diventa:
```tsx
key={exItem.id || exItem.exId || `se_idx_${exIndex}`}
```
Poiché `exItem.id` non muta durante il riordino, React esegue esclusivamente il reordering dei nodi DOM esistenti senza alcun unmount!

---

## 4. Persistenza Offline & Storage Integrity (3-Tier)

### 4.1 Tier 3: LocalStorage sincrono (`logbook_local_workout`)
- Il workout attivo (`localWorkout`) viene salvato immediatamente su `localStorage` in formato JSON stringificato (`JSON.stringify(workout)`).
- Durante il freeze del browser o lo switch di app su iOS/Android, il listener `visibilitychange` in `useAppStore.ts` scrive sincronicamente `localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout))`.
- L'introduzione di `id: string` in `SessionExercise` aggiunge solo ~15 byte per esercizio (es. `"id":"se_174000_abc"`), rimanendo ampiamente entro il limite dei 5MB di `localStorage`.

### 4.2 Tier 2: IndexedDB (`logbook_cached_user_data`)
- La cache globale salva l'intero `UserData` (incluso `activeWorkout` e `history`).
- Zod Gateway in `getInitialUserData()` convalida `UserDataSchema.parse()`, garantendo che i tipi siano rispettati.

### 4.3 Tier 1: Firestore Cloud & Prevenzione `undefined`
- Firebase Firestore SDK solleva eccezioni non gestite se riceve campi `undefined`.
- Con `id: safeOptionalString()`, se `id` non è definito, viene omesso o impostato esplicitamente senza mai passare `undefined` a Firestore.

---

## 5. Requisito R2: Logica di Riordino e Sincronizzazione Pannelli

### 5.1 Funzione `reorderExercises` in `useWorkoutSetMutations.ts`
Implementazione difensiva con boundary check rigorosi:
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

### 5.2 Sincronizzazione degli Accordion in `TrainingSession.tsx`
Quando un esercizio viene spostato, gli indici dei pannelli aperti (`openHistoryExIndex` e `openSetupExIndex`) devono seguire l'esercizio:
```typescript
const handleMoveExercise = useCallback((fromIndex: number, direction: -1 | 1) => {
    const toIndex = fromIndex + direction;
    reorderExercises(fromIndex, toIndex);

    setOpenHistoryExIndex(prev => {
        if (prev === null) return null;
        if (prev === fromIndex) return toIndex;
        if (prev === toIndex) return fromIndex;
        return prev;
    });

    setOpenSetupExIndex(prev => {
        if (prev === null) return null;
        if (prev === fromIndex) return toIndex;
        if (prev === toIndex) return fromIndex;
        return prev;
    });
}, [reorderExercises]);
```

### 5.3 Controlli UI in `SessionExerciseCard.tsx`
Pulsanti compatti nell'header con disabilitazione visiva e logica:
- **Pulsante ⬆️ (Sposta in alto)**:
  - `disabled={exIndex === 0}`
  - `aria-label="Sposta esercizio in alto"`
  - `title="Sposta in alto"`
- **Pulsante ⬇️ (Sposta in basso)**:
  - `disabled={totalExercises !== undefined && exIndex === totalExercises - 1}`
  - `aria-label="Sposta esercizio in basso"`
  - `title="Sposta in basso"`

### 5.4 Comparatore `React.memo` Aggiornato
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

## 6. Requisito R3: Sincronizzazione Dinamica dei Gruppi Muscolari

### 6.1 Risoluzione dei Muscoli da `libDef` e `Logic.MUSCLES`
In `SessionExerciseCard.tsx`:
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

### 6.2 Template JSX per i Badge
```tsx
{(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
    <div className="flex flex-wrap gap-5 items-center" style={{ marginTop: '4px', marginBottom: '8px' }}>
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
                    background: 'var(--secondary-color, rgba(0, 229, 255, 0.3))', 
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

---

## 7. Piano di Testing Vitest Dettagliato (Unit & Integration)

Si raccomanda la creazione del file di test dedicato `tests/workout_reorder_and_live_sync_r2_r3.test.tsx` strutturato nei seguenti 5 blocchi:

### Blocco 1: Unit Test per `useWorkoutSetMutations` (`reorderExercises` & `moveExercise`)
1. **Reorder base verso il basso**: `[A, B, C]` con `reorderExercises(0, 1)` $\rightarrow$ `[B, A, C]`.
2. **Reorder base verso l'alto**: `[A, B, C]` con `reorderExercises(2, 1)` $\rightarrow$ `[A, C, B]`.
3. **Reorder primo $\rightarrow$ ultimo e ultimo $\rightarrow$ primo**: `reorderExercises(0, 2)` e `reorderExercises(2, 0)`.
4. **Boundary conditions (nessuna mutazione)**:
   - `fromIndex < 0` (es. `-1`)
   - `fromIndex >= length` (es. `3` su array di 3)
   - `toIndex < 0` (es. `-1`)
   - `toIndex >= length` (es. `5`)
   - `fromIndex === toIndex`
   - `localWorkout` è `null` o `exercises` è vuoto.
5. **Preservazione dei dati delle serie**: I dati inseriti (`kg`, `reps`, `time`, `dropsets`, `isometrics`, `sessionNote`) associati a ciascun esercizio rimangono rigorosamente attaccati all'esercizio spostato.

### Blocco 2: Component Test per `SessionExerciseCard` (Pulsanti R2 & Badge R3)
1. **Pulsante ⬆️ disabilitato su `exIndex === 0`**: Verificare `disabled` attribute e `opacity: 0.3`.
2. **Pulsante ⬇️ disabilitato su `exIndex === totalExercises - 1`**: Verificare `disabled` attribute.
3. **Entrambi i pulsanti disabilitati se `totalExercises === 1`**.
4. **Click sui pulsanti attivi**: Click su ⬆️ invoca `onMoveExercise(-1)`, click su ⬇️ invoca `onMoveExercise(1)`.
5. **Rendering badge muscolari primari e secondari (R3)**:
   - Fornendo `libDef.muscles = ['chest_upper']` e `libDef.secondaryMuscles = ['triceps_long']`, il componente renderizza i badge "Fascio clavicolare (petto alto)" e "Capo lungo del tricipite".
6. **Fallback graceful per esercizio eliminato**:
   - Fornendo `libDef = undefined`, viene mostrato "Esercizio rimosso", nessun badge muscolare, e nessun errore di rendering.

### Blocco 3: Integration Test in `TrainingSession` (Flusso Completo R2 & R3)
1. **Flusso di riordino in sessione attiva**:
   - Avviare sessione con Routine [Esercizio A, Esercizio B, Esercizio C].
   - Cliccare ⬇️ su Esercizio A.
   - Verificare che il primo titolo visibile sia Esercizio B e il secondo sia Esercizio A.
2. **Sincronizzazione pannelli espansi ("Setup", "Storico")**:
   - Aprire il pannello "Setup" su Esercizio A (all'indice 0).
   - Cliccare ⬇️ su Esercizio A (spostandolo all'indice 1).
   - Verificare che il pannello "Setup" rimanga aperto sull'Esercizio A (ora all'indice 1) e che l'Esercizio B (ora all'indice 0) non abbia il setup aperto.
3. **Sincronizzazione in tempo reale dalla libreria (R3)**:
   - Durante la sessione attiva, modificare il nome e i muscoli di Esercizio A in `userData.library`.
   - Verificare che `TrainingSession` visualizzi immediatamente il nuovo nome e i nuovi badge muscolari senza richiedere il riavvio della sessione.

### Blocco 4: Schema & Storage Integrity Test
1. **Parsing Zod di `SessionExercise` con e senza `id`**:
   - `SessionExerciseSchema.parse({ exId: 'ex1', sessionNote: '', sets: [] })` $\rightarrow$ Valido, `id` è `undefined`.
   - `SessionExerciseSchema.parse({ id: 'se_123', exId: 'ex1', sessionNote: '', sets: [] })` $\rightarrow$ Valido, `id` è `'se_123'`.
2. **Persistenza in `localStorage['logbook_local_workout']`**:
   - Il salvataggio del workout serializza correttamente `id` e i sets.
   - `getInitialLocalWorkout` assegna `id` stabili anche a sessioni caricate prive di `id`.

---

## 8. Riepilogo dei File Coinvolti e Piano di Implementazione

| File | Azione Richiesta |
|---|---|
| `src/types.ts` | Aggiungere `id?: string;` a `SessionExercise` |
| `src/lib/schema.ts` | Aggiungere `id: safeOptionalString()` a `SessionExerciseSchema` |
| `src/hooks/workout/useWorkoutSetMutations.ts` | Aggiungere boundary check a `reorderExercises` ed esportare `moveExercise` |
| `src/hooks/useWorkoutSession.ts` | Assegnare `id: Logic.generateId('se')` in `startWorkout`, `addExtraExercise`, `startEditHistoricalWorkout` ed esportare `moveExercise` |
| `src/store/slices/createWorkoutSlice.ts` | Garantire `id: ex.id || Logic.generateId('se')` in `getInitialLocalWorkout` |
| `src/components/Training/session/SessionExerciseCard.tsx` | Aggiungere pulsanti ⬆️/⬇️, rendering badge muscolari con `Logic.MUSCLES`, aggiornare comparatore `React.memo` |
| `src/components/Training/TrainingSession.tsx` | Collegare `handleMoveExercise`, aggiornare la sincronizzazione di `openHistoryExIndex` e `openSetupExIndex`, passare `totalExercises` e `onMoveExercise` |
| `tests/workout_reorder_and_live_sync_r2_r3.test.tsx` | Creare la suite completa di test Vitest unitari e di integrazione per R2 e R3 |
