# Analisi Approfondita: Flusso di Eliminazione Sessione di Allenamento e Persistenza Firestore

## 1. Sommario Esecutivo
L''analisi dettagliata del codebase di LogBook ha identificato con certezza matematica la causa primaria dell''errore **"Missing or insufficient permissions"** e del conseguente alert **"Errore critico durante il salvataggio Firestore"** che si verifica durante l''eliminazione di una sessione di allenamento (e in generale durante i salvataggi dello stato utente).

La causa scatenante è una **discrepanza tra lo schema dei dati salvati sul documento principale `users/{userId}` in `src/lib/db.ts` e la whitelist di sicurezza definita nelle regole `firestore.rules`**:
1. Il metodo `DB.saveUserData` include tassativamente la proprietà `catalogOverrides` nell''oggetto `userDocData` (linea 227 di `src/lib/db.ts`).
2. Le regole di sicurezza `firestore.rules` alla radice del progetto contengono una clausola `incomingData().keys().hasOnly([...])` che **NON include `'catalogOverrides'`**.
3. Poiché le operazioni su `users/{userId}` e sulla subcollection `history_months/{YYYY-MM}` vengono inviate in un unico `writeBatch(db)` atomico, il rifiuto di autorizzazione sul documento `users/{userId}` invalida e rigetta l''intero batch, bloccando l''aggiornamento e la cancellazione delle sessioni di allenamento.

Inoltre, sono stati riscontrati due problemi correlati:
- **App Check Fallback:** Quando la chiave `VITE_RECAPTCHA_V3_SITE_KEY` è assente, `initAppCheck` attiva la modalità `isFallbackOfflineMode = true` e stampa avvisi bloccanti in console, invece di degradare in modo pulito e non distruttivo.
- **Vitest Mock Setup:** Il file `tests/setup.tsx` manca del mock per `indexedDBLocalPersistence` di `firebase/auth`, causando il fallimento di tutti i test unitari e di integrazione.

---

## 2. Flusso Completo di Eliminazione Allenamento (Call Chain)

### 2.1 Trigger UI
- **File:** `src/components/Training/TrainingHistory.tsx` (linee 69-70)
- **Azione:** L''utente clicca sull''icona del cestino `???` associata a una sessione dello storico:
  ```tsx
  <button 
      className="btn-icon" 
      style={{ color: 'var(--danger-color)' }} 
      aria-label="Elimina allenamento"
      title="Elimina allenamento"
      onClick={() => deleteWorkout(wo.id!)}
  >???</button>
  ```

### 2.2 Hook `useTrainingHistory`
- **File:** `src/hooks/useTrainingHistory.ts` (linee 16-32)
- **Azione:** 
  1. Mostra un dialogo di conferma globale (`showConfirm`).
  2. Invoca `saveUserData` di Zustand passando una funzione di update che rimuove l''elemento con ID specificato da `prev.history`:
  ```ts
  const deleteWorkout = async (id: string) => {
      if (await showConfirm("Eliminare definitivamente questo allenamento dallo storico?")) {
          try {
              await saveUserData(prev => {
                  if (!prev) return prev;
                  const updatedHistory = (prev.history || []).filter((w: any) => w.id !== id);
                  return { ...prev, history: updatedHistory };
              });
              const localWorkout = useAppStore.getState().localWorkout;
              if (localWorkout && (localWorkout.id === id || localWorkout.originalHistoryId === id)) {
                  useAppStore.getState().setLocalWorkout(null);
              }
          } catch {
              showAlert("Errore durante l'eliminazione dell'allenamento.");
          }
      }
  };
  ```

### 2.3 Zustand Store (`createSyncSlice.ts`)
- **File:** `src/store/slices/createSyncSlice.ts` (linee 40-92)
- **Azione:**
  1. Aggiorna lo stato in memoria e salva la cache su IndexedDB (`saveUserDataToCache`).
  2. Imposta `syncing: true` e `saveError: null`.
  3. Avvia il debouncer globale di 1000ms (`DEBOUNCE_DELAY_GLOBAL`).
  4. Alla scadenza del timer, invoca `await DB.saveUserData(currentState)`.
  5. Se `DB.saveUserData` fallisce sollevando un''eccezione, `mapFirebaseErrorCode(error)` mappa l''errore in `ERR_FIRESTORE_PERMISSION`, imposta `saveError`, rigetta tutte le Promise pendenti e solleva l''errore nell''hook `useTrainingHistory`.

