# Rapporto di Revisione Tecnica e Analisi Critica Adversariale
**Documento Esaminato:** `audit_architetturale.md`  
**Data di Revisione:** 16 Agosto 2026  
**Revisore:** Lead Reviewer & Adversarial Critic (teamwork_preview_reviewer_m3_1)  
**Esito Finale (Verdict):** **APPROVE** (con note e rilievi costruttivi)

---

## 1. Sintesi Esecutiva della Revisione

Il documento `audit_architetturale.md` è stato sottoposto a una verifica tecnica rigorosa, linea per linea, confrontando le evidenze riportate con l'effettiva base di codice (`src/lib/db.ts`, `src/store/useAppStore.ts`, `src/lib/schema.ts`, `src/contexts/AuthContext.tsx`, `src/components/Training/...`, `firestore.rules`, `AGENTS.md`) e verificando la conformità totale ai requisiti R1, R2, R3 e ai relativi Criteri di Accettazione specificati in `ORIGINAL_REQUEST.md`.

### Esito Generale
- **Verdetto:** **APPROVE**
- **Completezza dei Requisiti (R1, R2, R3):** 100% soddisfatti.
- **Integrità & Trasparenza:** Nessuna violazione di integrità riscontrata. Tutti i riferimenti ai file, i numeri di riga e i frammenti di codice corrispondono esattamente al codice sorgente reale del repository.
- **Qualità Tecnica:** Il report si distingue per un eccezionale livello di profondità ingegneristica, modellazione quantitativa dei byte (limite 1MB Firestore), analisi di concorrenza, profilazione del garbage collector/heap V8 su mobile, diagnosi delle race condition asincrone e proposta di regole di sicurezza Firebase hardened e sintatticamente valide.

---

## 2. Verifica dei Requisiti e Criteri di Accettazione

