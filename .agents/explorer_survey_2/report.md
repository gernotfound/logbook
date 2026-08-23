# Report di Indagine Tecnica — Survey Explorer 2

**Data indagine:** 2026-08-20  
**Ambito:** Requisiti R3 (Selettore data in Misurazioni) e R4 (Allineamento verticale pallino speciale in SessionSetRow)  
**Ruolo:** Explorer 2 (Read-only Investigation)  
**Target files identificati:**
- `src/components/Data/DataView.tsx`
- `src/components/Data/DataMeasurements.tsx`
- `src/hooks/useNutritionMeasurements.ts`
- `src/components/Data/DataHistory.tsx`
- `src/components/Nutrition/NutritionMeals.tsx` (Riferimento UI/UX Date Navigator)
- `src/components/Nutrition/NutritionSupplements.tsx` (Riferimento UI/UX Date Navigator)
- `src/components/Training/session/SessionSetRow.tsx`
- `src/styles/global.css`

---

## 1. Executive Summary

L'indagine tecnica ha analizzato a fondo:
1. **Requisito R3 (Spostamento e allineamento selettore data in Misurazioni):** Attualmente la schermata *Misurazioni* (`DataMeasurements.tsx`) sotto la tab *Dati* non possiede alcun selettore temporale né componente di navigazione a calendario al vertice. La data di inserimento è vincolata al giorno odierno (`Logic.getLocalDateString()`), a meno che l'utente non vada esplicitamente nella sotto-tab *Storico* e selezioni una misurazione passata (`handleSelectEdit`). Per uniformare l'esperienza utente a quella di *Pasti* (`NutritionMeals.tsx`) e *Integratori* (`NutritionSupplements.tsx`), occorre introdurre il **Date Navigator** standard (`◀ Prec.`, data formattata in italiano, badge `OGGI`, `Succ. ▶`) nella parte superiore della vista / card di `DataMeasurements.tsx`, integrando il controllo di `selectedDate` a livello di `DataView.tsx` e `useNutritionMeasurements.ts`.
2. **Requisito R4 (Allineamento verticale pallino speciale in SessionSetRow.tsx):** Nel componente `SessionSetRow.tsx`, il bottone circolare blu con l'icona `+` (trigger per il menu contestuale *Dropset / Isometria*) soffre di uno sfalsamento visivo verso l'alto di 5-7px rispetto ai campi input (`kg`, `reps`/`time`) e all'etichetta `S1`/`S2`. La causa principale risiede nel container flex intermedio (`div` che avvolge input e bottone) a cui manca `align-items: center` (eredita il default `stretch`), mentre gli input hanno un'altezza di ~48px e il bottone ha `height: 36px`, venendo allineato al margine superiore (`flex-start`). Inoltre, la classe `.btn-icon` in `global.css` impone un `padding: 6px` senza `display: flex; align-items: center; justify-content: center;`, determinando un disallineamento interno del glifo `+`.

---

## 2. Indagine Dettagliata Requisito R3 (Selettore Data in Misurazioni)

### 2.1 Stato Attuale del Codebase

#### 1. `src/components/Nutrition/NutritionMeals.tsx` e `src/components/Nutrition/NutritionSupplements.tsx` (Modello di riferimento)
In entrambe le viste alimentari, il componente renderizza in cima un Date Navigator compatto:
```tsx
// src/components/Nutrition/NutritionMeals.tsx (Linee 58-72)
{/* Date Navigator */}
{setSelectedDate && (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <button className="btn btn-small" onClick={handlePrevDay} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)' }}>◀ Prec.</button>
        <div style={{ textAlign: 'center', flex: 1, margin: '0 10px', cursor: 'pointer' }} onClick={handleToday} title="Torna a oggi">
            <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                {Logic.formatItalianDate ? Logic.formatItalianDate(targetDateStr || '') : targetDateStr}
            </div>
            {targetDateStr === Logic.getLocalDateString() && (
                <div style={{ fontSize: '0.7rem', color: 'var(--primary-color)' }}>OGGI</div>
            )}
        </div>
        <button className="btn btn-small" onClick={handleNextDay} disabled={targetDateStr === Logic.getLocalDateString()} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', opacity: targetDateStr === Logic.getLocalDateString() ? 0.3 : 1 }}>Succ. ▶</button>
    </div>
)}
```
La gestione dello stato della data è collocata nel componente padre `NutritionView.tsx`:
```tsx
// src/components/Nutrition/NutritionView.tsx (Linee 19-20)
const [selectedDate, setSelectedDate] = useState<string>(Logic.getLocalDateString());
const mealsHook = useNutritionMeals(selectedDate);
```
Quando l'utente seleziona un giorno dallo storico (`NutritionHistory.tsx`), viene invocato `handleHistoryDayClick` che imposta `setSelectedDate(dateStr)` e rimanda alla tab `meals`.

