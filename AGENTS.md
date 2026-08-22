# Regole di progetto, architettura e linee guida per AI (LogBook)

Questo file è la "Bibbia" architetturale dell'app **LogBook**. Ogni sessione AI deve leggere, assimilare e rispettare *rigorosamente* questo documento prima di scrivere una sola riga di codice.

---

## 1. Stack tecnologico & strumenti
- **Core:** React 19 (`react`, `react-dom` ^19.2), TypeScript, Vite.
- **Hosting & deployment:** Vercel (deploy automatico a ogni `git push`, servito sulla radice `/` del dominio, zero-config CI/CD).
- **State management:** Zustand 5 (Store globale centralizzato in `src/store/useAppStore.ts`).
- **Validazione runtime & sanitizzazione:** Zod (Gateway obbligatorio in `src/lib/schema.ts`).
- **Persistenza & storage ibrido:** IndexedDB (`idb-keyval`) per la cache globale persistente; `localStorage` sincrono per il workout attivo (`logbook_local_workout`), modalità guest (`logbook_is_guest`) e stati volatili (tab/timer/draft).
- **Backend & database:** Firebase Modular SDK v12 (`firebase/firestore`, `firebase/auth`). Configurazione rigorosamente da variabili d'ambiente `VITE_FIREBASE_*` con fail-fast immediato e divieto assoluto di credenziali hardcoded.
- **Styling:** CSS nativo (Vanilla CSS) basato su variabili (CSS custom properties in `src/styles/global.css`). Assolutamente **NO Tailwind** o framework CSS esterni.
- **Iconografia:** `lucide-react` (usare proporzioni coerenti, di norma `size={24}` o `size={20}`).
- **PWA & monitoraggio:** `vite-plugin-pwa` per la gestione del service worker e del manifest; `@vercel/analytics` e `@vercel/speed-insights` per metriche real user.
- **Librerie di supporto:** `date-fns` per date e intervalli temporali, `fast-deep-equal` per il diffing delle scritture Firestore, `chart.js` & `react-chartjs-2` per i grafici (stack grafico ufficiale basato su HTML5 Canvas 2D per rendering ad alte prestazioni, compatibilità garantita con React 19, Vite e ottimizzato a 60fps per dispositivi mobili iOS/PWA), `fuse.js` per la ricerca fuzzy.
- **Testing & quality:** `vitest` (`@testing-library/react`, `jsdom`) e `oxlint`.

## 2. Architettura di rete e storage ibrido (3-Tier Storage & Offline-First)
- **Architettura a 3 livelli (Storage tiering):**
  1. **Tier 1 (Cloud - Firestore):** Persistenza remota su Firebase Firestore con subcollection mensilizzate (`history_months/{YYYY-MM}` e `nutrition_months/{YYYY-MM}`).
  2. **Tier 2 (Global async cache - IndexedDB `idb-keyval`):** Memorizza l'intero albero di stato `UserData` (chiave `'logbook_cached_user_data'`). Supera la quota rigida di 5MB di `localStorage`, prevenendo eccezioni `QuotaExceededError`.
  3. **Tier 3 (Sync local volatile - `localStorage`):** Riservato esclusivamente ai dati che richiedono persistenza sincrona istantanea (`'logbook_local_workout'`, `'logbook_is_guest'`, tab correnti `'logbook_activeTab'`, stati dei timer e bozze locali).
     - **LocalStorage Parse Strictness (`useLocalStorage.ts`):** Divieto assoluto di accettare o restituire plain string o dati non validati se `JSON.parse` o lo schema Zod falliscono. L'hook `useLocalStorage` supporta la validazione opzionale tramite Zod (`schema.safeParse`). Se il valore in `localStorage` genera un errore di parsing o non rispetta lo schema, l'hook deve loggare l'errore e restituire tassativamente `initialValue`. Tutte le scritture su `localStorage` devono essere serializzate con `JSON.stringify()`.
