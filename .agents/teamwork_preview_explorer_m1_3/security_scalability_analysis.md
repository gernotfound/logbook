# Audit Architetturale: Sicurezza, Scalabilità e Infrastruttura di Produzione (LogBook)

**Data:** 16 Agosto 2026  
**Autore:** Explorer 3 — Security, Scalability & Production Infrastructure Specialist  
**Progetto:** LogBook (React 19, TypeScript, Zustand 5, Zod 4, Firebase Modular SDK v12, Vite)  
**Ambito:** Ispezione approfondita di `firestore.rules`, `src/lib/firebase.ts`, `src/lib/db.ts`, `.github/workflows/deploy.yml` e configurazioni di produzione.

---

## 1. Executive Summary

L'audit architetturale ha esaminato la robustezza, la sicurezza multi-tenant e la scalabilità del backend Firebase di **LogBook** in vista della migrazione su piano a pagamento (Firebase Blaze) e del rilascio a centinaia di utenti concorrenti.

### Sintesi delle Valutazioni
1. **Isolamento Multi-Tenant:** **Sufficiente ma Fragile**. La regola `request.auth.uid == userId` impedisce accessi cross-utente non autorizzati, ma la mancanza totale di validazione di schema, tipi e subcollection consente a client compromessi o malevoli di iniettare dati arbitrari, creare subcollection non consentite e saturare lo storage.
2. **Limiti di Dimensione Documento (1MB Firestore):** **Rischio Critico di Blocco Permanente**. La concentrazione di `customFoods`, `library`, `routines`, `trainingCycles` e `activeWorkout` nel singolo documento `users/{uid}` con soglia rigida `checkDocSize < 950KB` provoca il blocco totale e irreversibile delle scritture cloud non appena un utente accumula ~2.000 alimenti personalizzati o cataloghi estesi.
3. **Scalabilità Utenti Concorrenti (Blaze):** **Alta Efficienza con 2 Gravi Colli di Bottiglia**:
   - **Over-fetching all'avvio:** `DB.loadUserData` scarica la totalità dei mesi storici e nutrizionali (`getDocs(collection(...))`), degradando il tempo di boot per utenti con anni di utilizzo.
   - **Bug di "Amnesia del Salvataggio" su Fallimento Batch:** In caso di errore o timeout in `batch.commit()`, `DB.saveUserData` aggiorna comunque `lastSavedStateStr`, impedendo al diffing `fast-deep-equal` di ritentare la sincronizzazione dei dati mancanti.
4. **Configurazione Fail-Fast & CI/CD:** **Funzionante ma Ottimizzabile**. L'accesso statico a `import.meta.env` previene bug di build Vite; tuttavia, la dipendenza obbligatoria da `VITE_FIREBASE_DATABASE_URL` (non necessaria per Cloud Firestore) e il tracciamento di `.env.production` su Git richiedono una gestione più rigorosa tramite GitHub Secrets.

---

## 2. Firebase Security Rules Audit & Multi-Tenant Isolation

### 2.1 Analisi dello Stato Attuale (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Secure by default: deny all requests unless matched by a specific rule below
    match /{document=**} {
      allow read, write: if false;
    }

    // A user can only access their own user document and subcollections
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 2.2 Vulnerabilità e Criticità Identificate

| # | Criticità | Gravità | Descrizione Tecnica |
|---|---|---|---|
| **SEC-1** | **Assenza di Validazione Payload / Schema** | **Alta** | Le regole consentono la scrittura di qualunque struttura JSON. Un utente autenticato (o un attaccante con token Auth) può scrivere campi arbitrari, stringhe giganti da 999KB, payload corrotti o script non previsti, bypassando completamente Zod (che opera solo lato client). |
| **SEC-2** | **Wildcard Ricorsivo Non Ristretto (`{document=**}`)** | **Media** | La regola consente la creazione e manipolazione di *qualsiasi* subcollection sotto `/users/{userId}/` (es. `/users/{userId}/arbitrary_test/doc1`), non limitandosi a `history_months` e `nutrition_months`. |
| **SEC-3** | **Assenza di Validazione sugli ID dei Documenti Mensili** | **Media** | `history_months` e `nutrition_months` non validano che l'ID del documento rispetti il formato `YYYY-MM`. È possibile inserire documenti con ID arbitrari che non verrebbero mai caricati o puliti correttamente. |
| **SEC-4** | **Assenza di Controllo Immutabilità & Timestamp** | **Bassa** | Nessun vincolo impedisce la sovrascrittura distruttiva di campi di sistema con timestamp futuri o valori `null` non gestiti. |

### 2.3 Regole di Sicurezza Consigliate per Produzione Multi-Tenant