#### 2. `src/components/Data/DataView.tsx` e `src/components/Data/DataMeasurements.tsx` (Stato Attuale)
In `DataView.tsx` (linee 18-30):
- Viene istanziato `useNutritionMeasurements()` senza alcun parametro di data.
- Quando si clicca un elemento in `DataHistory`, viene chiamato:
  ```tsx
  const handleSelectEdit = (day: any) => {
      measurementsHook.handleEditClick(day);
      sleepHook.setEditingDate(day.date);
      changeSubTab('measurements');
  };
  ```
- In `DataMeasurements.tsx`:
  - Non c'è alcun componente per scorrere o selezionare le date.
  - La card mostra solo l'orario di rilevazione (`#measure-time`) e i campi peso/circonferenze.
  - Se l'utente vuole inserire o controllare le misurazioni di ieri o di giorni passati direttamente dalla schermata Misurazioni, non può farlo.

#### 3. `src/hooks/useNutritionMeasurements.ts`
- Ha `todayDateStr = Logic.getLocalDateString()` fisso.
- Ha `[editingDate, setEditingDate] = useState<string | null>(null)`.
- La persistenza di bozza (`localStorage.getItem('draft_measurement')`) è sincronizzata solo sul giorno corrente `todayDateStr`.
- In `calculateAndSave`:
  ```tsx
  const targetDate = editingDate || todayDateStr;
  ```

### 2.2 Modifiche Proposte per R3

1. **Gestione dello stato data in `DataView.tsx`:**
   - Aggiungere `const [selectedDate, setSelectedDate] = useState<string>(Logic.getLocalDateString());`.
   - Passare `selectedDate` e `setSelectedDate` all'hook `useNutritionMeasurements(selectedDate)` e al componente `DataMeasurements`.
   - In `handleSelectEdit(day)`: impostare `setSelectedDate(day.date)`.

2. **Aggiornamento di `useNutritionMeasurements.ts`:**
   - Accettare un parametro opzionale `selectedDate?: string`.
   - Calcolare `targetDateStr = selectedDate || editingDate || Logic.getLocalDateString()`.
   - Quando `targetDateStr` cambia:
     - Leggere i dati da `nutrition[targetDateStr]`.
     - Se `targetDateStr === Logic.getLocalDateString()` e non ci sono dati registrati, ripristinare l'eventuale bozza da `localStorage.getItem('draft_measurement')`.
     - Se per `targetDateStr` esistono dati registrati, popolare i relativi campi (`weight`, `waist`, `neck`, `hip`, `manualBf`, `chest`, `shoulders`, `biceps`, `thighs`, `calves`, `measureTime`).
     - Se per `targetDateStr` (diverso da oggi) non ci sono dati, svuotare i campi per consentire l'inserimento pulito.
   - In `calculateAndSave`: salvare su `targetDateStr`.
   - Supportare il reset / pulizia coerente.

3. **Integrazione UI in `DataMeasurements.tsx`:**
   - Inserire in cima (sopra la card o come header primario della card) il Date Navigator identico a `NutritionMeals.tsx`:
     - Pulsante `◀ Prec.` (arretra di 1 giorno).
     - Sezione centrale con `Logic.formatItalianDate(targetDateStr)` e badge `OGGI` se `targetDateStr === Logic.getLocalDateString()`. Cliccando la data centrale si torna a oggi.
     - Pulsante `Succ. ▶` (avanza di 1 giorno, disabilitato e opacizzato con `opacity: 0.3` se la data visualizzata è oggi).
   - Intestazione card: Adattare il titolo per mostrare `✏️ Modifica misurazione` se esistono già misurazioni per quella data o `➕ Nuova misurazione` se non ancora registrata per quel giorno.

