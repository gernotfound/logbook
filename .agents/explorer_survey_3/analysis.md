# Analisi architetturale: Catalogo globale, Privacy Analytics e GDPR Privacy Policy

## 1. Sommario esecutivo

Il presente documento definisce le specifiche architetturali e i requisiti implementativi per tre pilastri fondamentali del rilascio pubblico della PWA **LogBook**:
1. **Architettura del catalogo globale:** Migrazione degli esercizi e alimenti predefiniti da una duplicazione per-utente nel documento Firestore `users/{uid}` a una struttura pubblica versionata su Firestore, memorizzata in una chiave IndexedDB dedicata (`logbook_cached_global_catalog`), sincronizzata tramite un manifest leggero (1 lettura O(1)), supportata da seed JSON statico nel bundle e governata da un modello a delta (override utente) conforme alla checklist in 5 passaggi di `AGENTS.md`.
2. **Sistema di Privacy Analytics:** Progettazione di un sistema di telemetria e diagnostica anonima basato su consenso esplicito e revocabile (opt-in locale in `localStorage`/`IndexedDB`), con divieto assoluto di trasmissione di PII, UID, dati biometrici, sanitari, nomi di esercizi/alimenti, note o carichi.
3. **Specifica della Privacy Policy GDPR:** Redazione completa della Privacy Policy in lingua italiana (rigorosamente in *Sentence case*), con basi giuridiche Art. 6(1)(b) e Art. 9(2)(a) GDPR per dati relativi alla salute, requisito inderogabile di maggiore età (≥ 18 anni), mappatura dei fornitori (Google Firebase con DPF/SCC), tempi di conservazione certi, descrizione della memoria tecnica locale (LocalStorage/IndexedDB) e diritti dell'interessato (export CSV, rettifica, cancellazione autonoma immediata).

---

## 2. Architettura del catalogo globale

### 2.1 Stato attuale vs. Problematiche riscontrate
- **Implementazione attuale (`src/lib/defaultExercises.ts`, `src/lib/defaultFoods.ts`, `src/lib/db.ts`):**
  - All'inizializzazione dell'account o in `DB.loadUserData` (righe 55-69 di `src/lib/db.ts`), gli array completi `defaultExercises` (~100+ esercizi con muscoli primari/secondari) e `defaultFoods` (~300+ alimenti) vengono iniettati in `state.library` e `state.customFoods`.
  - In `DB.saveUserData` (righe 191-206 di `src/lib/db.ts`), l'intero array `state.library` e `state.customFoods` viene serializzato e salvato nel documento Firestore root `users/{uid}`.
- **Problematiche critiche:**
  1. **Superamento quota documento 1MB Firestore:** Il documento `users/{uid}` memorizza inutilmente centinaia di record statici. All'aumentare di routine, cicli e note, il documento si avvicina alla soglia di guardia di 950 KB (`checkDocSize`), rischiando il blocco delle scritture.
  2. **Consumo di banda e quota Spark:** Ogni scrittura del profilo trasferisce fino a 200-300 KB di dati statici identici per tutti gli utenti.
  3. **Impossibilità di aggiornare il catalogo:** Se viene corretto o aggiunto un esercizio/alimento predefinito, le modifiche non si propagano agli utenti esistenti senza una complessa e costosa migrazione dei documenti Firestore individuali.

---