- **Fast pre-render bootstrap (`src/main.tsx` $\rightarrow$ `window.__INITIAL_USER_DATA__`):**
  - All'avvio dell'app (`initApp` in `src/main.tsx`), prima della chiamata `createRoot().render()`, la cache utente globale viene recuperata in modo asincrono da IndexedDB e assegnata a `window.__INITIAL_USER_DATA__`.
  - Lo store Zustand `useAppStore` viene inizializzato immediatamente tramite `getInitialUserData()`, validando la cache con `UserDataSchema.parse()`.
  - **Perché è cruciale?** Elimina qualsiasi race condition con il ciclo di vita React e `AuthContext`:
    - Impedisce il flash di schermate vuote o overlay di sincronizzazione spuri (`setSyncing(true)` / `#sync-overlay`) all'avvio in modalità offline o su connessioni lente.
    - Evita la cancellazione distruttiva dei dati in modalità Guest: previene che `loginAsGuest()` veda `userData` come `null` e lo sovrascriva con lo stato vuoto `defaultUserData`.
    - Evita la perdita dei dati locali durante il collegamento dell'account Google (`linkGoogleAccount`).
- **Modalità cloud & merge dei dati (Deterministic Guest Merge):**
  - Al login con Google, il listener `onAuthStateChanged` in `src/contexts/AuthContext.tsx` recupera i dati da Firestore tramite `DB.loadUserData()`.
  - Se un utente guest effettua il login o collega un account Google, i suoi dati locali vengono fusi con quelli del cloud tramite un **merge deterministico per collezione**:
    - È tassativamente vietato usare uno spread superficiale cieco (`...cloudData, ...guestData`) che sovrascriverebbe e cancellerebbe collezioni cloud.
    - Array con ID (`library`, `routines`, `customFoods`, `trainingCycles`, `history`, `supplements`): unione deduplicata per `id`, dando priorità alle modifiche locali (guest) in caso di collisione di ID.
    - Record per data `nutrition` (`Record<string, NutritionDay>`): unione delle date (`YYYY-MM-DD`), e per le date coincidenti merge deduplicato dei sotto-array `meals` (per `m.id`) e `supplementsIntake` (per `si.id`).
    - Campi scalari (`profile`, `nutritionPlanning`, `activeWorkout`, `activeCycleId`): priorità ai dati guest se valorizzati/non-vuoti, altrimenti dati cloud.
    - Il dato unificato risultante DEVE transitare e superare la validazione `UserDataSchema.parse()` prima del salvataggio su Firestore (`DB.saveUserData(mergedData)`).
- **Offline resilience:** In assenza di connessione o in caso di timeout di rete, l'applicazione continua a operare regolarmente leggendo e scrivendo su IndexedDB locale, mentre l'SDK Firestore gestisce le code offline in background.

## 3. Gestione dello stato, Zod Gateway e persistenza (Cruciale)
- **Single source of truth:** L'intera app attinge dallo store Zustand `useAppStore` in `src/store/useAppStore.ts`.
- **Zod Gateway (Sanitizzazione e difesa runtime in `src/lib/schema.ts`):**
  - Tutti i dati in ingresso da Firestore (`DB.loadUserData`) o da IndexedDB (`getInitialUserData`) DEVONO transitare attraverso `UserDataSchema.parse()`.
  - I tipi TypeScript svaniscono a runtime: il Gateway Zod funge da barriera doganale per impedire che dati malformati o parzialmente corrotti (`NaN`, stringhe al posto di numeri, `null` inattesi, array mancanti) provochino crash nei componenti React.
  - Vengono utilizzati helper difensivi specifici (`safeString`, `safeOptionalString`, `safeNumber`, `safeOptionalNumber`, `safeOptionalNullableNumber`, `safeBoolean`, `safeOptionalBoolean`) con fallback `.catch(...)` e `.default(...)`.
  - I sub-schema usano `.passthrough()` per non scartare campi addizionali legittimi.
