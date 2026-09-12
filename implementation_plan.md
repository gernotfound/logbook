# Implementation Plan

## Obiettivi
1. **Miglioramento UX bottoni "Crea esercizio" e "Crea scheda"**: Inserire il simbolo + / - nel tasto. Quando il form di creazione è aperto, il tasto deve rimanere visibile con il simbolo - (invece di scomparire) permettendo di chiudere il box cliccandoci sopra.
2. **Allenamento Libero**: Aggiungere un tasto per avviare un allenamento senza selezionare una scheda preesistente. Al termine di questo allenamento, inserire un bottone "Salva come nuova scheda" per generare una routine a partire dagli esercizi eseguiti.
3. **Miglioramento Login da Guest**: Modificare il banner della modalità senza account affinché mostri un bottone "Accedi" (invece dell'accesso diretto con Google). Cliccando "Accedi", si apre la schermata standard di login/registrazione permettendo all'utente di scegliere se preservare i dati guest (funzione supportata tramite checkbox dedicato).

## File Coinvolti e Modifiche

### 1. UX Bottoni "Crea Esercizio/Scheda"
- **src/components/Training/TrainingExercises.tsx**
  - Modificare il render del bottone Crea esercizio: rimuovere la condizione !isCreating in modo che il bottone sia sempre renderizzato, eccetto quando editingExId è attivo (poiché c'è già la modalità modifica in quel caso).
  - Cambiare l'etichetta in {isCreating ? '- Crea esercizio' : '+ Crea esercizio'} e la funzione onClick per fare il toggle setIsCreating(!isCreating).
- **src/components/Training/TrainingRoutines.tsx**
  - Applicare la stessa logica di toggle per il bottone {isCreating ? '- Crea scheda' : '+ Crea scheda'} con setIsCreating(!isCreating).

### 2. Allenamento Libero
- **src/components/Training/TrainingSessionSetup.tsx**
  - Aggiungere il bottone "Allenamento libero" nella sezione "Avvia nuova sessione", indipendente dal menu a tendina delle schede.
  - Al click, invocare startWorkout('free').
- **src/hooks/useWorkoutSession.ts**
  - Nella funzione startWorkout(targetId), se 	argetId === 'free', bypassare la ricerca della scheda nell'archivio. Creare una WorkoutSession vuota e generare un outineId univoco (es. Logic.generateId('free')) per evitare che WorkoutReportModal consideri tutti gli allenamenti liberi come appartenenti alla stessa scheda. Impostare outineName: 'Allenamento libero' e un array exercises vuoto.
- **src/components/Training/WorkoutReportModal.tsx**
  - Nel footer, verificare se workout.routineName === 'Allenamento libero'. Se sì, mostrare un bottone addizionale "Salva come nuova scheda".
  - Il bottone invocherà lo store (saveUserData) per creare una nuova WorkoutRoutine (es. nome "Scheda da Allenamento libero") mappando i SessionExercise a RoutineExercise (estraendo exId e calcolando setsCount = ex.sets.length), dopodiché informerà l'utente con uno showAlert.

### 3. LoginBox da Guest Banner
- **src/App.tsx**
  - Aggiungere uno stato locale const [showGuestLogin, setShowGuestLogin] = useState(false).
  - Nel GuestBanner, cambiare il testo da "Collega Google" a "Accedi". Al click, chiamare setShowGuestLogin(true).
  - Mostrare <LoginBox /> in un overlay se showGuestLogin è true. Passare una prop onClose={() => setShowGuestLogin(false)} per permettere la chiusura.
- **src/components/UI/LoginBox.tsx**
  - Accettare la prop opzionale onClose. Aggiungere un bottone X per chiudere il box se onClose è definito.
  - Aggiungere uno stato per un checkbox "Salva i progressi della sessione locale" (default: checked) mostrato solo se isGuest è true nel context.
  - Passare questo valore come parametro alle funzioni di auth (loginWithEmail, egisterWithEmail, login).
- **src/contexts/AuthContext.tsx**
  - Modificare i metodi auth per accettare un parametro keepGuestData.
  - Se keepGuestData === false, impostare migrationDataRef.current = 'DISCARD' prima di lanciare la chiamata a Firebase.
  - Modificare l'\onAuthStateChanged\ in modo che se migrationDataRef.current === 'DISCARD', il valore di guestData sia 
ull invece di fare fallback su useAppStore.getState().userData, garantendo che i dati locali non vengano uniti ai dati cloud.

## Rischi
- **Migrazione e Perdita Dati**: Assicurarsi che keepGuestData=true mantenga il comportamento di unione esatto attuale, mentre alse scarti esplicitamente i dati locali senza ricadere nel fallback su store.
- **Zod Validations**: Verificare che la transizione da SessionExercise a RoutineExercise rispetti gli schemi Zod (specialmente setsCount).
- **Report Inconsistenti**: Se non generiamo un outineId univoco per ogni allenamento libero, il report mescolerà le metriche di allenamenti liberi diversi (Fixato: verrà usato un UUID).

## Test e Rollback
- **Shallow Verification**: Navigare nei bottoni Crea per controllare l'apertura/chiusura. Verificare la chiusura del LoginBox da guest (close button).
- **Deep Verification**: Effettuare una sessione di allenamento libero (aggiunta dinamica esercizi) e salvarla come nuova scheda. Testare il merge o scarto da modalità Guest senza bug di fallback.
- **Rollback**: Standard tramite revert del commit git.