---

## 3. Indagine Dettagliata Requisito R4 (Allineamento Verticale Pallino Speciale in SessionSetRow.tsx)

### 3.1 Stato Attuale del Codebase

File: `src/components/Training/session/SessionSetRow.tsx` (Linee 31-97)

```tsx
<div className="set-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '10px', border: '1px solid var(--primary-color)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '75px' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>S{sIndex + 1}</span>
        <button 
            className="btn-icon" 
            style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }} 
            onClick={() => onRemoveSet(sIndex)}
            aria-label={`Rimuovi serie ${sIndex + 1}`}
        >
            🗑️
        </button>
    </div>
    <div style={{ display: 'flex', gap: '5px', flex: 1, position: 'relative', minWidth: 0 }}>
        {/* Input kg e reps/time */}
        <input ... style={{ margin: 0, flex: 1, minWidth: 0 }} />
        <input ... style={{ margin: 0, flex: 1, minWidth: 0 }} />
        
        <button 
            className="btn-icon" 
            style={{ background: 'var(--primary-color)', borderRadius: '50%', width: '36px', height: '36px', color: '#fff', flexShrink: 0 }} 
            onClick={onToggleMenu}
            aria-label="Aggiungi dropset o isometria"
        >
            +
        </button>
        ...
```

### 3.2 Analisi di Causa Radice (Root Cause)

1. **Disallineamento nel Flex Container:**
   - Il container interno `<div style={{ display: 'flex', gap: '5px', flex: 1, position: 'relative', minWidth: 0 }}>` contiene gli input e il bottone `+`.
   - Questo container NON ha specificato `alignItems: 'center'`. Per le specifiche CSS Flexbox, il valore predefinito è `align-items: stretch`.
   - Gli input hanno stili globali (`global.css`, linee 190-208) con `min-height: 48px`, `padding: 14px`, determinando un'altezza effettiva del blocco di ~48px-52px.
   - Il bottone circolare ha `height: 36px` e `width: 36px`.
   - Non avendo `align-items: center` sul genitore né `align-self: center` sul bottone, il bottone si posiziona sul bordo superiore (`flex-start`, $y = 0$). Di conseguenza, mentre il centro verticale degli input è a $\approx 24\text{px}$, il centro del bottone è a $18\text{px}$, risultando sfalsato verso l'alto di $\approx 6\text{px}$.
   - Rispetto al blocco di sinistra contenente `"S1"` (che si trova centrato a $y = 24\text{px}$ grazie a `alignItems: 'center'` su `.set-row`), il bottone `+` risulta visibilmente sbilanciato verso l'alto.

2. **Centratura interna del glifo `+` nel bottone:**
   - La classe globale `.btn-icon` (`global.css`, linea 268) ha:
     ```css
     .btn-icon { background: transparent; border: none; font-size: 1.2rem; cursor: pointer; padding: 6px; border-radius: 50%; transition: background 0.2s;}
     ```
   - Il padding residuo di `6px` e l'assenza di `display: flex; align-items: center; justify-content: center;` portano il carattere `+` a non essere perfettamente centrato all'interno del cerchio blu di 36x36 pixel.

### 3.3 Modifiche Proposte per R4

In `src/components/Training/session/SessionSetRow.tsx`:

1. **Aggiungere `alignItems: 'center'` al flex container degli input e dell'azione (linea 43):**
   ```tsx
   <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, position: 'relative', minWidth: 0 }}>
   ```

2. **Perfezionare lo stile inline del bottone `+` (linee 89-96):**
   ```tsx
   <button 
       className="btn-icon" 
       style={{ 
           background: 'var(--primary-color)', 
           borderRadius: '50%', 
           width: '36px', 
           height: '36px', 
           color: '#fff', 
           flexShrink: 0,
           display: 'inline-flex',
           alignItems: 'center',
           justifyContent: 'center',
           padding: 0,
           margin: 0,
           fontSize: '1.25rem',
           lineHeight: 1,
           alignSelf: 'center'
       }} 
       onClick={onToggleMenu}
       aria-label="Aggiungi dropset o isometria"
   >
       +
   </button>
   ```