- **Pipeline di salvataggio, debouncing & Gestione Promise (Zustand Promises):**
  1. I componenti invocano un'azione o `saveUserData((prev) => ({ ... }))` / `updateUserData`.
  2. Zustand aggiorna lo stato in memoria e chiama immediatamente `saveUserDataToCache(finalData)` per sincronizzare la cache IndexedDB.
  3. Viene avviato il **Debouncer globale di 1000ms** (`DEBOUNCE_DELAY_GLOBAL`) incapsulato in `useAppStore.ts`.
  4. Alla scadenza del timer, `DB.saveUserData` (`src/lib/db.ts`) effettua il diffing con `fast-deep-equal` (`deepEqual(state, oldState)`).
  5. **Gestione rigorosa delle Promise (Nessun successo silenzioso):** Le funzioni `saveUserData` e `updateUserData` DEVONO rigettare la Promise restituita qualora `DB.saveUserData` sollevi un'eccezione o fallisca la persistenza. È vietato risolvere silenziosamente (`resolve()`) nel `catch` o nel `finally` quando si verifica un errore. Lo store deve impostare `saveError` con il messaggio di errore e reimpostare `syncing: false` nel blocco `finally`.
  6. **Bucketing mensile Firestore & superamento del limite di 1MB:**
     - Documento principale `users/{uid}`: memorizza `profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements` (con controllo rigido `checkDocSize < 950KB`).
     - Subcollection `users/{uid}/history_months/{YYYY-MM}`: sessioni di allenamento raggruppate per mese.
     - Subcollection `users/{uid}/nutrition_months/{YYYY-MM}`: registrazioni nutrizionali giornaliere e misure per mese.
     - Le scritture e cancellazioni dei soli mesi effettivamente modificati vengono raggruppate in un `writeBatch(db)` atomico con timeout protettivo di 7000ms.
- **⚠️ CHECKLIST OBBLIGATORIA IN 5 PASSAGGI PER NUOVE PROPRIETÀ:**
  Se aggiungi una nuova proprietà all'interfaccia `UserData`, DEVI aggiornare tutti i 5 file seguenti:
  1. `src/types.ts`: definire l'interfaccia e la proprietà in `UserData`.
  2. `src/lib/schema.ts`: creare il sub-schema difensivo, registrarlo in `UserDataSchema` e in `defaultUserDataFallback`. *Se salti questo passaggio, `UserDataSchema.parse()` eliminerà silenziosamente la nuova proprietà a ogni avvio o download dal cloud.*
  3. `src/lib/db.ts`:
     - In `DB.loadUserData`: dichiarare la proprietà nell'oggetto `state` e mapparla da `data`.
     - In `DB.saveUserData`: dichiararla in `oldState`, includerla nel controllo `deepEqual` e serializzarla in `userDocData` (o nella subcollection appropriata).
  4. `src/contexts/AuthContext.tsx`: includere il valore iniziale in `defaultUserData`.
  5. `src/lib/export.ts` (o `src/hooks/useSettings.ts`): se il dato deve essere esportabile, includerlo nella formattazione CSV di `exportToCSV`.

## 4. Gestione delle date e dei timezone
- **Niente `toISOString` puro:** Le date di sistema, i log di allenamento e le registrazioni nutrizionali devono essere salvati nel fuso orario locale usando SEMPRE `Logic.getLocalDateString()` (es. `2026-08-14`).
- **Perché?** L'orario UTC sfasa la mezzanotte locale: un allenamento completato alle 00:30 verrebbe salvato nel giorno precedente se formattato in UTC puro.
- **Utility date:** Usare le utility in `src/lib/utils/date.ts` / `Logic` (`getLocalDateString`, `formatItalianDate`, `parseDateInput`, `calculateAge`, `formatTime`, `formatDuration`, `getCalendarMonthGrid`) e la libreria `date-fns` per la manipolazione di intervalli temporali e scadenze.