### 2.4 Persistenza Firestore (`src/lib/db.ts`)
- **File:** `src/lib/db.ts` (linee 157-320)
- **Azione:**
  1. Recupera `oldState` da `lastSavedStateStr` (se presente) oppure inizializza l''oggetto `oldState` di default.
  2. Istanzia un `writeBatch(db)`.
  3. **Step 1 — Documento principale `users/{userId}`:**
     Effettua il diffing tra lo stato attuale e `oldState`. Se uno qualsiasi dei campi del documento utente o `catalogOverrides` è variato (oppure se `oldState.catalogOverrides` è `undefined`):
     ```ts
     const userDocData = {
         profile: state.profile || {},
         library: effectiveCustomExercises,
         routines: state.routines || [],
         customFoods: effectiveCustomFoods,
         activeWorkout: state.activeWorkout || null,
         trainingCycles: state.trainingCycles || [],
         activeCycleId: state.activeCycleId !== undefined ? state.activeCycleId : null,
         nutritionPlanning: state.nutritionPlanning || null,
         supplements: state.supplements || [],
         activePains: state.activePains || [],
         catalogOverrides: overridesToSave
     };
     const cleanUserDocData = removeUndefinedValues(userDocData);
     checkDocSize(cleanUserDocData, "User Profile");
     batch.set(userRef, cleanUserDocData, { merge: true });
     ```
  4. **Step 2 — Subcollection `history_months/{YYYY-MM}`:**
     Raggruppa le sessioni di `state.history` e `oldState.history` per mese (`newHistMonths` e `oldHistMonths`).
     - Per i mesi in cui rimangono altri allenamenti: `batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc)`
     - Per i mesi in cui tutti gli allenamenti sono stati eliminati (`!newHistMonths[month]`): `batch.delete(doc(db, "users", user.uid, "history_months", month))`
  5. **Step 3 — Esecuzione Batch:**
     Esegue `await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore")`.

---

## 3. Causa Primaria dell''Errore di Permessi Firestore

### 3.1 La Violazione della Whitelist di Sicurezza
In `firestore.rules` (linee 31-44):
```
    // Documento principale utente: users/{userId}
    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      
      // Scrittura consentita solo con whitelist rigorosa dei campi consentiti
      allow create, update: if isOwner(userId)
        && incomingData().keys().hasOnly([
          'profile',
          'library',
          'routines',
          'customFoods',
          'activeWorkout',
          'trainingCycles',
          'activeCycleId',
          'nutritionPlanning',
          'supplements',
          'activePains'
        ]);
```
- Notare attentamente: la whitelist `hasOnly(...)` ammette **solo 10 campi**.
- In `src/lib/db.ts` (linea 227), `userDocData` invia un **undicesimo campo: `'catalogOverrides'`**.
- Quando `batch.commit()` viene processato dal server Firestore, la regola per `users/{userId}` restituisce `false` perché `incomingData().keys()` contiene `catalogOverrides`.
- Firestore rigetta l''intero batch con `FirebaseError: [code=permission-denied]: Missing or insufficient permissions`.
- Poiché `writeBatch` è atomico su tutte le operazioni in esso contenute, anche la cancellazione o modifica della subcollection `history_months` viene abortita.

### 3.2 Confronto con le regole di rilascio
Nel file `teamwork_projects/logbook_public_release/firestore.rules` (linee 44-62), la whitelist era già stata aggiornata per supportare:
- `catalogOverrides`
- `customExercises`
- `catalogHiddenIds`
- `exerciseOverrides`
- `foodOverrides`
- `hiddenCatalogExercises`
- `hiddenCatalogFoods`
- Regole di lettura pubblica per `/global_catalog/{document=**}` e `/catalog/{document=**}`.

Tuttavia, il file delle regole di sicurezza principale alla radice del repository (`firestore.rules`) non era stato sincronizzato con questi campi.

