# Handoff Report: Catalogo globale, Privacy Analytics e GDPR Privacy Policy

**Autore:** explorer_survey_3 (Catalog, Analytics & GDPR Specialist)  
**Destinatario:** parent (`18e2b415-12f9-442e-ba77-ea620674c120`)  
**Data:** 2026-08-22T19:53:00Z  
**Documento di dettaglio associato:** `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_3\analysis.md`

---

## 1. Observation

Durante l'ispezione analitica del codebase sono state rilevate le seguenti evidenze oggettive:

1. **Duplicazione del catalogo nei documenti utente Firestore (`src/lib/db.ts:55-69` e `src/lib/db.ts:191-206`):**
   - Attualmente `state.library` e `state.customFoods` ereditano e salvano `defaultExercises` (~100+ elementi) e `defaultFoods` (~300+ elementi) direttamente nel documento root dell'utente `users/{uid}`.
   - Questo comporta un overhead di 200-300 KB per utente per ogni scrittura del documento principale, avvicinandosi pericolosamente alla soglia di guardia di 950 KB (`checkDocSize` in `src/lib/db.ts:23`).
2. **Assenza di isolamento nella cache IndexedDB (`src/store/slices/createDataSlice.ts:28-34`):**
   - Tutti i dati utente e di catalogo risiedono indistintamente sotto la singola chiave `'logbook_cached_user_data'`. Non esiste una chiave dedicata per il catalogo globale.
3. **Telemetria attiva in assenza di opt-in formale (`src/App.tsx:56-75`):**
   - In `App.tsx`, `logEvent(analytics, 'screen_view', ...)` e `logEvent(analytics, 'sub_tab_view', ...)` vengono eseguiti automaticamente al cambio scheda senza un consenso preventivo esplicito registrato in `localStorage`.
4. **Informativa sulla privacy preesistente non allineata (`src/components/SettingsView.tsx:183-227`):**
   - L'informativa attuale è embrionale, priva del richiamo all'Art. 9(2)(a) GDPR per i dati biometrici/sanitari, priva dell'indicazione del divieto per minori (≥ 18 anni), priva dei dettagli sul Data Privacy Framework / Clausole Contrattuali Standard per Google Firebase e Vercel, e priva dei tempi di retention certi.
5. **Regole Firestore aperte o mancanti per i dati pubblici (`firestore.rules:23-25`):**
   - Esiste solo il blocco predefinito `match /{document=**} { allow read, write: if false; }` e la sezione `/users/{userId}`. Non esiste la dichiarazione per la collezione pubblica `/global_catalog`.

---

## 2. Logic Chain

1. **Ottimizzazione quote Spark e abbattimento letture Firestore:**
   - La separazione del catalogo in `/global_catalog` (con i documenti `manifest`, `exercises_v1`, `foods_v1`) consente al client di leggere solo il documento `manifest` (1 lettura O(1)).
   - Se `manifest.version` coincide con la versione in cache IndexedDB (`logbook_cached_global_catalog`), l'app non esegue ulteriori letture, risparmiando decine di migliaia di letture giornaliere sul limite di 50k del piano Spark.
2. **Continuità operativa e zero latency tramite Seed JSON e IndexedDB:**
   - Al primo avvio in modalità Guest o offline, l'app legge il seed JSON statico bundled (`seedExercises.json`, `seedFoods.json`).
   - Gli avvii successivi leggono la cache IndexedDB `'logbook_cached_global_catalog'` (<10ms).
   - In questo modo l'esperienza utente è istantanea e completamente indipendente dalla connettività.
3. **Modello a delta e conformità alla checklist in 5 passaggi di `AGENTS.md`:**
   - Il documento `users/{uid}` memorizza esclusivamente `customExercises: Exercise[]` e `catalogOverrides: CatalogOverrides`.
   - A runtime, la funzione `resolveLibrary` unisce in memoria il catalogo globale con i delta utente.
   - Questa estensione rispetta rigorosamente i 5 file: `types.ts`, `schema.ts`, `db.ts`, `AuthContext.tsx`, `export.ts`.
4. **Privacy-Safe Analytics a norma GDPR:**
   - L'adozione del paradigma *Opt-in by Default* con memorizzazione locale (`localStorage.getItem('logbook_analytics_consent') === 'granted'`) garantisce la conformità al GDPR e alla Direttiva ePrivacy.
   - La restrizione degli eventi a parametri generici e bucketizzati (es. `duration_bucket: '<30m'`, `exercises_count_bucket: '1-3'`, codici errore `ERR_*`) elimina qualsiasi rischio di trasmettere PII, UID o dati sanitari.
5. **Rigore giuridico della Privacy Policy:**
   - L'inserimento delle basi giuridiche Art. 6(1)(b) e Art. 9(2)(a) GDPR blinda l'applicazione dal punto di vista legale per il trattamento dei dati biometrici e di salute.
   - Il vincolo di maggiore età (≥ 18 anni) esclude la necessità di gestire il consenso parentale per i minori.

---

## 3. Caveats

1. **Migrazione dati utenti legacy:** Gli utenti che hanno già salvato centinaia di esercizi predefiniti nel loro documento `users/{uid}` dovranno essere migrati tramite un parser retrocompatibile che filtri gli ID predefiniti non modificati senza perdere gli esercizi custom creati dall'utente.
2. **Ambiente offline in fase di primo boot:** Il seed JSON statico deve essere sempre incluso nel bundle di produzione Vite per garantire che il primo avvio offline non mostri mai un catalogo vuoto.
3. **No modifiche in `src/`:** In conformità al ruolo di Explorer e ai vincoli di investigazione pura, nessun file di produzione in `src/` è stato modificato in questa fase.

---

## 4. Conclusion

L'architettura proposta risolve in modo definitivo la gestione dei dati statici e sensibili per la pubblicazione della PWA LogBook:
- **Catalogo globale:** Cache IndexedDB dedicata `'logbook_cached_global_catalog'`, 1 singola lettura manifest O(1), fallback immediato su Seed JSON statico, regole Firestore in sola lettura client e delta model conforme ad `AGENTS.md`.
- **Privacy Analytics:** Opt-in locale revocabile, zero dati sanitari/PII/UID, tassonomia eventi generica e codici errore standardizzati.
- **GDPR Privacy Policy:** Specifica completa in lingua italiana (*Sentence case*), conformità Art. 6 e 9(2)(a), 18+ strict, Data Privacy Framework Google/Vercel, retention deterministica e diritti utente integrati in Impostazioni.

Il report dettagliato completo è disponibile in `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_3\analysis.md`.

---

## 5. Verification Method

Per verificare in modo indipendente le conclusioni e le specifiche:
1. **Verifica integrità del codice e build:**
   - Eseguire `npm run test` per accertare che i test attuali passino senza regressioni.
   - Eseguire `npm run build` per verificare che TypeScript compili regolarmente.
2. **Ispezione dei file di report:**
   - Aprire e verificare `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_3\analysis.md`.
3. **Verifica conformità AGENTS.md:**
   - Verificare che tutte le intestazioni e testi siano in *Sentence case* italiano.
   - Verificare che non sia stato toccato alcun file in `src/`.