## 5. Vincoli Firebase, hosting Vercel e sicurezza domini
- **Sicurezza configurazione Firebase & fail-fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
- **Vite static access & environment variables (Prevenzione crash di build):** 
  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la build (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
  - Le chiavi Firebase Web sono pubbliche per natura client-side. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (da committare nel repository) oppure configurare le variabili d'ambiente direttamente nella dashboard di Vercel (*Project Settings* $\rightarrow$ *Environment Variables*), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).
- **Hosting e deploy continuo su Vercel (Root base path):**
  - L'applicazione è ospitata ufficialmente sulla piattaforma **Vercel**.
  - Il deploy è continuo e automatico a ogni `git push` sul branch principale. Non è richiesto alcun file di workflow o pipeline di build dedicata (zero-config CI/CD).
  - L'app gira tassativamente sulla radice (`/`) del dominio, come configurato in `vite.config.ts` (`base: '/'`). È vietato l'utilizzo di subpath o prefissi URL annidati.
  - Il monitoraggio delle prestazioni e l'analisi degli utenti reali sono affidati ai pacchetti integrati `@vercel/analytics` e `@vercel/speed-insights`.
- **⚠️ CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI (Firebase Auth & Google Cloud API Key):**
  Qualsiasi modifica, aggiunta o migrazione del dominio dell'app (es. cambio dominio di produzione o nuovo sottodominio Vercel) impone tassativamente l'esecuzione immediata dei seguenti due passaggi di sicurezza per prevenire blocchi dell'autenticazione o errori 403 Forbidden:
  1. **Firebase Authentication (Authorized domains):** Aggiungere il nuovo dominio nella console Firebase (*Authentication* $\rightarrow$ *Settings* $\rightarrow$ *Authorized domains*). Senza questo passaggio, il login con Google e le funzioni di autenticazione falliranno sollevando l'eccezione `auth/unauthorized-domain`.
  2. **Google Cloud (Browser key / referrers):** Aggiungere il dominio tra i referrer HTTP autorizzati nelle restrizioni della "Browser key" su Google Cloud Credentials (*APIs & Services* $\rightarrow$ *Credentials* $\rightarrow$ *Browser key*). L'omissione causerà errori bloccanti 403 Forbidden su tutte le chiamate verso Identity Toolkit e Firestore.
- Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite.
- Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
- Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.

## 6. Anti-pattern React (Prevenzione freeze e loop di re-render)
- **Shallow equality killer:** MAI usare inizializzatori inline per array o oggetti vuoti all'interno dei selettori Zustand:
  - ❌ `const dati = useAppStore(state => state.dati || [])` (Crea una nuova referenza a ogni render, generando loop infiniti).
  - ✅ `const EMPTY_ARRAY = [];` dichiarato fuori dal componente, e poi `useAppStore(state => state.dati || EMPTY_ARRAY)`.
- **Memoizzazione mirata nei componenti ad alta frequenza:** Nelle viste di allenamento attivo (`SessionExerciseCard.tsx`, `SessionSetRow.tsx`), utilizzare `React.memo` con comparatore personalizzato per evitare re-render a cascata dell'intera lista esercizi durante la digitazione rapida di carichi e ripetizioni.

## 7. UX Mobile, iOS e PWA constraints
- **Finestre modali `<dialog>` proibite per form ed editor:** Vietato usare finestre modali o `<dialog>` per form complessi di inserimento/modifica. Rompono lo scrolling su iOS e creano conflitti con le tastiere virtuali. Utilizzare espansioni a tendina ("accordion") o viste inline condizionali a tutto schermo (`if (isEditing) return <EditView />`).
- **Dialoghi globali di sistema (`useDialogStore` & `GlobalDialog.tsx`):** Per notifiche, alert e conferme di eliminazione/logout, NON usare mai i metodi bloccanti nativi `window.confirm()` o `window.alert()`. Usare tassativamente `useDialogStore.getState().showAlert(...)` e `useDialogStore.getState().showConfirm(...)` renderizzati dal componente `GlobalDialog.tsx`.
- **Prevenzione zoom Safari:** Qualsiasi `input`, `select` o `textarea` DEVE avere `font-size: 16px !important` nel CSS, per evitare lo zoom automatico e fastidioso di Safari su iOS.
- **CSS flexbox mobile:** Inserire sempre `min-width: 0` nei figli diretti di container `display: flex` per prevenire overflow orizzontale su schermi stretti.
- **Input numerici:** Nei form usare sempre `<input type="number" inputMode="decimal" onFocus={e => e.target.select()} />`. Permettere che il campo diventi una stringa vuota `""` se l'utente cancella tutto (non forzare il reset automatico a `0` durante la digitazione).
- **Keep-alive e scroll preservation:** In `App.tsx`, le viste principali preservano la posizione di scroll tramite il dizionario `tabScrollPositions`.

## 8. Blindatura dello stato in background (Safari Suspend & Storage Ibrido)
- Se l'utente chiude il browser, spegne lo schermo o passa ad altra applicazione nel mezzo di un allenamento, il sistema operativo (in particolare iOS WebKit e Android PWA) può congelare o terminare all'istante il thread JavaScript, interrompendo qualsiasi Promise, microtask o timeout pendente.
- **Salvataggio sincrono istantaneo:** Il salvataggio del workout attivo (`localWorkout`) **deve rimanere tassativamente confinato a `localStorage` sincrono** con chiave `'logbook_local_workout'`.
  - **Perché `localStorage` e MAI IndexedDB per il live workout?** `localStorage.setItem()` è un'operazione sincrona bloccante che il browser garantisce prima di congelare il processo. IndexedDB si basa su transazioni asincrone con callback/Promise che verrebbero abortite dall'OS prima del completamento.
- **Listener `visibilitychange` in `src/store/useAppStore.ts`:**
  - Quando `document.visibilityState === 'hidden'`, lo store intercetta l'evento ed esegue immediatamente `localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout))`, bypassando il debouncer locale di 300ms.
- **Protezione anti-sovrascrittura (Local workout shield):** In `useAppStore.setUserData`, un fetch proveniente dalla rete NON deve mai sovrascrivere il `localWorkout` attivo sul dispositivo locale: la copia in memoria locale è la source of truth assoluta della sessione in corso.

## 9. Logica di allenamento (Routines, Cicli, Serie speciali e Timer)
- **Routines e training cycles:** Le **Routines** (schede) sono blueprint statici di esercizi; i **Training cycles** (cicli) definiscono la rotazione, la durata in settimane e la progressione.
- **Suggerimento della prossima scheda:** Il calcolo è demandato a `getNextScheduledRoutine` in `src/lib/calc/planning.ts`, basato sul conteggio delle sessioni completate per il ciclo attivo (`completedSessions % routineCount`).
- **Serie speciali (Dropset e Isometrie):**
  - Le serie speciali NON si auto-propagano all'aggiunta di una nuova serie normale (per scelta dell'utente).
  - L'aggiunta manuale numera sequenzialmente le serie: `↳ Dropset 1`, `↳ Dropset 2`, `↳ Isometria 1` (con durata in secondi).
