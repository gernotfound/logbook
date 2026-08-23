# Analisi Tecnica: Requisito R3 (Real-time Exercise Muscle Badge Resolution & React.memo Safety)

**Data**: 2026-08-20  
**Autore**: Explorer 2 (Milestone M2)  
**Progetto**: LogBook PWA  
**Focus**: Risoluzione in tempo reale dei metadati e dei badge muscolari degli esercizi (`SessionExerciseCard.tsx`) & blindatura del comparatore `React.memo`.

---

## 1. Executive Summary & Obiettivi

Nel contesto dell'esperienza live durante l'allenamento (`localWorkout`), il requisito **R3** stabilisce che la visualizzazione delle informazioni sull'esercizio (nome, note globali di setup, gruppi muscolari primari e secondari) debba essere **completamente reattiva e dinamica**. Se l'utente si sposta nella tab "Esercizi" e modifica le proprietà di un esercizio base (es. corregge il nome, aggiorna i muscoli o modifica le note), tali variazioni devono riflettersi immediatamente nella sessione in corso senza richiedere il riavvio della sessione né causare re-render a cascata o perdita dei dati digitati nelle serie.

### Obiettivi della presente indagine:
1. Analizzare il meccanismo attuale di risoluzione dei metadati dell'esercizio in `src/components/Training/session/SessionExerciseCard.tsx`.
2. Progettare la risoluzione dinamica e il rendering dei **badge muscolari primari e secondari** incrociando `libDef.muscles` e `libDef.secondaryMuscles` con `Logic.MUSCLES`, rispettando il design system Dark Glassmorphism e la convenzione del **Sentence case italiano** (AGENTS.md #11).
3. Esaminare e blindare il comparatore personalizzato `React.memo` di `SessionExerciseCard` per prevenire re-render spuri durante la digitazione rapida delle serie (live set logging) e scongiurare stale closures o disallineamenti di stato.
4. Identificare e gestire in modo difensivo tutti i casi limite (esercizi eliminati dall'archivio durante la sessione, esercizi ad-hoc, assenza di muscoli secondari, ID muscoli non riconosciuti).

---

## 2. Risoluzione dei Metadati dell'Esercizio (`SessionExerciseCard.tsx`)

### 2.1 Architettura e Flusso Dati Normalizzato

Nel modello dati di LogBook, `SessionExercise` (`src/types.ts:89-95`) è rigorosamente **normalizzato**:
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

`SessionExercise` memorizza solo `exId` (e i dati volatili specifici dell'allenamento: serie, ripetizioni, carichi, note di sessione). Non memorizza duplicati statici di `name`, `notes`, `muscles`, `secondaryMuscles` o `trackingType`.

### 2.2 Lookup in `TrainingSession.tsx`

In `src/components/Training/TrainingSession.tsx` (righe 60, 393-402):
```typescript
const library = useAppStore(state => state.userData?.library || EMPTY_ARRAY);
const libraryMap = useMemo(() => new Map(library.map(l => [l.id, l])), [library]);
```
Nel ciclo di rendering di `activeWorkout.exercises`:
```tsx
const libDef = libraryMap.get(exItem.exId);
const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;

return (
    <SessionExerciseCard
        key={exItem.id || `${exItem.exId}_${exIndex}`}
        exItem={exItem}
        exIndex={exIndex}
        libDef={libDef}
        pastWorkouts={pastWorkouts}
        ...
    />
);
```

### 2.3 Risoluzione Attuale vs Risoluzione Robusta con Fallback

Attualmente, `SessionExerciseCard.tsx` (righe 50-51) effettua una risoluzione base:
```typescript
const exName = libDef ? libDef.name : "Esercizio rimosso";
const exNotes = libDef ? (libDef.notes || '') : "";
```

#### Proposta di Risoluzione Difensiva Estesa:
Per gestire in modo impeccabile anche esercizi personalizzati inseriti ad-hoc o con strutture legacy, la risoluzione deve supportare fallback multilivello:
1. **Nome esercizio (`exName`)**:
   `const exName = libDef ? libDef.name : (exItem.customExerciseName || exItem.name || "Esercizio rimosso");`
2. **Note di setup globali (`exNotes`)**:
   `const exNotes = libDef ? (libDef.notes || '') : "";`
3. **Tipo di tracciamento (`trackingType`)**:
   `const trackingType = libDef?.trackingType || exItem.trackingType || 'weight_reps';`
4. **Gruppi muscolari**:
   Risolti dinamicamente tramite `Logic.MUSCLES` a partire da `libDef.muscles` e `libDef.secondaryMuscles` (se `libDef` è assente, restituiscono array vuoti `[]`).

---

## 3. Risoluzione dei Badge Muscolari e Conformità Stilistica

### 3.1 Definizione dei Muscoli nel Sistema (`src/lib/constants/muscles.ts` / `Logic.MUSCLES`)

In `src/lib/constants/muscles.ts` (esportato da `src/lib/logic.ts` come `Logic.MUSCLES`), ogni gruppo muscolare è definito dall'interfaccia `MuscleDef`:
```typescript
export interface MuscleDef {
    id: string;
    name: string;
}
```
Tutti i nomi presenti in `Logic.MUSCLES` rispettano già rigorosamente la convenzione italiana del **Sentence case**:
- `"chest"` $\rightarrow$ `"Petto"`
- `"chest_upper"` $\rightarrow$ `"Fascio clavicolare (petto alto)"`
- `"chest_lower"` $\rightarrow$ `"Fascio addominale (petto basso)"`
- `"delts_front"` $\rightarrow$ `"Deltoide anteriore"`
- `"delts_side"` $\rightarrow$ `"Deltoide laterale"`
- `"delts_rear"` $\rightarrow$ `"Deltoide posteriore"`
- `"lats"` $\rightarrow$ `"Gran dorsale"`
- `"triceps"` $\rightarrow$ `"Tricipiti"`
- `"biceps"` $\rightarrow$ `"Bicipiti"`
- `"quads"` $\rightarrow$ `"Quadricipiti"`
- `"hamstrings"` $\rightarrow$ `"Femorali"`
- `"glutes"` $\rightarrow$ `"Glutei"`
- `"abs"` $\rightarrow$ `"Addome (retto dell'addome)"`

### 3.2 Logica di Derivazione dei Badge in `SessionExerciseCard.tsx`

I gruppi muscolari primari e secondari vengono calcolati tramite `useMemo` direttamente dalle proprietà dell'oggetto `libDef`:

```typescript
const primaryMuscles = useMemo(() => {
    if (!libDef?.muscles || !Array.isArray(libDef.muscles) || libDef.muscles.length === 0) {
        return [];
    }
    return libDef.muscles.map((mId: string) => {
        const found = Logic.MUSCLES.find(m => m.id === mId);
        return {
            id: mId,
            name: found ? found.name : (mId.charAt(0).toUpperCase() + mId.slice(1))
        };
    });
}, [libDef?.muscles]);

const secondaryMuscles = useMemo(() => {
    if (!libDef?.secondaryMuscles || !Array.isArray(libDef.secondaryMuscles) || libDef.secondaryMuscles.length === 0) {
        return [];
    }
    return libDef.secondaryMuscles.map((mId: string) => {
        const found = Logic.MUSCLES.find(m => m.id === mId);
        return {
            id: mId,
            name: found ? found.name : (mId.charAt(0).toUpperCase() + mId.slice(1))
        };
    });
}, [libDef?.secondaryMuscles]);
```

### 3.3 Design System & Classi CSS

In accordo con `src/styles/global.css` e con i pattern visivi usati in `TrainingExercises.tsx` e `MuscleModelPaths.tsx`:

| Tipo Badge | Classe CSS | Stile Inline / Token CSS | Significato Visivo |
|---|---|---|---|
| **Muscolo primario** | `.badge.badge-primary` | `background: rgba(0, 229, 255, 0.12); color: var(--primary-color); border: 1px solid rgba(0, 229, 255, 0.3); font-size: 0.72rem; padding: 2px 8px; font-weight: 600;` | Target principale (Cyan / Primary Glow) |
| **Muscolo secondario** | `.badge` | `background: rgba(77, 182, 172, 0.15); color: #4db6ac; border: 1px solid rgba(77, 182, 172, 0.35); font-size: 0.72rem; padding: 2px 8px; font-weight: 500;` | Muscolo sinergico/stabilizzatore (Teal #4db6ac) |

#### Struttura JSX da inserire sotto al titolo dell'esercizio:
```tsx
{(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
    <div 
        style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '6px', 
            alignItems: 'center', 
            marginTop: '4px', 
            marginBottom: '10px' 
        }}
    >
        {primaryMuscles.map(m => (
            <span
                key={`prim-${m.id}`}
                className="badge badge-primary"
                style={{ fontSize: '0.72rem', padding: '2px 8px', fontWeight: 600 }}
            >
                {m.name}
            </span>
        ))}
        {secondaryMuscles.map(m => (
            <span
                key={`sec-${m.id}`}
                className="badge"
                style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    background: 'rgba(77, 182, 172, 0.15)',
                    color: '#4db6ac',
                    border: '1px solid rgba(77, 182, 172, 0.35)',
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

## 4. `React.memo` & Performance Safety

### 4.1 Problema del Re-rendering nei Workout Attivi
In una sessione di allenamento con 8-12 esercizi e decine di serie:
- L'atleta digita ripetutamente carichi (`kg`) e ripetizioni (`reps`) su tastiera mobile.
- Ogni tasto premuto esegue un aggiornamento immutabile di `localWorkout.exercises` nello store Zustand.
- Se tutti i componenti card si ri-renderizzassero ad ogni battuta, si verificherebbero micro-lag percepibili, ritardo dell'input touch e consumo eccessivo di batteria.

### 4.2 Analisi del Comparatore Personalizzato di `SessionExerciseCard`

Il componente è incapsulato con `React.memo`:
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

### 4.3 Comportamento nei Due Flussi Fondamentali

#### Flusso 1: Digitazione rapida dei set (Live Set Logging)
1. L'utente digita un carico nell'Esercizio all'indice 0.
2. `useWorkoutSetMutations.ts` genera una nuova referenza per `exercises[0]`.
3. Gli elementi `exercises[1]`, `exercises[2]`, ... mantengono la **stessa identica referenza in memoria** (`prev.exItem === next.exItem` risulta `true`).
4. `library` non è mutata, quindi `prev.libDef === next.libDef` risulta `true` per tutte le card.
5. Gli altri flag (`pastWorkouts`, `isHistoryOpen`, `isSetupOpen`, `openSpecialMenuId`, `exIndex`, `totalExercises`) sono identici.
6. **Esito**: Solo la card all'indice 0 si aggiorna. Tutte le altre card saltano completamente il re-render.
7. All'interno della card 0, grazie al `React.memo` di `SessionSetRow`, solo la specifica riga modificata si ri-renderizza.

#### Flusso 2: Modifica dell'Esercizio in Libreria (R3 Real-time Sync)
1. L'utente apre la tab "Esercizi" (`TrainingExercises.tsx`) e modifica il nome o i muscoli dell'esercizio `ex_bench`.
2. Zustand aggiorna `userData.library` con una nuova lista in cui solo l'oggetto `ex_bench` ha un nuovo riferimento di memoria.
3. In `TrainingSession.tsx`, il listener Zustand rileva il cambio di `library` e ricalcola `libraryMap`.
4. Nel render di `TrainingSession.tsx`:
   - Per `ex_bench`: `next.libDef` è il nuovo oggetto modificato $\rightarrow$ `prev.libDef === next.libDef` è `false` $\rightarrow$ la card di `ex_bench` si ri-renderizza all'istante, visualizzando subito il nuovo nome e i nuovi badge muscolari.
   - Per gli altri esercizi non modificati: `prev.libDef === next.libDef` è `true` $\rightarrow$ saltano il re-render.

### 4.4 Perché le Callback Inline Vengono Escluse dal Comparatore?

In `TrainingSession.tsx`, le funzioni passate a `SessionExerciseCard` (`onAddSet`, `onUpdateSet`, `onToggleHistory`, `onMoveExercise`, ecc.) sono funzioni freccia inline (es. `onAddSet={() => addSet(exIndex)}`).
- A ogni render di `TrainingSession`, queste funzioni ricevono una nuova referenza `Function`.
- Se il comparatore confrontasse superficialmente le props (o includesse `prev.onAddSet === next.onAddSet`), il memoizzazione fallirebbe al 100% su tutte le card.
- Escludere i riferimenti delle funzioni dal comparatore e includere invece **tutti i dati di stato che le governano** (`exIndex`, `totalExercises`, `isHistoryOpen`, `isSetupOpen`, `openSpecialMenuId`) garantisce sia l'efficacia del `React.memo` sia l'assenza totale di stale closures quando l'esercizio si sposta di indice.

---

## 5. Casi Limite (Edge Cases) e Blindatura Difensiva

| # | Scenario / Caso Limite | Possibile Rischio | Meccanismo di Risoluzione Difensiva |
|---|---|---|---|
| 1 | **Esercizio eliminato dalla libreria durante la sessione** | `libraryMap.get(exId)` restituisce `undefined`. Rischio `TypeError: Cannot read properties of undefined (reading 'muscles')`. | Guard clause opzionali `libDef?.muscles` e `libDef?.secondaryMuscles`. Fallback nome `"Esercizio rimosso"`. Array muscoli restituiscono `[]`, nessun crash. |
| 2 | **Esercizio personalizzato creato on-the-fly** | L'esercizio non ha un `exId` registrato in `library`. | Controllo su `exItem.customExerciseName || exItem.name`. I badge non crashano ma rimangono nascosti in modo pulito. |
| 3 | **Esercizio con soli muscoli primari** (`secondaryMuscles: undefined`) | Tentativo di iterare `undefined`. | `!Array.isArray(libDef.secondaryMuscles)` intercettato all'istante da `useMemo` che restituisce `[]`. |
| 4 | **Esercizio con soli muscoli secondari o nessun muscolo** | Contenitore badge vuoto che occupa spazio verticale indesiderato. | Controllo condizionale wrapper `{(primaryMuscles.length > 0 \|\| secondaryMuscles.length > 0) && ...}`: se entrambi sono vuoti, il DOM non alloca spazio. |
| 5 | **ID muscolo non presente in `Logic.MUSCLES`** | Visualizzazione di `undefined` o stringa vuota. | Fallback: `found ? found.name : (mId.charAt(0).toUpperCase() + mId.slice(1))`. |
| 6 | **ID muscolo presente sia in primari che in secondari** | Warning React per collisione di chiavi (`Encountered two children with the same key`). | Prefissi univoci nelle chiavi React: `key={`prim-${m.id}`}` e `key={`sec-${m.id}`}`. |
| 7 | **Riordino degli esercizi durante la sessione (R2 + R3)** | Disallineamento dei pulsanti ⬆️ e ⬇️. | Inclusione di `prev.exIndex === next.exIndex` e `prev.totalExercises === next.totalExercises` nel comparatore `React.memo`. |

---

## 6. Piano di Implementazione Concreto per R3

### File Target: `src/components/Training/session/SessionExerciseCard.tsx`

#### Modifiche Dettagliate:
1. **Import `Logic`**:
   Importare `Logic` da `../../../lib/logic` per accedere all'archivio `Logic.MUSCLES`.
2. **Prop Interface**:
   Estendere `SessionExerciseCardProps` con `totalExercises?: number;` e `onMoveExercise?: (direction: -1 | 1) => void;`.
3. **Calcolo `primaryMuscles` e `secondaryMuscles`**:
   Aggiungere i due hook `useMemo` per mappare gli ID muscolari nei nomi localizzati in italiano sentence case.
4. **Rendering JSX dei Badge**:
   Inserire il container flessibile con badge primari (`.badge.badge-primary`) e secondari (`.badge` con styling teal `#4db6ac`) subito sotto l'intestazione dell'esercizio.
5. **Comparatore `React.memo`**:
   Aggiornare il secondo argomento di `React.memo` per validare `prev.exIndex === next.exIndex` e `prev.totalExercises === next.totalExercises`.

```tsx
// Snippet proposto per SessionExerciseCard.tsx

import React, { useCallback, useMemo } from 'react';
import { useDialogStore } from '../../../store/useDialogStore';
import { Logic } from '../../../lib/logic';
import SessionSetRow from './SessionSetRow';

// ... all'interno di SessionExerciseCardInner:

const primaryMuscles = useMemo(() => {
    if (!libDef?.muscles || !Array.isArray(libDef.muscles) || libDef.muscles.length === 0) {
        return [];
    }
    return libDef.muscles.map((mId: string) => {
        const found = Logic.MUSCLES.find(m => m.id === mId);
        return {
            id: mId,
            name: found ? found.name : (mId.charAt(0).toUpperCase() + mId.slice(1))
        };
    });
}, [libDef?.muscles]);

const secondaryMuscles = useMemo(() => {
    if (!libDef?.secondaryMuscles || !Array.isArray(libDef.secondaryMuscles) || libDef.secondaryMuscles.length === 0) {
        return [];
    }
    return libDef.secondaryMuscles.map((mId: string) => {
        const found = Logic.MUSCLES.find(m => m.id === mId);
        return {
            id: mId,
            name: found ? found.name : (mId.charAt(0).toUpperCase() + mId.slice(1))
        };
    });
}, [libDef?.secondaryMuscles]);

// ... nel JSX sotto l'header:
{(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '4px', marginBottom: '10px' }}>
        {primaryMuscles.map(m => (
            <span
                key={`prim-${m.id}`}
                className="badge badge-primary"
                style={{ fontSize: '0.72rem', padding: '2px 8px', fontWeight: 600 }}
            >
                {m.name}
            </span>
        ))}
        {secondaryMuscles.map(m => (
            <span
                key={`sec-${m.id}`}
                className="badge"
                style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    background: 'rgba(77, 182, 172, 0.15)',
                    color: '#4db6ac',
                    border: '1px solid rgba(77, 182, 172, 0.35)',
                    fontWeight: 500
                }}
            >
                {m.name}
            </span>
        ))}
    </div>
)}

// ... comparatore React.memo:
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

## 7. Metodo di Verifica Indipendente

1. **Unit Test e Stress Test `React.memo`**:
   Eseguire `npm.cmd test tests/challenger_react_hooks_memo_stress.test.tsx` e `npm.cmd test tests/training_session_ui_improvements.test.tsx` per accertare che la digitazione delle serie continui a non innescare re-render sulle altre card.
2. **Build & Type Check**:
   Eseguire `npm.cmd run build` (`tsc -b && vite build`) per validare l'integrità dei tipi e delle interfacce.
3. **Linter**:
   Eseguire `npm.cmd run lint` (`oxlint .`) per assicurare 0 errori e conformità stilistica.
4. **Verifica Funzionale End-to-End**:
   - Avviare un allenamento contenente un esercizio con muscoli primari (es. Panca piana $\rightarrow$ Petto, Tricipiti) e secondari (Deltoide anteriore).
   - Verificare la corretta resa cromatica dei badge (Cyan per primari, Teal per secondari, testo in Sentence case).
   - Modificare l'esercizio nella libreria e verificare l'aggiornamento real-time nella sessione attiva.