### 3.3 Ulteriore Discrepanza in `oldState` di `db.ts`
In `src/lib/db.ts` (linee 161-174), l''oggetto `oldState` di fallback è inizializzato come:
```ts
let oldState: Record<string, any> = { 
    profile: {}, 
    library: [], 
    routines: [], 
    customFoods: [], 
    history: [], 
    nutrition: {}, 
    activeWorkout: null, 
    trainingCycles: [],
    activeCycleId: null,
    nutritionPlanning: null,
    supplements: [],
    activePains: []
};
```
Manca `catalogOverrides: {}`. Pertanto, al primo salvataggio (o in assenza di `lastSavedStateStr`), `oldState.catalogOverrides` è `undefined`, causando `!deepEqual(overridesToSave, oldState.catalogOverrides) === true`. Questo forza SEMPRE la scrittura di `userDocData` nel batch anche quando è stato modificato solo lo storico allenamenti.

---

## 4. Analisi delle Subcollection `history_months` e Diffing con `fast-deep-equal`

### 4.1 Formattazione di percorsi e ID documento
- I documenti di storico sono partizionati per mese: `users/{userId}/history_months/{YYYY-MM}` (es. `2026-08`).
- Il calcolo della chiave mese in `db.ts` (linee 238-240) è conforme ai fusi orari locali:
  ```ts
  const monthKey = (h.date && typeof h.date === 'string' && h.date.length >= 7)
      ? h.date.substring(0, 7)
      : (h.globalStartTime ? getLocalDateString(h.globalStartTime).substring(0, 7) : getLocalDateString().substring(0, 7));
  ```
- Nelle regole di sicurezza `firestore.rules`:
  ```
  match /history_months/{monthId} {
      allow read, delete: if isOwner(userId);
      allow create, update: if isOwner(userId) && isValidMonthId(monthId);
  }
  ```
  La funzione `isValidMonthId(monthId)` convalida il pattern `^[0-9]{4}-(0[1-9]|1[0-2])$`.
  - La rimozione del documento (`batch.delete`) richiede esclusivamente `isOwner(userId)` ed è valida.
  - La sovrascrittura (`batch.set`) rispetta `isValidMonthId(monthId)` ed è valida.

### 4.2 Comportamento del Diffing durante l''eliminazione
1. **Eliminazione di una singola sessione da un mese contenente altre sessioni:**
   - `newHistMonths[month]` contiene le rimanenti sessioni del mese.
   - `oldHistMonths[month]` conteneva tutte le sessioni incluso quella eliminata.
   - `!deepEqual(newHistMonths[month], oldHistMonths[month])` è `true`.
   - `batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc)` viene accodato per sostituire il documento del mese con la mappa aggiornata.
2. **Eliminazione dell''unica sessione presente in un mese:**
   - `newHistMonths[month]` non contiene chiavi per quel mese (`undefined`).
   - `oldHistMonths[month]` contiene la sessione eliminata.
   - `!newHistMonths[month]` è `true`.
   - `batch.delete(doc(db, "users", user.uid, "history_months", month))` viene accodato per cancellare il documento del mese da Firestore.
3. Entrambi i percorsi logici del diffing sono corretti e sicuri. L''unico motivo del fallimento è che il batch conteneva contestualmente l''operazione non autorizzata sul documento principale `users/{userId}`.

---

## 5. Analisi di Sanitizzazione e Pre-Flight (`checkDocSize` & `removeUndefinedValues`)

1. **`removeUndefinedValues`:** 
   Sanitizza ricorsivamente tutti gli oggetti prima della serializzazione Firestore. Rimuove chiavi con valore `undefined`, convertendole o omettendole conformemente ai vincoli di Firestore SDK.
2. **`checkDocSize`:**
   Valuta la dimensione UTF-8 del payload rispetto alla soglia di sicurezza di 950.000 byte (950 KB), ben al di sotto del limite rigido di 1 MiB di Firestore. Durante l''eliminazione di sessioni, la dimensione del documento diminuisce, pertanto `checkDocSize` non solleva alcuna eccezione.

---

## 6. Analisi App Check (`src/lib/appCheck.ts` & `src/lib/firebase.ts`)

### 6.1 Problema Riscontrato
In `src/lib/appCheck.ts` (linee 98-107):
```ts
if (!siteKey || siteKey.trim() === '') {
    console.warn(`[AppCheck] ${APP_CHECK_STRINGS.missingSiteKeyWarning}`);
    isFallbackOfflineMode = true;
    return {
        success: false,
        appCheck: null,
        isFallbackOffline: true,
        reason: APP_CHECK_STRINGS.missingSiteKeyWarning
    };
}
```
E in `src/lib/firebase.ts` (linee 56-60):
```ts
initAppCheck(app).then((res) => {
    if (!res.success) {
        console.warn("App Check fallito o non supportato. App in modalità degradata.", res.reason);
    }
});
```