- **Tipologie di tracciamento (`trackingType`):** Supporto per `weight_reps` (peso e ripetizioni), `time` (tempo in secondi e carico opzionale) e `cardio` (durata, distanza, calcolo automatico velocità `dist / (time / 60)`, inclinazione e calorie).
- **Cronometri e timer di recupero (`WorkoutTimer.tsx`):**
  - MAI usare `setInterval` puro per il conteggio del tempo (subisce forte throttling o congelamento in background).
  - Si memorizza il timestamp iniziale `Date.now()` in `localStorage` (`logbook_timer_start`, `logbook_timer_state`, `logbook_timer_accumulated`) e si ricalcola il delta a ogni tick visivo e al ritorno dal background tramite `visibilitychange`.

## 10. Design system (Dark Glassmorphism)
- Il tema è profondo, minimale e governato centralmente da `src/styles/global.css`.
- **Variabili CSS principali:**
  - Sfondi: `--bg-color: #000000;`, `--surface-color: #0d0d0d;`, `--surface-light: #1a1a1a;`
  - Accenti: `--primary-color: #00e5ff;`, `--primary-glow: rgba(0, 229, 255, 0.3);`, `--accent-color: #cc00ff;`
  - Feedback: `--danger-color: #ff4d6d;`, `--warning-color: #ffb703;`, `--success-color: #2ecc71;`
  - Trasparenze in vetro: `--glass-bg: rgba(13, 13, 13, 0.85);`, `--glass-border: rgba(255, 255, 255, 0.1);`
  - Testi: `--text-main: #f0f0f0;`, `--text-muted: #9ba3af;`