### 2.2 Architettura a catalogo globale versionato (Global Catalog)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Cloud Firestore (Spark)                         │
│                                                                        │
│  /global_catalog/manifest                                              │
│  { version: "1.2.0", updatedAt: "2026-08-22", schemaVersion: 1, ... }  │
│                                                                        │
│  /global_catalog/exercises_v1          /global_catalog/foods_v1        │
│  { items: [ ...default exercises ] }   { items: [ ...default foods ] } │
│                                                                        │
│  Rules: allow read: if true; allow write: if false; (Admin Console)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (1 singola lettura manifest all'avvio)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Client PWA (Offline-First)                       │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tier 2 Cache: IndexedDB ('logbook_cached_global_catalog')        │  │
│  │ { manifest, exercises: [...], foods: [...], cachedAt: timestamp }│  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                   ▲                                    │
│  (Fallback iniziale se vuoto)     │                                    │
│  ┌────────────────────────────────┴─────────────────────────────────┐  │
│  │ Static Bundled Seed JSON (Seed Fallback nel bundle JS)           │  │
│  │ (seedExercises.json, seedFoods.json)                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ User Delta Model (in users/{uid} o IndexedDB UserData)           │  │
│  │ - customExercises: Exercise[] (creati da utente)                 │  │
│  │ - customFoods: Food[] (creati da utente)                         │  │
│  │ - catalogOverrides: Record<id, Override>                         │  │
│  │ - hiddenCatalogIds: string[] (nascosti/eliminati da utente)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                   │                                    │
│                                   ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Runtime Catalog Resolver (in-memory in useAppStore)              │  │
│  │ resolveCatalog(globalCatalog, userCustom, overrides, hiddenIds)  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2.3 Struttura del Manifest e Schemi Zod

#### Schema del Manifest (`CatalogManifest`):
```ts
export interface CatalogManifest {
    version: string;        // es. "1.0.0"
    updatedAt: string;      // es. "2026-08-22T00:00:00Z"
    schemaVersion: number;  // es. 1
    docRefs: {
        exercises: string;  // "exercises_v1" (documento sotto /global_catalog/)
        foods: string;      // "foods_v1" (documento sotto /global_catalog/)
    };
    itemCounts: {
        exercises: number;  // es. 120
        foods: number;      // es. 350
    };
}
```

#### Validazione Zod (`src/lib/schema.ts`):
```ts
export const CatalogManifestSchema = z.object({
    version: safeString('1.0.0'),
    updatedAt: safeString(new Date().toISOString()),
    schemaVersion: safeNumber(1),
    docRefs: z.object({
        exercises: safeString('exercises_v1'),
        foods: safeString('foods_v1'),
    }).catch({ exercises: 'exercises_v1', foods: 'foods_v1' }),
    itemCounts: z.object({
        exercises: safeNumber(0),
        foods: safeNumber(0),
    }).catch({ exercises: 0, foods: 0 }),
}).passthrough();
```

---

### 2.4 Flusso di sincronizzazione e minimizzazione letture Firestore

Per non superare la quota gratuita di 50.000 letture/giorno del piano Firebase Spark:
1. **Avvio pre-render (`main.tsx`):**
   - L'applicazione legge immediatamente `logbook_cached_global_catalog` da IndexedDB.
   - Se presente, inizializza lo store globale con i dati memorizzati in cache (tempo di avvio: <10ms, 0 letture di rete).
   - Se assente (primo avvio in assoluto, modalità ospite o storage pulito), carica istantaneamente il **Seed JSON statico** integrato nel bundle Vite.
2. **Verifica remota condizionale (`syncGlobalCatalog()`):**
   - Viene eseguita **una sola lettura Firestore O(1)**: `getDoc(doc(db, "global_catalog", "manifest"))`.
   - Se `manifest.version === cachedCatalog.manifest.version`: **zero letture aggiuntive**. La sincronizzazione termina immediatamente.
   - Se `manifest.version !== cachedCatalog.manifest.version` (o se la cache è corrotta/assente):
     - Vengono scaricati i soli documenti aggiornati referenziati (`exercises_v1`, `foods_v1`).
     - I dati scaricati vengono validati tramite Zod (`DomainParsers.parseLibrary`, `DomainParsers.parseCustomFoods`).
     - La cache IndexedDB `'logbook_cached_global_catalog'` viene aggiornata atomicamente.
3. **Resilienza offline ed errori di rete:**
   - In caso di assenza di rete, timeout (>4000ms) o blocco App Check, la Promise fallisce silenziosamente senza bloccare l'esperienza utente, continuando a utilizzare la copia in IndexedDB o il seed JSON.
   - Vietati tassativamente i listener in tempo reale (`onSnapshot`).

---

### 2.5 Firestore Security Rules per il Catalogo Globale
Le regole per `/global_catalog` devono consentire la lettura pubblica (o autenticata) e bloccare categoricamente qualsiasi scrittura da parte dei client:

```javascript
// firestore.rules
match /global_catalog/{document=**} {
  // Lettura consentita a tutti i client (o utenti autenticati/guest con App Check valido)
  allow read: if true;
  // Scritture client tassativamente vietate: aggiornamento solo da Admin Console o script di deploy
  allow write: if false;
}
```

---

### 2.6 Modello a delta (User Overrides) e Checklist in 5 passaggi di `AGENTS.md`

Per isolare i dati utente senza salvare duplicati dei predefiniti:
- Nel documento `users/{uid}`, il campo `customExercises` conterrà **solo** gli esercizi creati manualmente dall'utente.
- Il campo `catalogOverrides` conterrà le personalizzazioni utente applicate agli esercizi del catalogo (es. cambio muscoli, note personalizzate, tara attrezzo):
  ```ts
  export interface CatalogOverrides {
      exercises?: Record<string, {
          notes?: string;
          muscles?: string[];
          secondaryMuscles?: string[];
          equipmentWeight?: number;
          isBodyweight?: boolean;
          trackingType?: 'weight_reps' | 'time' | 'cardio';
      }>;
      hiddenExerciseIds?: string[];
      hiddenFoodIds?: string[];
  }
  ```
- **Risoluzione a runtime (`resolveLibrary`):**
  $$\text{EffectiveLibrary} = \big( \text{GlobalExercises} \setminus \text{HiddenIds} \big) \oplus \text{Overrides} \cup \text{CustomExercises}$$

#### Checklist obbligatoria in 5 passaggi (`AGENTS.md`):
1. `src/types.ts`: Definire `CatalogManifest`, `CachedGlobalCatalog`, `CatalogOverrides` ed estendere `UserData` con `customExercises?: Exercise[]`, `catalogOverrides?: CatalogOverrides`.
2. `src/lib/schema.ts`: Definire `CatalogOverridesSchema`, integrarlo in `UserDataSchema` con `.catch({})` difensivo e registrarlo in `defaultUserDataFallback` e `DomainParsers`.
3. `src/lib/db.ts`: In `DB.loadUserData` e `DB.saveUserData`, escludere i predefiniti globali da `userDocData`, includere `customExercises` e `catalogOverrides` nel diffing `deepEqual` e nella serializzazione batch.
4. `src/contexts/AuthContext.tsx` e `src/lib/merge.ts`: Aggiornare `defaultUserData` con collezioni utente pulite; in `mergeUserData`, fondere `customExercises` e `catalogOverrides` preservando le modifiche guest.
5. `src/lib/export.ts`: Aggiornare `Exporter.exportToCSV` per risolvere i nomi degli esercizi tramite il catalogo unificato a runtime.

---

## 3. Sistema di Privacy-Safe Analytics

### 3.1 Vincoli legali e principi di Privacy by Design
- **Opt-in obbligatorio (Privacy by Default):** La raccolta di telemetria è disabilitata di default all'installazione/primo avvio. Viene attivata solo previa azione affermativa dell'utente.
- **Divieto categorico di dati sensibili e sanitari:**
  - **MAI inviare:** UID Firebase, indirizzo email, nome utente, URL foto profilo.
  - **MAI inviare:** Nomi di esercizi, carichi (kg), ripetizioni (reps), tempi di recupero, valutazioni di fatica/umore/pump, dolori muscolari (DOMS), note di allenamento.
  - **MAI inviare:** Nomi di alimenti, marchi, calorie (kcal), grammi di macronutrienti (carbo/pro/grassi), orari o tipologie di pasti, integratori assunti.
  - **MAI inviare:** Peso corporeo, percentuale di massa grassa, circonferenze corporee, ore di sonno o metriche biometriche.

---

### 3.2 UI di consenso, revoca e persistenza locale
- **Collocazione UI:**
  - Schermata *Impostazioni $\rightarrow$ Sezione "Privacy e diagnostica"*.
  - Dialog modale di primo avvio (attivabile solo dopo aver preso visione dell'informativa).
- **Persistenza dello stato di consenso:**
  - Chiave sincrona in `localStorage`: `'logbook_analytics_consent'` con valori `'granted'` | `'denied'`.
  - Timestamp del consenso: `'logbook_analytics_consent_date'` (es. `"2026-08-22T19:50:00Z"`).
- **Revoca immediata:**
  - Se l'utente imposta il toggle su *Disattivato*, il client:
    1. Scrive `'denied'` in `localStorage`.
    2. Invoca immediatamente `setAnalyticsCollectionEnabled(analytics, false)` sull'istanza Firebase Analytics.
    3. Azzera e distrugge qualsiasi coda o buffer di eventi in memoria.
    4. Mostra conferma visiva immediata (*Sentence case*): *"Condivisione diagnostica disattivata."*

---

### 3.3 Tassonomia degli eventi anonimi consentiti

Tutti i parametri inviati devono essere categorizzati in "bucket" o enumerazioni generiche:

| Nome evento | Descrizione | Parametri consentiti (Whitelist) |
|---|---|---|
| `app_opened` | Apertura o avvio dell'applicazione | `platform: 'ios' \| 'android' \| 'desktop'`, `is_pwa: boolean`, `is_guest: boolean` |
| `screen_view` | Cambio di schermata principale | `screen_name: 'home' \| 'training' \| 'nutrition' \| 'data' \| 'settings'` |
| `sub_tab_view` | Navigazione tra sotto-schede | `tab_name: string`, `sub_tab_name: string` |
| `workout_session_logged` | Completamento di una sessione di allenamento | `duration_bucket: '<30m' \| '30-60m' \| '60-90m' \| '>90m'`, `exercises_count_bucket: '1-3' \| '4-6' \| '7-10' \| '>10'`, `is_routine_based: boolean` |
| `nutrition_day_logged` | Salvataggio di una giornata alimentare | `has_meals: boolean`, `has_measurements: boolean`, `meals_count_bucket: '1-3' \| '4-6' \| '>6'` |
| `routine_created` | Creazione di una nuova scheda | `exercises_count_bucket: '1-5' \| '6-10' \| '>10'` |
| `training_cycle_created` | Creazione di un ciclo di allenamento | `duration_weeks_bucket: '1-4' \| '5-8' \| '9-12' \| '>12'` |
| `csv_export_triggered` | Esportazione dei dati in CSV | `has_workouts: boolean`, `has_nutrition: boolean` |
| `pwa_installed` | Installazione dell'applicazione come PWA | `platform: 'ios' \| 'android' \| 'desktop'` |
| `app_check_result` | Esito verifica integrità App Check | `status: 'success' \| 'fallback_offline' \| 'unsupported'` |
| `sync_error_occurred` | Errore tecnico di sincronizzazione cloud | `error_category: string`, `error_code: string`, `is_offline: boolean` |

---

### 3.4 Tassonomia normalizzata dei codici di errore (`error_code`)

È vietato inviare stack trace, percorsi di file locali o messaggi di errore contenenti dati utente. I codici di errore devono essere rigorosamente standardizzati:

| Codice errore | Categoria | Descrizione |
|---|---|---|
| `ERR_AUTH_NETWORK` | Autenticazione | Timeout o errore di rete durante il login |
| `ERR_AUTH_EXPIRED` | Autenticazione | Sessione utente scaduta, richiesta riautenticazione |
| `ERR_FIRESTORE_UNAVAILABLE` | Database | Connessione di rete assente, attivata modalità offline |
| `ERR_FIRESTORE_QUOTA` | Database | Quota del piano Spark superata (`resource-exhausted`) |
| `ERR_FIRESTORE_PERMISSION` | Sicurezza | Scrittura respinta dalle Firestore Rules (`permission-denied`) |
| `ERR_FIRESTORE_TIMEOUT` | Database | Operazione batch Firestore non completata entro il timeout (7s) |
| `ERR_APP_CHECK_UNSUPPORTED` | Sicurezza | Browser o WebView non supporta reCAPTCHA v3 |
| `ERR_APP_CHECK_BLOCKED` | Sicurezza | Token App Check non valido o rifiutato |
| `ERR_STORAGE_QUOTA_EXCEEDED` | Storage locale | Spazio `localStorage` o `IndexedDB` esaurito sul dispositivo |
| `ERR_SCHEMA_VALIDATION_FALLBACK` | Integrità dati | Parsing Zod fallito su record corrotto, applicato fallback sicuro |

---

## 4. Specifica della GDPR Privacy Policy

Di seguito viene redatta la specifica completa della Privacy Policy, redatta in italiano, aderente alle convenzioni del *Sentence case* e strutturata per la visualizzazione sia in-app (*Impostazioni $\rightarrow$ Informativa sulla privacy*) sia pre-autenticazione (*Schermata di accesso*).

```markdown
# Informativa sulla privacy (Privacy policy)

Ultimo aggiornamento: 22 agosto 2026

La presente informativa sulla privacy descrive le modalità e le finalità con cui l'applicazione LogBook ("Applicazione", "noi", "nostro") raccoglie, utilizza, conserva e protegge i dati personali degli utenti ("Utente", "tu"), nel pieno rispetto del Regolamento Generale sulla Protezione dei Dati dell'Unione Europea (GDPR, Regolamento UE 2016/679) e della normativa nazionale vigente.

---

## 1. Titolare del trattamento
L'applicazione LogBook è sviluppata e distribuita come strumento software di utilità personale per il tracciamento sportivo e nutrizionale autonomo.
- **Titolare del trattamento:** [Nome e Cognome / Ragione Sociale dello Sviluppatore]
- **Indirizzo di contatto e assistenza privacy:** privacy@logbook.app (o tramite il modulo di supporto dedicato)
Ciascun utente mantiene il controllo esclusivo, diretto e autonomo sui propri dati personali inseriti nell'applicazione.

---

## 2. Requisito inderogabile di maggiore età (≥ 18 anni)
L'utilizzo dell'applicazione LogBook è strettamente riservato a persone fisiche che abbiano compiuto il **diciottesimo (18°) anno di età**. 
L'applicazione non è destinata a minori di 18 anni e non raccoglie intenzionalmente dati personali di minori. Qualora venisse accertata la registrazione o la presenza di dati appartenenti a un minore, l'account e tutti i dati a esso associati verranno immediatamente e permanentemente eliminati dai nostri sistemi.

---

## 3. Categorie di dati trattati
LogBook raccoglie ed elabora esclusivamente i dati strettamente necessari per erogare le funzionalità dell'applicazione:

### a) Dati di autenticazione e identificazione
- **Accesso con account Google:** Indirizzo email, identificativo univoco dell'account Google (UID), nome visualizzato e immagine del profilo (forniti da Google Identity Services).
- **Accesso in modalità locale (Guest):** Identificativo di sessione locale memorizzato esclusivamente sul dispositivo dell'utente.

### b) Dati particolari relativi alla salute e biometrici (Art. 9 GDPR)
I dati inseriti volontariamente dall'utente per monitorare il proprio stato di forma fisica costituiscono categorie particolari di dati personali ai sensi dell'Art. 9 del GDPR:
- **Misurazioni biometriche:** Peso corporeo, altezza, data di nascita (per il calcolo dell'età biologica), percentuale stimata di massa grassa, circonferenze corporee (collo, torace, spalle, bicipiti, vita, fianchi, cosce, polpacci).
- **Dati di allenamento:** Schede di allenamento, storico degli esercizi, carichi sollevati, ripetizioni, tempi di recupero, durata delle sessioni, autovalutazioni di fatica, umore, pompaggio muscolare e registrazione dei dolori muscolari post-allenamento (DOMS).
- **Dati nutrizionali e integratori:** Diario alimentare quotidiano, apporto calorico e di macronutrienti (carboidrati, proteine, grassi), assunzione di acqua, registrazioni di integratori alimentari e note descrittive sui pasti.
- **Dati sul riposo:** Ore di sonno totali e ripartizione stimata delle fasi del sonno (profondo, leggero, REM, veglia) inserite manualmente.

### c) Dati tecnici e di funzionamento
- Indirizzo IP (gestito esclusivamente a livello di infrastruttura da Google Firebase per l'instradamento di rete e la sicurezza App Check, non archiviato stabilmente né associato al profilo).
- Informazioni sul dispositivo: tipologia di browser, sistema operativo e stato di installazione dell'applicazione (PWA).
- Token di sicurezza e integrità: Firebase App Check con reCAPTCHA v3 per la prevenzione di abusi e attacchi automatizzati.

### d) Dati statistici e diagnostici anonimi (previo consenso esplicito)
- Eventi di navigazione aggregati e anonimi (es. schede visualizzate, durata indicativa delle sessioni, codici di errore tecnici), privi di identificatori personali, nomi di alimenti/esercizi o dati biometrici.

---

## 4. Basi giuridiche del trattamento (Art. 6 e Art. 9 GDPR)
Il trattamento dei tuoi dati si fonda esclusivamente sulle seguenti basi giuridiche:
1. **Esecuzione del servizio e obblighi contrattuali (Art. 6, par. 1, lett. b, GDPR):** Il trattamento dei dati di autenticazione e tecnici è indispensabile per consentirti l'accesso all'applicazione, la sincronizzazione cloud multi-dispositivo e la fruizione del diario personale.
2. **Consenso esplicito per i dati relativi alla salute (Art. 6, par. 1, lett. a e Art. 9, par. 2, lett. a, GDPR):** Il trattamento delle misurazioni corporee, dei dati di allenamento, nutrizione e riposo avviene esclusivamente sulla base del tuo **consenso esplicito e informato**, prestato al momento della registrazione e manifestato attraverso l'inserimento volontario dei dati nell'applicazione.
3. **Consenso facoltativo e separato per la telemetria anonima (Art. 6, par. 1, lett. a, GDPR):** La raccolta di statistiche aggregate d'uso e diagnostica tecnica richiede un consenso opt-in dedicato. Il mancato conferimento di tale consenso non pregiudica in alcun modo l'accesso e l'utilizzo dell'applicazione.

---

## 5. Fornitori terzi, responsabili del trattamento e trasferimenti internazionali
LogBook non vende, non affitta, non cede e non condivide alcun dato personale con broker di dati, agenzie pubblicitarie o reti di profilazione commerciale. I dati sono trattati esclusivamente tramite i seguenti fornitori tecnici designati quali Responsabili del Trattamento:

1. **Google Firebase (Google Ireland Limited / Google LLC):**
   - Servizi utilizzati: Firebase Authentication (autenticazione sicura), Cloud Firestore (database cloud cifrato), Firebase App Check (sicurezza anti-abuso) e Firebase Analytics (statistiche anonime).
   - Ubicazione dei server: Unione Europea / Stati Uniti.
   - Garanzie per i trasferimenti extra-UE: I trasferimenti verso Google LLC negli Stati Uniti sono regolati dall'**EU-U.S. Data Privacy Framework (DPF)** e dalle **Clausole Contrattuali Standard (Standard Contractual Clauses - SCC)** approvate dalla Commissione Europea, garantendo un livello di protezione equivalente a quello comunitario.
2. **Vercel Inc.:**
   - Servizio utilizzato: Hosting della Progressive Web App e distribuzione dei file statici tramite rete CDN globale, nel rispetto delle Clausole Contrattuali Standard (SCC).

---

## 6. Modalità di conservazione e tempi di cancellazione (Data retention)
I dati vengono conservati secondo criteri rigorosamente definiti e non a tempo indeterminato:
- **Dati dell'account, biometrici, di allenamento e nutrizione:** Conservati per l'intera durata di attività dell'account. In caso di inattività continuativa per oltre 24 mesi, l'account e tutti i dati associati potranno essere rimossi previa notifica via email.
- **Cancellazione volontaria dell'account:** L'utente può eliminare autonomamente e in tempo reale l'intero account e tutte le relative subcollection premendo il pulsante *"Elimina account e dati"* nelle Impostazioni. L'eliminazione dai database cloud di Firestore e da Firebase Auth è immediata e irreversibile.
- **Dati in cache locale (IndexedDB e LocalStorage):** Conservati sul dispositivo dell'utente fino alla cancellazione manuale dei dati di navigazione del browser o alla disinstallazione della PWA.
- **Dati diagnostici e statistici aggregati:** Conservati sui server analitici per un periodo massimo di 14 mesi in forma completamente anonima e non ricollegabile alla persona.

---

## 7. Memoria tecnica locale e funzionamento offline-first
L'applicazione adotta un'architettura **Offline-first a 3 livelli** che impiega memorie tecniche sul tuo dispositivo:
- **IndexedDB (`idb-keyval`):** Memorizza la copia di sicurezza locale dei dati utente (`logbook_cached_user_data`) e la cache del catalogo globale predefinito (`logbook_cached_global_catalog`). Consente all'app di funzionare fluidamente anche in totale assenza di connessione internet.
- **LocalStorage:** Memorizza identificatori di sessione temporanei, preferenze di interfaccia, lo stato del workout attivo in corso (`logbook_local_workout`) e lo stato del consenso analitico (`logbook_analytics_consent`).
Queste tecnologie operano come supporti tecnici essenziali al servizio (cookie tecnici / local storage essenziale) e non tracciano la navigazione dell'utente all'esterno dell'applicazione.

---

## 8. Diritti dell'interessato (GDPR Artt. 15-22)
In qualità di interessato, il GDPR ti garantisce i seguenti diritti esigibili in qualsiasi momento:
1. **Diritto di accesso e portabilità dei dati (Artt. 15 e 20 GDPR):** Puoi esportare l'intero archivio dei tuoi allenamenti e delle tue misurazioni nutrizionali in formato standard aperto (file CSV con codifica UTF-8 BOM, compatibile con Excel e software di analisi) premendo il pulsante *"Esporta dati (CSV)"* nella sezione Impostazioni.
2. **Diritto di rettifica (Art. 16 GDPR):** Puoi correggere, aggiornare o modificare direttamente e in qualsiasi momento qualsiasi dato anagrafico, biometrico o di allenamento tramite le rispettive schermate dell'app.
3. **Diritto alla cancellazione / Diritto all'oblio (Art. 17 GDPR):** Puoi eliminare definitivamente ogni dato presente sul cloud e sul dispositivo locale tramite la funzione *"Elimina account e dati"* nelle Impostazioni.
4. **Diritto di revoca del consenso (Art. 7, par. 3, GDPR):** Puoi revocare il consenso al trattamento dei dati sanitari (comportando la chiusura dell'account) o revocare il consenso alla telemetria anonima in qualsiasi momento tramite l'apposito selettore nelle Impostazioni.
5. **Diritto di proporre reclamo all'Autorità di controllo (Art. 77 GDPR):** Qualora ritenessi che il trattamento dei tuoi dati violi la normativa vigente, hai il diritto di proporre reclamo all'Autorità Garante per la Protezione dei Dati Personali (Piazza Venezia 11, 00187 Roma, www.garanteprivacy.it).

---

## 9. Sicurezza dei dati
LogBook adotta misure tecniche e organizzative all'avanguardia per proteggere i tuoi dati personali:
- Crittografia end-to-end su canale sicuro HTTPS / TLS per ogni comunicazione tra client e server.
- Cifratura dei dati a riposo (encryption at rest) sui server cloud di Google Firestore.
- Regole di sicurezza server-side (Firestore Security Rules) che impediscono rigorosamente a chiunque (eccetto il titolare dell'account autenticato) di leggere o scrivere i dati delle subcollection.
- Protezione dell'infrastruttura tramite Firebase App Check con reCAPTCHA v3 per impedire accessi abusivi da client non autorizzati o bot.

---

## 10. Modifiche alla presente informativa
Ci riserviamo il diritto di aggiornare la presente informativa sulla privacy a seguito di evoluzioni normative o aggiornamenti delle funzionalità tecniche. Qualsiasi modifica sostanziale verrà notificata agli utenti all'interno dell'applicazione con congruo preavviso prima della sua entrata in vigore.
```

---

## 5. Sintesi architetturale e piano di integrazione file per file

| File sorgente interessato | Responsabilità architetturale | Modifica progettata (PoC) |
|---|---|---|
| `src/types.ts` | Definizione tipi TypeScript | Aggiunta interfacce `CatalogManifest`, `CachedGlobalCatalog`, `CatalogOverrides`; aggiornamento di `UserData` per isolare `customExercises` e `catalogOverrides`. |
| `src/lib/schema.ts` | Gateway difensivo Zod | Aggiunta `CatalogManifestSchema`, `CatalogOverridesSchema`; aggiornamento `UserDataSchema`, `defaultUserDataFallback` e `DomainParsers`. |
| `src/lib/db.ts` | Persistenza Firestore & IndexedDB | Rimozione dell'iniezione dei default in `loadUserData` e `saveUserData`; aggiunta metodi `loadCatalogManifest` e `fetchGlobalCatalog`; verifica rigida quota 950 KB. |
| `src/lib/merge.ts` | Fusione dati Guest/Cloud | Aggiornamento algoritmi di fusione per unire `customExercises` e `catalogOverrides` senza sporcare il catalogo globale. |
| `src/contexts/AuthContext.tsx` | Ciclo di vita utente & default | Snellimento di `defaultUserData` (rimozione di centinaia di default hardcoded in memoria utente). |
| `src/store/slices/createDataSlice.ts` | Cache IndexedDB catalogo | Gestione della chiave dedicata `'logbook_cached_global_catalog'` e sincronizzazione con store Zustand. |
| `src/lib/analytics.ts` | Telemetria Privacy-Safe | Creazione modulo client con controllo opt-in (`'logbook_analytics_consent'`), whitelist parametri anonimi e normalizzazione codici errore. |
| `src/components/SettingsView.tsx` | UI Impostazioni & Privacy | Aggiunta toggle consenso "Analitica e diagnostica", visualizzazione modale Privacy Policy completa in *Sentence case*. |
| `firestore.rules` | Regole di sicurezza Firestore | Aggiunta blocco `/global_catalog/{document=**}` con `allow read: if true; allow write: if false;`. |
| `src/lib/export.ts` | Esportazione dati GDPR | Risoluzione nomi esercizi combinando catalogo globale e personalizzazioni utente prima della generazione del file CSV. |