3. **Verifica righe Dropset e Isometrie (linee 130-151):**
   Applicare la medesima consistenza flexbox ai sotto-elementi delle serie speciali:
   - Linea 132 (Dropset): `<div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>`
   - Linea 146 (Isometria): `<div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>`
   - I pulsanti di rimozione `✕` beneficiano anch'essi di `display: inline-flex; align-items: center; justify-content: center; padding: 0;` per un perfetto allineamento sull'asse orizzontale.

---

## 4. Evidence Chain Completa

| Elemento / Problema | File Sorgente | Linee Esatte | Descrizione Osservazione |
|---|---|---|---|
| Date Navigator Pasti | `src/components/Nutrition/NutritionMeals.tsx` | L. 58-72 | Render del Date Navigator con `handlePrevDay`, `handleNextDay`, `handleToday`, `Logic.formatItalianDate`. |
| Date Navigator Integratori | `src/components/Nutrition/NutritionSupplements.tsx` | L. 97-110 | Render speculare del Date Navigator identico a Pasti. |
| Assenza Date Navigator in Misurazioni | `src/components/Data/DataMeasurements.tsx` | L. 50-74 | La card inizia direttamente con `#measurement-form-card`, `h2` e `#measure-time`, senza alcun selettore data. |
| Gestione Hook Misurazioni | `src/hooks/useNutritionMeasurements.ts` | L. 15-28, L. 174 | `todayDateStr` fisso, `editingDate` valorizzato solo da `handleEditClick`, nessun parametro `selectedDate`. |
| Mancanza `alignItems: 'center'` su input container | `src/components/Training/session/SessionSetRow.tsx` | L. 43 | `<div style={{ display: 'flex', gap: '5px', flex: 1, position: 'relative', minWidth: 0 }}>` manca di `alignItems: 'center'`. |
| Bottone speciale `+` privo di flex centering | `src/components/Training/session/SessionSetRow.tsx` | L. 89-96 | `style={{ background: 'var(--primary-color)', borderRadius: '50%', width: '36px', height: '36px', color: '#fff', flexShrink: 0 }}` privo di `display: inline-flex`, `padding: 0`, `alignItems: 'center'`, `justifyContent: 'center'`. |
| Stile globale `.btn-icon` | `src/styles/global.css` | L. 268 | `.btn-icon` ha `padding: 6px`, che altera il box model circolare se combinato a `width`/`height` fisse. |

---

## 5. Metodo di Verifica Indipendente

1. **Verifica Statica e Linter:**
   - Eseguire `npm.cmd run lint` per verificare conformità oxlint.
   - Eseguire `npm.cmd run build` per verificare TypeScript typecheck senza errori.
2. **Verifica Test Unitari:**
   - Eseguire `npm.cmd test -- --run`.
3. **Verifica UI R3:**
   - Aprire la tab *Dati* $\rightarrow$ sotto-tab *Misurazioni*.
   - Verificare che il componente `Date Navigator` sia presente in cima alla vista (sopra/in cima alla card).
   - Cliccare `◀ Prec.`: la data mostrata deve arretrare al giorno precedente e caricare i dati registrati per quella data (o campi vuoti se assenti).
   - Cliccare `Succ. ▶`: deve avanzare di un giorno, risultando disabilitato quando si raggiunge la data odierna (`OGGI`).
   - Cliccare la data centrale ("OGGI"): deve reimpostare immediatamente la data a oggi.
   - Inserire un valore di peso/circonferenze per un giorno precedente e salvare: verificare che i dati siano salvati correttamente sotto `nutrition[targetDate]` nello store.
4. **Verifica UI R4:**
   - Aprire una sessione di allenamento attiva (*Allenamento*).
   - In una scheda esercizio con serie normale, verificare che il pallino blu `+` sia perfettamente allineato al centro verticale sia rispetto ai campi input `Kg` e `Reps` sia rispetto al testo `"S1"`, `"S2"`.
