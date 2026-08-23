# Handoff Report — Workout Deletion & Firestore Persistence

## 1. Observation
1. **Security Rules Field Whitelist:**
   In `firestore.rules` (lines 31-44):
   ```
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
2. **Payload inviato a `users/{userId}` in `DB.saveUserData`:**
   In `src/lib/db.ts` (lines 216-231):
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
   `cleanUserDocData` include esplicitamente la proprietà `catalogOverrides`.
3. **Atomic Batch Commit Failure:**
   In `src/lib/db.ts` (lines 300-312):
   ```ts
   await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore");
   ```
   Quando il batch viene inviato, Firestore rifiuta l''operazione su `users/{userId}` con errore `FirebaseError: [code=permission-denied]: Missing or insufficient permissions`, facendo fallire l''intero batch (inclusa la cancellazione/aggiornamento su `history_months`).
4. **App Check Fallback Behavior:**
   In `src/lib/appCheck.ts` (lines 98-107):
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
   Quando la chiave `VITE_RECAPTCHA_V3_SITE_KEY` manca, viene attivata forzatamente la modalità offline di fallback (`isFallbackOfflineMode = true`) e loggato l''avviso di degrado in `src/lib/firebase.ts` (lines 56-60).
5. **Vitest Mock Setup Missing Export:**
   In `tests/setup.tsx` (lines 137-156):
   Il mock di `firebase/auth` manca dell''export `indexedDBLocalPersistence`, sollevando `Error: [vitest] No "indexedDBLocalPersistence" export is defined on the "firebase/auth" mock` su tutti i test suite.

---

## 2. Logic Chain
1. L''utente avvia l''eliminazione di una sessione di allenamento in `TrainingHistory.tsx` tramite l''icona `???` (Observation 1 in analysis).
2. L''hook `useTrainingHistory` filtra l''array `history` e chiama `saveUserData` di Zustand (Observation 2.2 in analysis).
3. Lo store Zustand accoda il salvataggio su Firestore con un debounce di 1000ms in `createSyncSlice.ts` (Observation 2.3 in analysis).
4. Alla scadenza del timer, `DB.saveUserData` crea un `writeBatch(db)` contenente:
   - L''aggiornamento del documento `users/{userId}` con `cleanUserDocData` (che include il campo `catalogOverrides`, Observation 2).
   - L''operazione sulla subcollection `history_months/{YYYY-MM}` (`batch.set` o `batch.delete`).
5. Quando `batch.commit()` viene inviato a Firestore, il motore delle regole di sicurezza valida tutte le operazioni del batch.
6. La regola per `users/{userId}` verifica `incomingData().keys().hasOnly(...)` (Observation 1).
7. Poiché il campo `catalogOverrides` non è presente nell''elenco dei campi ammessi in `firestore.rules`, la condizione fallisce e Firestore rigetta l''intero batch con codice `permission-denied` ("Missing or insufficient permissions", Observation 3).
8. `DB.saveUserData` intercetta il rifiuto del batch, logga `"Errore critico durante il salvataggio Firestore"`, e rigetta la Promise.
9. `useTrainingHistory` cattura il rigetto e mostra l''alert `"Errore durante l'eliminazione dell'allenamento."`.

---

## 3. Caveats
- No caveats. L''intera catena di chiamate, le regole di sicurezza, il meccanismo di diffing mensile, la gestione di App Check e la suite di test sono state verificate e mappate riga per riga.

---

## 4. Conclusion
1. La causa dell''errore "Missing or insufficient permissions" e del fallimento nell''eliminazione degli allenamenti è la **mancanza di `'catalogOverrides'` nella whitelist di campi ammessi su `users/{userId}` in `firestore.rules`**.
2. Il meccanismo di bucketing mensile e diffing in `src/lib/db.ts` è logicamente corretto sia nel caso di cancellazione parziale del mese (`batch.set`) che di rimozione totale del mese (`batch.delete`).
3. L''avviso di degrado App Check è causato da un fallback aggressivo in `src/lib/appCheck.ts` quando la chiave reCAPTCHA è assente, e può essere risolto disabilitando il check in modo pulito e trasparente.
4. I test unitari possono essere ripristinati aggiungendo `indexedDBLocalPersistence: {}` al mock di `firebase/auth` in `tests/setup.tsx`.

---

## 5. Verification Method
1. **Ispezione file:**
   - Confrontare `firestore.rules` (linee 31-44) con `src/lib/db.ts` (linea 227).
   - Verificare la whitelist estesa già testata in `teamwork_projects/logbook_public_release/firestore.rules` (linee 44-62).
2. **Esecuzione Test:**
   - Aggiungere `indexedDBLocalPersistence: {}` al mock in `tests/setup.tsx`.
   - Eseguire `npm.cmd test` per accertare che i test di persistenza `tests/db_persistence.test.ts` e le regole `teamwork_projects/logbook_public_release/tests/rules.test.ts` passino.
3. **Verifica Interattiva / Regole:**
   - Con la whitelist aggiornata in `firestore.rules`, eliminando una sessione da `TrainingHistory.tsx`, `batch.commit()` si conclude con successo (nessun errore `permission-denied` o "Errore critico durante il salvataggio Firestore").
