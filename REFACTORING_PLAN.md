# Piano d'Azione: Refactoring (Performance & AI-friendliness)

Questo documento definisce la strategia incrementale per snellire i file principali del progetto LogBook. L'obiettivo è duplice: migliorare le prestazioni di runtime (evitando re-render costosi) e mantenere i file al di sotto delle 250 righe per garantire la massima efficienza e precisione negli interventi da parte dell'Intelligenza Artificiale.

---

## 1. Obiettivi e criteri di successo

### Performance (Leggerezza nell'esecuzione)
- **Target:** Ridurre i re-render inutili nelle viste di allenamento e pianificazione.
- **Misura:** L'inserimento di un dato (es. kg in una serie o cambio del nome di una scheda) non deve causare lag visibile su mobile di media gamma (commit React idealmente < 50ms).
- **Target Architetturale:** Numero di componenti "core" > 300 righe pari a 0. Numero di file con più di 3 responsabilità distinte pari a 0.

### AI-friendliness (Facilità di modifica da parte delle AI)
- **Target:** Nessun componente UI core deve superare le 200-250 righe.
- **Regola pratica di taglio:** Se un file supera le 250 righe E contiene più di 2 responsabilità distinte (es. form + preview + logica date) OPPURE più di 3 `useEffect` / logiche complesse, DEVE essere ulteriormente spezzato. I componenti "atomici" (riga esercizio, card) devono stare tra le 60 e le 150 righe.

---

## 2. Inventario dei file da refactorare e Strategia di scomposizione

| File Target | Righe | Componenti/Hook da estrarre | Responsabilità / Motivazione | Priorità |
| :--- | :--- | :--- | :--- | :--- |
| `src/components/Training/TrainingSession.tsx` | ~520 | `TrainingSessionSetup.tsx`<br>`ActiveWorkoutSession.tsx`<br>`SessionHeader.tsx` | Attualmente gestisce sia lo stato di "riposo" (scelta scheda) che l'allenamento attivo. Separandoli, si isolano i due domini. | **Alta** (Step 1) |
| `src/components/Training/planning/CycleEditor.tsx` | ~750 | `useCycleForm.ts`<br>`CycleSchedulePreview.tsx`<br>`CycleRoutinesList.tsx` | Il file unisce un form enorme, la logica complessa delle date e il motore di preview del calendario. | **Media** (Step 2) |
| `src/lib/schema.ts` | ~800 | `schema_training.ts`<br>`schema_nutrition.ts`<br>`schema_profile.ts` | Validazione monolitica di Zod. Dividerla per dominio mantiene il file `schema.ts` come semplice entry-point/orchestratore. | **Bassa** (Step 3) |
| `src/lib/db.ts` | ~600 | `db_training.ts`<br>`db_nutrition.ts` | Stessa motivazione dello schema. Le query a Firestore possono essere modularizzate. | **Bassa** (Step 4) |

---

## 3. Linee Guida di Architettura e Sviluppo

### 3.1 Regole di Memoizzazione e Stato (Prevenzione Re-render)
- **`React.memo`:** Ogni riga esercizio / input di serie deve essere un componente memoizzato con props stabili.
- **`useCallback`:** Evitare di passare funzioni ricreate a ogni render ai componenti memoizzati. Usare `useCallback` per le handler che cambiano dati di una singola serie.
- **Zustand Selectors:** Tenere nello store solo dati "di dominio". Se usi selettori, preferisci selettori stretti (es. `useStore(s => s.workout.exercises[i].sets[j])`) invece di agganciarti ad alberi di stato enormi che invaliderebbero il componente a ogni minima modifica altrove.

### 3.2 Contratti TypeScript e "Surface" Stabile
Ogni nuovo componente/hook estratto deve definire esplicitamente le proprie interfacce:
- `TrainingSessionSetupProps`, `ActiveWorkoutSessionProps`, `SessionHeaderProps`.
- Le signature degli hook devono essere tipizzate in modo rigoroso (es. `useCycleForm(): { startDate: string, setStartDate: (d: string) => void, ... }`).
In questo modo le AI leggono il contratto senza dover interpretare l'intera implementazione.

### 3.3 Dipendenze Incrociate
- **UI → Hook → Store/DB**: I nuovi componenti visivi (UI) non devono importare direttamente `db.ts` o funzioni di mutazione Firestore. La logica di persistenza è orchestrata dagli hook di livello superiore (es. `useActiveWorkout`).

### 3.4 Documentazione Minima per AI
In testa a ogni nuovo file (componente o hook), includere 2-3 righe di commento standardizzato:
```tsx
// Responsabilità: renderizzare la UI di un allenamento in corso (lista esercizi, timer).
// Props: activeWorkout (WorkoutSession), onFinish (callback).
// Effetti: nessuno diretto sul DB; chiama le callback passate dal parent.
```

---

## 4. Ordine di esecuzione (Checklist operativa)

Seguire questa sequenza per garantire un approccio a zero-rischi.

- [x] **Step 1: Preparazione e Baseline**
  - Creare un branch dedicato se in team, o confermare la working copy pulita.
  - Verificare che la build funzioni (`npm run build`).

- [x] **Step 2: Split di `TrainingSession.tsx`**
  - Creare `TrainingSessionSetup.tsx` e `ActiveWorkoutSession.tsx` applicando le regole di memoizzazione e i commenti per l'AI.
  - Aggiornare `TrainingSession.tsx` affinché diventi un puro selettore/orchestratore di viste.
  - **Test di regressione minima (Manuale su App/Preview):**
    - Avviare un allenamento da scheda → inserire kg/ripetizioni → completare l'allenamento → verificare che il log compaia in History.
    - Avviare un allenamento libero e cancellarlo in corso → verificare che si resetti.

- [x] **Step 3: Refactoring di `CycleEditor.tsx`**
  - Estrarre le logiche del form in `useCycleForm.ts`.
  - Spostare il JSX della preview in `CycleSchedulePreview.tsx`.
  - **Test di regressione minima (Manuale su App/Preview):**
    - Creare un nuovo ciclo → modificare data inizio/durata in settimane → verificare che la preview del calendario si aggiorni istantaneamente.
    - Salvare il ciclo e verificare che persista ricaricando l'app.

- [x] **Step 4 (Opzionale): Split di Backend e Validazione**
  - Creare `src/lib/schemas/` e dividere `schema.ts`. Mantenere l'export di `UserDataSchema` dal file principale.
  - Creare `src/lib/db/` e dividere `db.ts`. Mantenere `DB` esportato dal file principale.

---

## 5. Risk Register (Rischi e Mitigazioni)

- **Rischio:** Cambiare la struttura delle Props e rompere i componenti figli.
  - *Mitigazione:* Mantenere le stesse Props pubbliche attuali. Se vanno cambiate, farlo nello stesso identico commit in cui si aggiornano i chiamanti.
- **Rischio:** Introdurre re-render extra estraendo la logica in alto.
  - *Mitigazione:* Verificare visivamente e strumentalmente. Dopo lo split, testare l'input di una singola riga di esercizio e assicurarsi (anche a occhio o con React DevTools) che l'intera lista non lampeggi.
- **Rischio:** Accoppiamento forte alle implementazioni interne di `schema.ts`.
  - *Mitigazione:* Lasciare l'entry-point pubblico di validazione inalterato, le suddivisioni saranno solo interne.