Di seguito la proposta di refactoring completa per `firestore.rules`, con validazione granulare dei campi ammessi nel documento principale e nelle subcollection mensili:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Funzioni helper di sicurezza
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

    // Default deny
    match /{document=**} {
      allow read, write: if false;
    }

    // Documento principale utente
    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      allow create, update: if isOwner(userId)
        && incomingData().keys().hasOnly([
          'profile', 'library', 'routines', 'customFoods',
          'activeWorkout', 'trainingCycles', 'activeCycleId',
          'nutritionPlanning', 'supplements'
        ]);
        
      // Subcollection Storico Allenamenti Mensile
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) && isValidMonthId(monthId);
      }
      
      // Subcollection Nutrizione & Misure Mensile
      match /nutrition_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) && isValidMonthId(monthId);
      }
    }
  }
}
```

---

## 3. Document Size Limits & Strutturazione Dati (1MB Limit Breakdown)

### 3.1 Modellazione Quantitativa del Documento `users/{uid}`

In `src/lib/db.ts`, la funzione `checkDocSize` applica un limite di guardia:
```typescript
function checkDocSize(data: any, docName: string) {
    const jsonStr = JSON.stringify(data);
    const sizeBytes = new Blob([jsonStr]).size;
    if (sizeBytes > 950000) { // Limit threshold below 1MB (950 KB)
        throw new Error(`Il documento ${docName} supera il limite di dimensione di Firestore (1MB). Ridurre i dati inseriti.`);
    }
}
```

#### Analisi della composizione in byte del documento `users/{uid}`:

| Struttura Dati | Descrizione e Dettaglio | Dimensione Media Unitaria | Dimensione a Volume Moderato | Dimensione a Volume Alto (Power User) |
|---|---|---|---|---|
| **`profile`** | Dati anagrafici e biometrici base | ~400 B | ~400 B | ~600 B |
| **`nutritionPlanning`** | Target, normocalorica, macro boost/on/off | ~600 B | ~600 B | ~1 KB |
| **`activeCycleId`** | ID stringa o null | ~30 B | ~30 B | ~30 B |
| **`activeWorkout`** | Sessione in corso (esercizi, serie, dropset) | ~10 KB | ~10 KB | ~25 KB |
| **`supplements`** | Elenco integratori (id, nome, unità, dosaggi) | ~150 B / item | 10 item = ~1.5 KB | 30 item = ~4.5 KB |
| **`trainingCycles`** | Cicli di programmazione e rotazioni schede | ~1 KB / ciclo | 5 cicli = ~5 KB | 20 cicli = ~20 KB |
| **`routines`** | Schede di allenamento (esercizi, target, note) | ~2 KB / scheda | 8 schede = ~16 KB | 25 schede = ~50 KB |
| **`library`** | Esercizi personalizzati (muscoli primari/secondari, note) | ~400 B / esercizio | 50 es. = ~20 KB | 250 es. = ~100 KB |
| **`customFoods`** | **Archivio alimenti con 20+ micronutrienti e grammature** | **~420 B / alimento** | **200 alimenti = ~84 KB** | **2.000 alimenti = ~840 KB** |
| **TOTALE** | | | **~138 KB** | **~1.041 KB (> 950 KB 🚨)** |

### 3.2 La "Trappola del Blocco Permanente" (Permanent Write Blockage)

Se un utente supera i 950 KB su `users/{uid}` (ad esempio importando un database di alimenti o creando molte ricette/alimenti custom):
1. `checkDocSize(cleanUserDocData, "User Profile")` solleva un'eccezione `Error`.
2. `DB.saveUserData` rigetta la Promise.
3. `useAppStore` riceve l'errore e imposta `saveError: "Errore sincronizzazione. Verifica la connessione."`.
4. **Stallo irreversibile:** Qualsiasi successiva modifica (anche la modifica di un singolo peso in un workout o una spunta) scatena `saveUserData`, che serializza nuovamente l'intero `users/{uid}` e rigetta immediatamente l'operazione. L'utente non può più sincronizzare alcunché con il cloud fino a quando non elimina manualmente centinaia di elementi.

### 3.3 Analisi delle Subcollection Mensili

1. **`history_months/{YYYY-MM}`**:
   - Memorizza una mappa di sessioni `{ [sessionId]: WorkoutSession }`.
   - 1 sessione completa = ~5–8 KB.
   - Con 20 allenamenti al mese = ~100–160 KB. Anche con 60 sessioni (bifrequenza giornaliera) = ~480 KB. Rimane ampiamente sotto i 950 KB.
2. **`nutrition_months/{YYYY-MM}`**:
   - Memorizza `{ [date]: NutritionDay }`.
   - 1 giorno con 5 pasti, 25 alimenti loggati, 10 misure corporee = ~8–12 KB.
   - 31 giorni = ~250–370 KB. Rimane entro i limiti, ma comporta l'invio di centinaia di KB a ogni singolo alimento aggiunto.

### 3.4 Proposta di Ristrutturazione Dati
- **Spostamento di `customFoods` in subcollection:** `/users/{uid}/custom_foods/{foodId}` (oppure bucket da 100 alimenti). Questo rimuove il 90% del carico dal documento principale, rendendo `users/{uid}` leggero (< 50 KB perenni).
- **Spostamento della `library` personalizzata in subcollection:** `/users/{uid}/custom_exercises/{exerciseId}`.

---

## 4. Concurrent User Scaling & Paid Blaze Tier Architecture

### 4.1 Comportamento con Centinaia di Utenti Concorrenti (Blaze)

| Metrica / Componente | Capacità Firebase Blaze | Carico con 500 Utenti Attivi | Stato / Valutazione |
|---|---|---|---|
| **Connessioni WebChannel/gRPC** | 1.000.000 simultanee | ~500–1.000 connessioni | **Ottimale** (consumo < 0.1% della quota). |
| **Throughput Scritture Globali** | 10.000 scritture/sec | ~20–50 scritture/sec (grazie al debounce 1000ms) | **Ottimale** (nessuna saturazione). |
| **Contesa Scrittura per Documento (1 write/sec)** | Max 1 scrittura/sec per singolo documento | 1 utente per documento (`users/{uid}`) | **Perfetta segregazione multi-tenant**: nessun lock cross-utente. |
| **Batch Commit (`writeBatch`)** | Max 500 operazioni per batch | Normali scritture: 1–3 operazioni per batch | **Pienamente conforme**. |

### 4.2 Criticità di Scalabilità Rilevate nel Codice

#### A. Over-fetching e Latenza di Boot in `DB.loadUserData`
Nel codice attuale:
```typescript
const histSnap = await withTimeout(
    getDocs(collection(db, "users", user.uid, "history_months")),
    6000,
    "Timeout recupero storico"
);
const nutSnap = await withTimeout(
    getDocs(collection(db, "users", user.uid, "nutrition_months")),
    6000,
    "Timeout recupero nutrizione"
);
```
- Se un utente utilizza l'app da 36 mesi (3 anni), all'avvio vengono scaricati contemporaneamente **73 documenti** (1 profilo + 36 storico + 36 nutrizione), pari a diversi megabyte di dati JSON che transitano attraverso `UserDataSchema.parse()`.
- **Impatto:** Rallenta l'avvio su connessioni mobili e incrementa l'uso di memoria heap del browser.
- **Soluzione:** Applicare una strategia di **Lazy-loading temporale**: caricare all'avvio solo il mese corrente e i 2 mesi precedenti; caricare i mesi più vecchi su richiesta o in background.

#### B. Bug di "Amnesia del Salvataggio" (`lastSavedStateStr` bypass su errore batch)
In `src/lib/db.ts` (righe 231–239):
```typescript
if (hasWrites) {
    try {
        await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore");
        console.log(`Sincronizzazione DB completata.`);
    } catch (batchErr) {
        console.warn("Scrittura archiviata nella cache locale Firestore (offline):", batchErr);
    }
}
lastSavedStateStr = JSON.stringify(state); // ⚠️ BUG CRITICO!
```
- **Meccanismo di guasto:** Se `batch.commit()` fallisce (ad esempio per timeout, errore di rete, rifiuto delle Security Rules o quota superata), il blocco `catch` intercetta l'errore ed esegue `lastSavedStateStr = JSON.stringify(state)`.
- **Conseguenza:** Al successivo salvataggio, `deepEqual(state.profile, oldState.profile)` valuterà `true` poiché `oldState` è stato aggiornato con lo stato che in realtà **non è mai stato sincronizzato su Firestore**! Le modifiche fallite non verranno MAI più inviate a Firestore a meno di un reload completo dell'app.
- **Risoluzione:** Aggiornare `lastSavedStateStr` **esclusivamente** se `batch.commit()` va a buon fine, oppure reimpostare `lastSavedStateStr = null` in caso di errore per forzare il retry al prossimo ciclo.

#### C. Limite Operazioni in `DB.deleteAccount`
In `src/lib/db.ts` (righe 255–288):
```typescript
const batch = writeBatch(db);
histSnap.forEach((d: any) => batch.delete(d.ref));
nutSnap.forEach((d: any) => batch.delete(d.ref));
batch.delete(userDocRef);
await batch.commit();
```
- Se un utente storico ha più di 250 mesi cumulativi tra allenamenti e nutrizione (`histSnap.size + nutSnap.size + 1 > 500`), `batch.commit()` fallisce con errore `INVALID_ARGUMENT: Cannot modify more than 500 documents in a single write operation`.
- **Risoluzione:** Suddividere le cancellazioni in chunk da 400 operazioni.

---

## 5. Fail-Fast Configuration & CI/CD Security

### 5.1 Analisi di `src/lib/firebase.ts`

```typescript
const envVars: Record<string, string | undefined> = {
    'VITE_FIREBASE_API_KEY': import.meta.env.VITE_FIREBASE_API_KEY,
    'VITE_FIREBASE_AUTH_DOMAIN': import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    'VITE_FIREBASE_DATABASE_URL': import.meta.env.VITE_FIREBASE_DATABASE_URL,
    'VITE_FIREBASE_PROJECT_ID': import.meta.env.VITE_FIREBASE_PROJECT_ID,
    'VITE_FIREBASE_STORAGE_BUCKET': import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    'VITE_FIREBASE_MESSAGING_SENDER_ID': import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    'VITE_FIREBASE_APP_ID': import.meta.env.VITE_FIREBASE_APP_ID,
    'VITE_FIREBASE_MEASUREMENT_ID': import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};