- **Classi e prefissi standard:** `.card`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-small`, `.btn-icon`, `.form-group`, `.input-row`, `.spinner`.
- **Regola di consistenza:** Quando aggiungi un elemento di UI, assicurati che rispetti la densità, il contrasto e il feeling premium del tema dark glassmorphism.

## 11. Stile testuale (Sentence case italiano)
- Ogni testo rivolto all'utente (label, bottoni, placeholder, alert, titoli di sezione) DEVE rispettare rigorosamente la convenzione italiana del **Sentence case**: *Solo ed esclusivamente la primissima lettera della frase va in maiuscolo*. Le parole successive sono minuscole, salvo nomi propri, sigle o marchi.
- ❌ **Sbagliato (Title case):** "Nuova Misurazione Corporea", "Salva Modifiche Scheda", "Dati Biometrici", "Aggiungi Esercizio".
- ✅ **Corretto:** "Nuova misurazione corporea", "Salva modifiche scheda", "Dati biometrici", "Aggiungi esercizio".

## 12. Feedback immediato e mental model
- Nessuna azione deve essere "cieca". Se l'utente preme un pulsante (es. "Aggiungi", "Salva", "Elimina"), deve esserci un riscontro visivo istantaneo (aggiornamento ottimistico, comparsa di un toast, svuotamento dell'input, progress bar) *nella stessa schermata in cui si trova*. Non costringere l'utente a cambiare schermata o ricaricare per verificare l'esito dell'operazione.

## 13. Export dati ed eliminazione account
- **Esportazione CSV (`src/lib/export.ts`):**
  - La funzione `Exporter.exportToCSV` genera due file CSV formattati con byte order mark UTF-8 (`\uFEFF`) per garantire la compatibilità immediata con Microsoft Excel su Windows e Mac: `allenamenti.csv` (con dettaglio serie, dropset e isometrie) e `misurazioni.csv` (peso, calorie, macro e circonferenze corporee).
  - Ogni nuova metrica o misurazione biometrica aggiunta all'app deve essere mappata in `src/lib/export.ts`.
- **Eliminazione account e dati (`DB.deleteAccount`):**
  - Nella sezione Impostazioni ("Zona pericolosa"), l'eliminazione dell'account non si limita a pulire la cache locale, ma rimuove a cascata su Firestore le subcollection `history_months` e `nutrition_months`, il documento utente principale `users/{uid}` e infine cancella l'utente da Firebase Auth.

## 14. Git workflow & buone pratiche di sviluppo
- **Vietato teorizzare e proporre modifiche cieche:** Usa sempre `grep_search` e `view_file` in modo approfondito per ispezionare l'implementazione reale prima di toccare qualsiasi riga di codice. **Prima di proporre o aggiungere un elemento (es. un banner, un form o una logica), verifica rigorosamente in tutto il codebase che non sia già presente.**
- **Chiedere prima di presumere:** Se un requisito di design o una logica di business non è chiara, non tirare a indovinare: chiedi sempre chiarimenti.
- **Build e test obbligatori:** Prima di finalizzare qualsiasi modifica o proporre commit, esegui SEMPRE:
  - `npm test` (o `npm.cmd test`) per verificare che i test unitari e di integrazione passino.
  - `npm run build` (o `npm.cmd run build`) per assicurarti che TypeScript (`tsc --noEmit`) e Vite compilino senza errori o violazioni di tipo.
  - `npm run lint` (o `npm.cmd run lint`) con `oxlint` per assicurare l'assenza di violazioni stilistiche e sintattiche.
- **Igiene del repository:** File temporanei, note e file di istruzioni locali restano esclusi dal version control tramite `.gitignore`. Non inquinare i branch di produzione.

## 15. Delega operazioni meccaniche (Google AI Studio)
- **Regola:** Per la generazione di grossi dataset (liste di alimenti, esercizi, mappature, traduzioni estese) e operazioni di data entry puramente meccaniche, è vietato consumare token per la generazione in questa sessione.
- **Azione richiesta:** Trattare l'utente come un "sub-agente": consigliargli esplicitamente di usare Google AI Studio (dove possiede ampie risorse) e fornirgli direttamente il **Prompt da copiare e incollare** che costringa l'AI esterna a produrre il risultato nel formato esatto (es. JSON) richiesto dal nostro codice.

