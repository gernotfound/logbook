# Analisi Tecnica e Piano di Implementazione: R2 (Riordino Esercizi in Sessione Live)

**Milestone**: M2 - Active Session Live Experience  
**Autore**: Explorer 1  
**Data**: 2026-08-20  
**Target Codebase**: LogBook PWA (`src/hooks/workout/useWorkoutSetMutations.ts`, `src/hooks/useWorkoutSession.ts`, `src/components/Training/session/SessionExerciseCard.tsx`, `src/components/Training/TrainingSession.tsx`, `src/types.ts`, `src/lib/schema.ts`, `src/store/slices/createWorkoutSlice.ts`)

---

## 1. Sintesi Esecutiva & Obiettivo

L'obiettivo del requisito **R2** è consentire all'utente di modificare l'ordine di esecuzione degli esercizi durante una sessione attiva di allenamento (`localWorkout`). In una sessione reale in palestra, macchinari o panche possono essere occupati da altri utenti: l'atleta deve poter riordinare istantaneamente gli esercizi con pulsanti "Sposta in alto" (⬆️) e "Sposta in basso" (⬇️) direttamente dall'intestazione di ciascuna card esercizio (`SessionExerciseCard`), senza ricorrere a drag & drop (vietato su mobile per non confliggere con lo scrolling verticale e le tastiere virtuali), senza perdere serie/ripetizioni/carichi già digitati e mantenendo sincronizzati gli stati dei pannelli aperti ("Storico" e "Setup").

---

## 2. Indagine sui File e Componenti Coinvolti

### 2.1 Hook di Mutazione: `src/hooks/workout/useWorkoutSetMutations.ts`

#### Stato Attuale
Nel file `src/hooks/workout/useWorkoutSetMutations.ts` (righe 50-58):
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

#### Vulnerabilità e Limiti Rilevati
1. **Assenza di controlli di confine (Boundary validation)**:
   - Se `fromIndex < 0` o `fromIndex >= prev.exercises.length`, `splice` con indice negativo indicizza dalla fine dell'array, asportando l'elemento sbagliato.
   - Se `toIndex < 0` o `toIndex >= prev.exercises.length`, l'elemento viene inserito in posizioni non volute o in coda.
   - Se `fromIndex === toIndex`, l'array viene rimosso e reinserito nello stesso punto generando una nuova referenza non necessaria.
2. **Assenza di check difensivo su `prev.exercises`**:
   - Se `prev.exercises` fosse nullo o undefined, lo spread `[...prev.exercises]` genererebbe un crash fatale `TypeError: prev.exercises is not iterable`.
3. **Mancanza di una funzione diretta di spostamento a step (`moveExercise`)**:
   - I pulsanti UI operano a passi unitari (`direction: -1` o `1` / `'up'` o `'down'`). Avere una funzione helper `moveExercise(index, direction)` incapsula la conversione in `reorderExercises(index, index + delta)` garantendo atomicità.

#### Soluzione Architetturale
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

const moveExercise = useCallback((index: number, direction: 'up' | 'down' | -1 | 1) => {
    const delta = typeof direction === 'number' ? direction : (direction === 'up' ? -1 : 1);
    reorderExercises(index, index + delta);
}, [reorderExercises]);
```

Inoltre, sia `reorderExercises` che `moveExercise` devono essere esportati dall'oggetto di ritorno di `useWorkoutSetMutations` e propagati all'esterno da `useWorkoutSession.ts`.

---

### 2.2 Componente Card: `src/components/Training/session/SessionExerciseCard.tsx`

#### Layout dell'Intestazione (Header)
Attualmente l'header di `SessionExerciseCard` (righe 118-144) presenta:
```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
    <h2 style={{ color: 'var(--primary-color)', margin: 0, fontSize: '1.15rem' }}>{exName}</h2>
    <div style={{ display: 'flex', gap: '5px' }}>
        <button className="btn-small" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '8px' }} onClick={onRemoveExercise} aria-label="Rimuovi esercizio dalla sessione">
            🗑️
        </button>
        <button className={`btn-small toggle-btn ${isHistoryOpen ? 'active-highlight' : ''}`} style={isHistoryOpen ? { background: 'var(--primary-color)', color: '#000' } : {}} onClick={onToggleHistory}>
            🕒 Storico
        </button>
        <button className={`btn-small toggle-btn ${isSetupOpen ? 'active-highlight' : ''}`} style={isSetupOpen ? { background: 'var(--primary-color)', color: '#000' } : {}} onClick={onToggleSetup}>
            ⚙️ Setup
        </button>
    </div>