```

1. **Accesso Statico Vite:** Il codice rispetta rigorosamente la notazione statica (`import.meta.env.VITE_...`), garantendo la corretta sostituzione in fase di compilazione (`vite build`).
2. **Falso Positivo su `VITE_FIREBASE_DATABASE_URL`:** `databaseURL` appartiene al Firebase Realtime Database. Cloud Firestore opera basandosi esclusivamente su `projectId`. Rendere `VITE_FIREBASE_DATABASE_URL` tassativa provoca il blocco a runtime dell'app se l'amministratore crea un progetto Firebase standard senza attivare Realtime Database.
   - **Raccomandazione:** Rendere opzionale `VITE_FIREBASE_DATABASE_URL` o rimuoverla dal fail-fast bloccante.

### 5.2 Sicurezza CI/CD (`.github/workflows/deploy.yml`)

1. **Tracciamento di `.env.production`:** Attualmente `.env.production` è tracciato nel repository Git. Le chiavi Web di Firebase sono pubbliche per design, ma includere il file nel repository impedisce la gestione separata di ambienti (Staging vs Produzione).
2. **Best Practice:** Rimuovere `.env.production` dal repository (`git rm --cached .env.production`) e iniettare le variabili d'ambiente in fase di build su GitHub Actions tramite GitHub Secrets:
   ```yaml
   - name: Build
     run: npm run build
     env:
       VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
       VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
       VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
       VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET }}
       VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID }}
       VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID }}
       VITE_FIREBASE_MEASUREMENT_ID: ${{ secrets.VITE_FIREBASE_MEASUREMENT_ID }}
   ```

---

## 6. Tabella di Sintesi dei Rischi & Piano di Intervento

| Area | Criticità Rilevata | Rischio Operativo | Soluzione Architetturale Raccomandata |
|---|---|---|---|
| **Sicurezza** | Regole Firestore permissive con wildcard ricorsivo (`{document=**}`) e zero validazione payload | Iniezione di dati arbitrari, storage bloating | Aggiornamento di `firestore.rules` con restrizione subcollection e validazione whitelist delle proprietà di `users/{userId}` |
| **Limiti Documento** | `customFoods` nello stesso documento `users/{uid}` con check 950KB | Blocco permanente delle scritture cloud per utenti con molti alimenti | Migrazione di `customFoods` su subcollection dedicata (`users/{uid}/custom_foods`) |
| **Affidabilità Sync** | Aggiornamento improprio di `lastSavedStateStr` in caso di errore del batch | Perdita silenziosa di modifiche dopo fallimento temporaneo della rete | Aggiornare `lastSavedStateStr` solo a commit avvenuto con successo |
| **Performance** | Fetch eager di tutte le subcollection mensili all'avvio (`DB.loadUserData`) | Tempi di caricamento lunghi e consumo eccessivo di memoria su account storici | Lazy loading dei mesi storici (caricamento ultimi 3 mesi all'avvio, resto on-demand) |
| **Account Deletion** | Singolo `writeBatch` in `deleteAccount` | Crash della cancellazione per account con > 500 documenti mensili | Paginazione delle cancellazioni in batch multipli da 400 elementi |
| **Configurazione** | `VITE_FIREBASE_DATABASE_URL` obbligatoria nel fail-fast | Crash su progetti Firebase privi di Realtime Database | Rimuovere `VITE_FIREBASE_DATABASE_URL` dai vincoli bloccanti |

---

## 7. Verifiche di Integrità e Conformità

- **TypeScript Typecheck:** `tsc --noEmit` superato senza errori.
- **Linter:** `oxlint` conforme alle regole di stile.
- **Test Suite:** `vitest` operativo e test unitari verificati.
- **Regole Architetturali (`AGENTS.md`):** Tutte le proposte rispettano l'architettura a 3 livelli, il Gateway Zod e i vincoli di re-render di Zustand.