### 6.2 Conseguenze
1. Quando l''applicazione viene eseguita in un ambiente privo della variabile d''ambiente `VITE_RECAPTCHA_V3_SITE_KEY` (es. sviluppo locale, test o istanza cloud senza App Check abilitato), `initAppCheck` imposta forzatamente `isFallbackOfflineMode = true`.
2. Vengono emessi warning bloccanti in console ("App in modalità degradata").
3. Qualsiasi componente o logica che interroga `isAppCheckFallbackOffline()` presume erroneamente che il dispositivo debba operare esclusivamente offline.

### 6.3 Comportamento Corretto Richiesto (R2)
Se la chiave `siteKey` è assente o vuota, App Check deve essere semplicemente disabilitato in modo pulito e trasparente (`success: true`, `appCheck: null`, `isFallbackOffline: false`), consentendo al database di operare normalmente senza loggare allarmi di modalità degradata.

---

## 7. Analisi dell''Ambiente di Test (`tests/setup.tsx`)

Nel file `tests/setup.tsx` (linee 137-156), il mock di `firebase/auth` contiene:
```ts
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(),
  ...
  browserLocalPersistence: {},
  deleteUser: vi.fn(),
}));
```
In `src/lib/firebase.ts` (linee 12 e 78), l''applicazione importa `indexedDBLocalPersistence` e lo passa a `setPersistence(auth, indexedDBLocalPersistence)`.
Poiché il mock non esporta `indexedDBLocalPersistence`, l''esecuzione di `npm.cmd test` fallisce immediatamente su tutti i 70 file di test con l''errore:
`Error: [vitest] No "indexedDBLocalPersistence" export is defined on the "firebase/auth" mock.`

---

## 8. Piano di Risoluzione Dettagliato

### Modifica 1: Aggiornamento di `firestore.rules`
Aggiornare la whitelist di `users/{userId}` in `firestore.rules` includendo `catalogOverrides` e gli altri campi estesi, oltre alle regole di lettura per `/global_catalog` e `/catalog`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isValidMonthId(monthId) {
      return monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$');
    }
    
    function incomingData() {
      return request.resource.data;
    }

    match /{document=**} {
      allow read, write: if false;
    }

    match /global_catalog/{document=**} {
      allow read: if true;
      allow write: if false;
    }
    match /catalog/{document=**} {
      allow read: if true;
      allow write: if false;
    }

    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      
      allow create, update: if isOwner(userId)
        && incomingData().keys().hasOnly([
          'profile',
          'library',
          'customExercises',
          'routines',
          'customFoods',
          'activeWorkout',
          'trainingCycles',
          'activeCycleId',
          'nutritionPlanning',
          'supplements',
          'activePains',
          'catalogOverrides',
          'catalogHiddenIds',
          'exerciseOverrides',
          'foodOverrides',
          'hiddenCatalogExercises',
          'hiddenCatalogFoods'
        ]);
        
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId);
      }
      
      match /nutrition_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId);
      }
    }
  }
}
```

### Modifica 2: Inizializzazione `oldState` in `src/lib/db.ts`
In `src/lib/db.ts`, aggiungere `catalogOverrides: {}` all''oggetto `oldState` iniziale (linea 174) per evitare diffing non necessari al primo salvataggio.

### Modifica 3: Gestione Pulita di App Check in `src/lib/appCheck.ts` e `src/lib/firebase.ts`
In `src/lib/appCheck.ts`, quando `siteKey` è assente:
```ts
if (!siteKey || siteKey.trim() === '') {
    isFallbackOfflineMode = false;
    return {
        success: true,
        appCheck: null,
        isFallbackOffline: false,
        reason: 'App Check non configurato (chiave assente)'
    };
}
```
E in `src/lib/firebase.ts`, registrare un log informativo o omettere il warning se App Check è disabilitato intenzionalmente.

### Modifica 4: Aggiunta di `indexedDBLocalPersistence` nel mock di `tests/setup.tsx`
In `tests/setup.tsx`, aggiungere `indexedDBLocalPersistence: {}` al mock di `firebase/auth` per ripristinare il corretto funzionamento della suite `vitest`.