| Requisito / Criterio | Stato | Evidenze Verificate nel Report |
|---|---|---|
| **R1. Valutazione Architetturale e Scalabilità** | ✅ **SUPERATO** | Analisi esaustiva dell'architettura a 3 livelli (Tier 1: Cloud Firestore + subcollection mensili, Tier 2: IndexedDB `idb-keyval` + Fast Pre-render Bootstrap, Tier 3: `localStorage` sincrono). Valutazione della gestione dello stato con Zustand 5, del debouncer a 1000ms, del diffing con `fast-deep-equal` e del comportamento del lifecycle mobile (iOS Safari / Android PWA) sotto carichi di centinaia di utenti concorrenti. |
| **R2. Produzione Report di Audit (`audit_architetturale.md`)** | ✅ **SUPERATO** | Documento di oltre 740 righe (51KB) strutturato in 9 sezioni analitiche. Documentati in dettaglio i 5 rischi bloccanti (CRIT-1 Amnesia del Salvataggio, CRIT-2 Stale Overwrite all'avvio, CRIT-3 Trappola del Blocco 1MB, CRIT-4 Esplosione letture $O(N)$, CRIT-5 Wildcard aperto nelle Security Rules). |
| **R3. Proposte di Refactoring Concrete** | ✅ **SUPERATO** | Forniti frammenti di codice TypeScript completi e immediatamente applicabili per: correzione amnesia in `db.ts`, riconciliazione deterministica in `AuthContext.tsx`, selettori fini in `useNutritionMeals.ts`/`useNutritionPlanning.ts`, memoizzazione con `EMPTY_HISTORY_ARRAY` in `TrainingSession.tsx`, validazione segmentata Zod (`DomainParsers`), cancellazione account in blocchi da 400 operazioni e set completo di `firestore.rules` hardened. |
| **Accettazione: Tenuta Storage 3-Tier e Debouncer** | ✅ **SUPERATO** | Modellata la meccanica del Debouncer a 1000ms e il trade-off tra throughput di rete e isolamento dello storage sincrono su interruzione improvvisa del processo. |
| **Accettazione: Impatto Ser./Deser. e Zod Gateway** | ✅ **SUPERATO** | Benchmark quantitativo della validazione Zod su smartphone medio (180–380ms di blocco del main thread per >25.000 nodi AST) e footprint heap V8 (~125MB per 3-5 anni di cronologia). |
| **Accettazione: Concretezza e Giustificazione Soluzioni** | ✅ **SUPERATO** | Matrice Before vs After dettagliata con giustificazione tecnica e stima quantitativa dei guadagni prestazionali (es. -90.4% letture Firestore, -85% blocking time Zod, -100% background re-rendering). |
| **Accettazione: Firebase Security Rules Multi-Tenant** | ✅ **SUPERATO** | Regole `firestore.rules` complete, conformi a `rules_version = '2'`, con helper `isOwner()`, validazione regex `YYYY-MM` per i bucket mensili e whitelist rigorosa dei campi consentiti sul documento principale. |

---

## 3. Verifica Puntuale delle Asserzioni Tecniche nel Codice

### 3.1 🚨 Il Bug dell'Amnesia del Salvataggio (`src/lib/db.ts:231-239`)
- **Asserzione dell'Audit:** `lastSavedStateStr = JSON.stringify(state)` viene eseguito incondizionatamente all'esterno/dopo il blocco `try/catch` di `batch.commit()`. Se il commit fallisce, l'errore viene catturato con un semplice `console.warn` e `lastSavedStateStr` viene comunque aggiornato. Nei successivi cicli, `fast-deep-equal` non rileva differenze e i dati non sincronizzati vengono persi per sempre.
- **Verifica nel Codice:** Confermato al 100% in `src/lib/db.ts` (righe 231–239). L'analisi dell'audit è ineccepibile.

### 3.2 🚨 Stale Cloud Overwrite all'Avvio (`src/contexts/AuthContext.tsx:55-58`)
- **Asserzione dell'Audit:** `DB.loadUserData()` recupera i dati remoti in background e invoca `setUserData(data)`. Sebbene `useAppStore.ts` preservi `localWorkout`, l'intero albero `userData` (inclusi pasti nutrizionali, alimenti custom e libreria) viene rimpiazzato dallo snapshot cloud, distruggendo qualsiasi modifica effettuata dall'utente durante i primi 1-3 secondi di boot.
- **Verifica nel Codice:** Confermato in `src/contexts/AuthContext.tsx:55-58` e `src/store/useAppStore.ts:116-140`.

### 3.3 🚨 Trappola del Limite di 1MB e 950KB `checkDocSize` (`src/lib/db.ts:163-167`)
- **Asserzione dell'Audit:** Il documento `users/{uid}` memorizza `customFoods` (con 20+ micronutrienti e campi per alimento), `library`, `routines`, `trainingCycles`, `supplements`, ecc. Un power user con ~2.000 alimenti supera la soglia di 950KB di `checkDocSize`, causando il blocco permanente di qualsiasi salvataggio cloud dell'account.
- **Verifica nel Codice:** Confermato. La tabella analitica dei pesi (~420B/alimento $\times$ 2.000 = ~840KB) è matematicamente esatta e il blocco di `checkDocSize` lancia un'eccezione che blocca la pipeline di salvataggio.

### 3.4 🚨 Infrangimento della Memoizzazione in `SessionExerciseCard`
- **Asserzione dell'Audit:** In `TrainingSession.tsx:393`, `exerciseHistoryMap.get(exItem.exId) || []` genera una nuova istanza `[]` ad ogni render per esercizi senza storico, rendendo falsa la condizione `prev.pastWorkouts === next.pastWorkouts` nel comparatore `React.memo` di `SessionExerciseCard.tsx:266`.
- **Verifica nel Codice:** Confermato al 100% in `src/components/Training/TrainingSession.tsx:393` e `src/components/Training/session/SessionExerciseCard.tsx:262-272`.

### 3.5 🚨 Esplosione Lineare $O(N)$ delle Letture e Paginazione `deleteAccount`
- **Asserzione dell'Audit:** `DB.loadUserData` usa `getDocs(collection(...))` non vincolato su `history_months` e `nutrition_months` (73 letture a boot dopo 3 anni). `DB.deleteAccount` committa un singolo batch che fallisce oltre 500 operazioni.
- **Verifica nel Codice:** Confermato in `src/lib/db.ts:85-105` e `src/lib/db.ts:255-288`.

---

## 4. Analisi Critica Adversariale (Stress-Test & Counter-Scenarios)

In qualità di Adversarial Critic, sono stati stressati i presupposti, le soluzioni proposte e le potenziali modalità di guasto non coperte:

### 4.1 Sfida 1: Transizione a Subcollection per `customFoods` e Allineamento Security Rules
- **Assunzione Stressata:** L'audit propone di migrare `customFoods` e `library` su subcollection per evitare il limite di 1MB sul documento radice. Tuttavia, nella Sezione 6.3 le `firestore.rules` fornite mantengono `'customFoods'` e `'library'` nella whitelist dei campi del documento `users/{userId}`.
- **Scenario di Rischio:** Se uno sviluppatore applica le nuove Security Rules e parallelamente implementa la subcollection `users/{userId}/custom_foods/{foodId}`, le scritture su tale subcollection verranno bloccate dal default deny (`match /{document=**} { allow read, write: if false; }`), poiché manca la dichiarazione esplicita del `match /custom_foods/{foodId}`.
- **Mitigazione:** Integrare nelle Security Rules definitive la regola per la futura subcollection:
  ```javascript
  match /custom_foods/{foodId} {
    allow read, write, delete: if isOwner(userId);
  }
  ```

### 4.2 Sfida 2: Impatto del Windowed Loading sulle Viste Storico Globale (`DataView` e Grafici)
- **Assunzione Stressata:** Limitare il boot agli ultimi 3 mesi ($O(1)$) riduce le letture da 73 a 7.
- **Scenario di Rischio:** Quando l'utente apre `DataView.tsx` o `VolumeChart.tsx` per visualizzare i progressi annuali o all-time, se lo store Zustand contiene solo 3 mesi di dati, i grafici mostreranno uno storico incompleto o troncato, ingannando l'utente.
- **Mitigazione:** Il caricamento on-demand (`loadFullHistory()`) deve essere agganciato al montaggio (`useEffect`) della vista `DataView` / `HistoryView`, con un indicatore visivo di caricamento dello storico esteso.

### 4.3 Sfida 3: Ripristino Connessione dopo Salvataggio Offline Fallito
- **Assunzione Stressata:** La correzione dell'Amnesia del Salvataggio evita di aggiornare `lastSavedStateStr` in caso di errore di rete.
- **Scenario di Rischio:** Se l'utente chiude la sessione di modifica dopo un fallimento di rete e non tocca più l'app, i dati rimangono salvati su IndexedDB ma non vengono mai inviati a Firestore finché non avviene una nuova mutazione dell'utente.
- **Mitigazione:** Aggiungere in `useAppStore.ts` un listener sull'evento globale del browser `window.addEventListener('online', ...)` che invoca automaticamente `DB.saveUserData(get().userData)` al ripristino della connettività.

---

## 5. Verifica dello Stato della Workspace (Build, Lint & Test)

In conformità con il protocollo di revisione, sono stati eseguiti i comandi di verifica dello spazio di lavoro:

1. **`npm.cmd run build`**:
   - Esito: **Completato con successo (Exit code 0)** in 2.73s.
   - TypeScript (`tsc --noEmit`) e Vite PWA compilano senza errori.
2. **`npm.cmd run lint`**:
   - Esito: **Completato con successo (Exit code 0)** con 0 errori e 1 warning non bloccante (`src/hooks/useNutritionMeasurements.ts:33:28`).
3. **`npm.cmd test`**:
   - Esito: **19 file di test superati con successo (393 test passati)**.
   - Si rilevano 2 fallimenti preesistenti confinati a `tests/reload_prompt.test.tsx` (dovuti a discrepanze nelle asserzioni di stringa/stile del banner PWA, non correlati all'audit).
   - I test di persistenza DB, Zustand, merging guest e Zod (`tests/zustand_save.test.ts`, `tests/guest_merge.test.ts`, `tests/db_persistence.test.ts`, `tests/challenger_guest_merge_stress.test.ts`) risultano tutti **100% PASSATI**.

---

## 6. Verdetto Conclusivo

L'artefatto `audit_architetturale.md` rappresenta un lavoro di qualità eccezionale, rigorosamente documentato, privo di scorciatoie o facciate fittizie, e pienamente allineato alla mission e alla baseline architetturale di `AGENTS.md`.

**Verdetto Finale:** **APPROVE**