</div>
```

#### Requisiti UI / UX Mobile & Dark Glassmorphism
1. **Pulsanti ⬆️ e ⬇️**:
   - Posizionati nel gruppo azioni a destra dell'header, prima del cestino `🗑️`.
   - **Styling**: Dark glassmorphic (`background: rgba(255, 255, 255, 0.06); border: 1px solid var(--glass-border); color: var(--text-main); border-radius: 8px;`).
   - **Touch Target**: Per l'ergonomia mobile in palestra, pulsanti con touch target adeguato (`min-width: 36px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 4px 8px; font-size: 0.85rem;`).
2. **Stato Disabilitato (`disabled`)**:
   - Tasto ⬆️ (Up): disabilitato se `exIndex === 0` oppure se `totalExercises !== undefined && totalExercises <= 1`.
   - Tasto ⬇️ (Down): disabilitato se `totalExercises !== undefined && exIndex >= totalExercises - 1` oppure se `totalExercises <= 1`.
   - Stile disabilitato: `opacity: 0.3; cursor: not-allowed; pointer-events: auto;`.
3. **Accessibilità & Tooltip**:
   - `aria-label="Sposta esercizio in alto"`, `title="Sposta in alto"`
   - `aria-label="Sposta esercizio in basso"`, `title="Sposta in basso"`
   - Sentence case italiano rigoroso come da AGENTS.md.
4. **Interfaccia Props `SessionExerciseCardProps`**:
   - Aggiunta di `totalExercises?: number;`
   - Aggiunta di `onMoveExercise?: (direction: -1 | 1) => void;` (o `onMoveUp?: () => void; onMoveDown?: () => void;`).
5. **Comparatore `React.memo`**:
   Il comparatore personalizzato in fondo a `SessionExerciseCard.tsx` deve monitorare `prev.totalExercises === next.totalExercises` e `prev.exIndex === next.exIndex`.
   Se non si include `totalExercises`, l'aggiunta o rimozione di un altro esercizio nella sessione potrebbe non aggiornare lo stato di disabilitazione del tasto ⬇️ dell'ultimo elemento.

---

### 2.3 Vista Sessione: `src/components/Training/TrainingSession.tsx`

#### Rendering e Gestione dei Pannelli a Tendina (Accordion)
In `TrainingSession.tsx`, lo stato dei pannelli espansi è tracciato tramite indici numerici:
```typescript
const [openHistoryExIndex, setOpenHistoryExIndex] = useState<number | null>(null);
const [openSetupExIndex, setOpenSetupExIndex] = useState<number | null>(null);
const [openSpecialMenuId, setOpenSpecialMenuId] = useState<string | null>(null);
```

#### Problema di Sincronizzazione degli Indici
Se l'utente apre il pannello "Storico" per l'esercizio a indice `0`, e poi clicca ⬇️ per spostarlo a indice `1`:
- Senza riallineamento, `openHistoryExIndex` rimarrebbe `0`, aprendo erroneamente il pannello del *nuovo* esercizio finito a indice `0`.
- **Risoluzione Sincrona**:
```typescript
const handleMoveExercise = useCallback((index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    reorderExercises(index, targetIndex);

    // Aggiorna coerentemente i pannelli espansi per seguire l'esercizio scambiato
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

Nota: `openSpecialMenuId` memorizza l'ID univoco della serie (`setId`), non l'indice dell'esercizio, quindi rimane intrinsecamente immune allo swap degli esercizi.

---

### 2.4 Stabilità delle Chiavi React (`key`) e Modello Dati

#### Analisi della Chiave React nel Loop di Rendering
Nel loop di `TrainingSession.tsx` (riga 398):
```tsx
key={exItem.id || `${exItem.exId}_${exIndex}`}
```
- Attualmente `SessionExercise` non aveva formalmente `id?: string` in `src/types.ts` né in `src/lib/schema.ts`.
- In assenza di `exItem.id`, la chiave ricade su `${exItem.exId}_${exIndex}`.
- Quando due esercizi vengono scambiati, il loro `exIndex` cambia, causando la distruzione e il rimontaggio completo dei nodi DOM da parte del Virtual DOM di React. Questo provoca sfarfallii, perdita del focus degli input attivi e overhead di re-render.

#### Soluzione per Chiavi Stabili
1. Aggiungere `id?: string;` a `SessionExercise` in `src/types.ts`.
2. Aggiungere `id: safeOptionalString()` a `SessionExerciseSchema` in `src/lib/schema.ts`.
3. Assegnare un ID univoco (`Logic.generateId('se')`):
   - In `startWorkout` (`useWorkoutSession.ts`).
   - In `addExtraExercise` (`useWorkoutSetMutations.ts`).
   - In `startEditHistoricalWorkout` (`useWorkoutSession.ts`).
   - In `getInitialLocalWorkout` (`createWorkoutSlice.ts`).

---

### 2.5 Ciclo di Vita di `localWorkout` & Storage Tiering

L'operazione di riordino rispetta rigorosamente l'architettura a 3 livelli definita in AGENTS.md:
1. `handleMoveExercise` $\rightarrow$ `reorderExercises` invoca `setLocalWorkout((prev) => ({ ...prev, exercises: newExercises }))`.
2. `createWorkoutSlice.ts` aggiorna lo stato in memoria `state.localWorkout` e avvia il debouncer di 300ms `debouncedSaveLocalStorage` su `'logbook_local_workout'`.
3. In caso di switch di app o blocco schermo, il listener `visibilitychange` in `src/store/useAppStore.ts` salva istantaneamente `localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout))` senza attendere il timer, garantendo zero perdite di dati.
4. Al termine della sessione (`endWorkout`), l'ordine aggiornato degli esercizi viene serializzato nell'array `history` e inviato a Firestore via `saveUserData`.

---

## 3. Piano di Modifica Dettagliato File per File

### File 1: `src/types.ts`
Aggiungere `id?: string;` all'interfaccia `SessionExercise`:
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
Aggiungere `id: safeOptionalString()` allo schema Zod `SessionExerciseSchema`:
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
- Aggiungere `id: Logic.generateId('se')` all'aggiunta di extra esercizi in `addExtraExercise`.
- Implementare controlli di confine in `reorderExercises`.
- Aggiungere e restituire `moveExercise`.

### File 4: `src/hooks/useWorkoutSession.ts`
- Assegnare `id: Logic.generateId('se')` in `startWorkout` e `startEditHistoricalWorkout`.
- Esportare `reorderExercises` e `moveExercise`.

### File 5: `src/store/slices/createWorkoutSlice.ts`
- In `getInitialLocalWorkout`, assicurarsi che `validated.exercises` preservi o generi `id: ex.id || Logic.generateId('se')`.

### File 6: `src/components/Training/session/SessionExerciseCard.tsx`
- Aggiungere `totalExercises?: number;` e `onMoveExercise?: (direction: -1 | 1) => void;` alle props.
- Renderizzare i pulsanti ⬆️ e ⬇️ nell'header con dark glassmorphism, touch target $\ge 44\text{px}$ (o 36-44px box), `disabled` states e `aria-label`.
- Aggiornare `React.memo` per monitorare `totalExercises` ed `exIndex`.

### File 7: `src/components/Training/TrainingSession.tsx`
- Estrarre `reorderExercises` da `useWorkoutSession()`.
- Implementare `handleMoveExercise` con riallineamento sincronizzato di `openHistoryExIndex` e `openSetupExIndex`.
- Passare `totalExercises={(activeWorkout.exercises || []).length}` e `onMoveExercise={(dir) => handleMoveExercise(exIndex, dir)}` a ciascun `SessionExerciseCard`.

---

## 4. Matrice Casi Limite (Edge Cases)

| Caso Limite | Comportamento Atteso | Soluzione di Blindatura |
|---|---|---|
| **Esercizio in cima (indice 0)** | Il tasto ⬆️ è visivamente e funzionalmente disabilitato (`disabled={true}`, opacità 0.3, `cursor: not-allowed`). Il click non muta lo stato. | `exIndex === 0` nel template e guard clause `fromIndex < 0 \|\| toIndex < 0` in `reorderExercises`. |
| **Esercizio in fondo (indice `total - 1`)** | Il tasto ⬇️ è visivamente e funzionalmente disabilitato. | `exIndex === totalExercises - 1` nel template e guard clause `toIndex >= total` in `reorderExercises`. |
| **Sessione con 1 solo esercizio** | Entrambi i pulsanti ⬆️ e ⬇️ sono disabilitati. | Condizione `totalExercises <= 1` o logica indici (`0 === 0` per ⬆️ e `0 === 1 - 1` per ⬇️). |
| **Spostamento con pannello "Storico" aperto** | Il pannello rimane aperto per l'esercizio spostato nella sua nuova posizione. | In `handleMoveExercise`: se `openHistoryExIndex === index`, aggiorna a `targetIndex`. |
| **Spostamento con pannello "Setup" aperto** | Il pannello rimane aperto per l'esercizio spostato nella sua nuova posizione. | In `handleMoveExercise`: se `openSetupExIndex === index`, aggiorna a `targetIndex`. |
| **Spostamento durante digitazione attiva (focus in input)** | La chiave React (`key={exItem.id}`) rimane stabile, impedendo lo smontaggio del DOM. | `SessionExercise.id` univoco generato via `Logic.generateId('se')`. |
| **Chiusura immediata dell'app/PWA dopo lo spostamento** | L'ordine riordinato è preservato su `localStorage['logbook_local_workout']`. | Listener `visibilitychange` in `useAppStore.ts` e debouncer sincrono su `setLocalWorkout`. |

---

## 5. Piano di Verifica e Test

1. **Unit Test per `reorderExercises` e `moveExercise`**:
   - Creare un test che verifichi lo swap di elementi `[A, B, C]` $\rightarrow$ `move(0, 1)` $\rightarrow$ `[B, A, C]`.
   - Verificare che chiamate fuori confine (`move(0, -1)` o `move(2, 1)`) non modifichino l'array.
   - Verificare la preservazione di tutti i campi delle serie (`kg`, `reps`, `dropsets`, `isometrics`, `sessionNote`).
2. **Component Test per `SessionExerciseCard`**:
   - Verificare che il tasto ⬆️ sia disabilitato per `exIndex = 0`.
   - Verificare che il tasto ⬇️ sia disabilitato per `exIndex = totalExercises - 1`.
   - Verificare che il click su ⬆️ e ⬇️ invochi `onMoveExercise(-1)` e `onMoveExercise(1)`.
3. **Integration Test in `TrainingSession`**:
   - Avviare una sessione con 3 esercizi, aprire il pannello Setup del primo, spostarlo in basso: verificare che l'ordine cambi e il pannello Setup rimanga aperto sul primo esercizio (ora a indice 1).
   - Verificare il salvataggio in `localStorage['logbook_local_workout']`.
4. **Verifica Build & Lint**:
   - `npm.cmd run build` (`tsc --noEmit && vite build`).
   - `npm.cmd test` (vitest).
