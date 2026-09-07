# Regole di progetto, architettura e linee guida per AI (LogBook)

Questo file Ã¨ la "Bibbia" architetturale dell'app **LogBook**. Ogni sessione AI deve leggere, assimilare e rispettare *rigorosamente* questo documento prima di scrivere una sola riga di codice.

---

## 1. Stack tecnologico & strumenti
- **Core:** React 19 (`react`, `react-dom` ^19.2), TypeScript, Vite.
- **Hosting & deployment:** Vercel (deploy automatico a ogni `git push`, servito sulla radice `/` del dominio). I rilasci in produzione sono protetti dai **Vercel Deployment Checks**, che bloccano il deploy se i workflow di GitHub Actions (Unit/E2E tests) falliscono.
- **State management:** Zustand 5 (Store globale centralizzato in `src/store/useAppStore.ts`).
- **Validazione runtime & sanitizzazione:** Zod (Gateway obbligatorio in `src/lib/schema.ts`).
- **Persistenza & storage ibrido:** IndexedDB (`idb-keyval`) per la cache globale persistente; `localStorage` sincrono per il workout attivo (`logbook_local_workout`), modalitÃ  guest (`logbook_is_guest`) e stati volatili (tab/timer/draft).
- **Backend & database:** Firebase Modular SDK v12 (`firebase/firestore`, `firebase/auth`). Configurazione rigorosamente da variabili d'ambiente `VITE_FIREBASE_*` con fail-fast immediato e divieto assoluto di credenziali hardcoded.
- **Styling:** CSS nativo (Vanilla CSS) basato su variabili (CSS custom properties in `src/styles/global.css`). Assolutamente **NO Tailwind** o framework CSS esterni.
- **Iconografia:** `lucide-react` (usare proporzioni coerenti, di norma `size={24}` o `size={20}`).
- **PWA & monitoraggio:** `vite-plugin-pwa` per la gestione del service worker e del manifest; `@vercel/analytics` e `@vercel/speed-insights` per metriche real user.
- **Librerie di supporto:** `date-fns` per date e intervalli temporali, `fast-deep-equal` per il diffing delle scritture Firestore, `chart.js` & `react-chartjs-2` per i grafici (stack grafico ufficiale basato su HTML5 Canvas 2D per rendering ad alte prestazioni, compatibilitÃ  garantita con React 19, Vite e ottimizzato a 60fps per dispositivi mobili iOS/PWA), `fuse.js` per la ricerca fuzzy.
- **Testing & quality:** `vitest` (`@testing-library/react`, `jsdom`) per unit/integration, Playwright per E2E, `oxlint` per il linting e **Snyk** per la sicurezza e la scansione del codice.

## 2. Architettura di rete e storage ibrido (3-Tier Storage & Offline-First)
- **Architettura a 3 livelli (Storage tiering):**
  1. **Tier 1 (Cloud - Firestore):** Persistenza remota su Firebase Firestore con subcollection mensilizzate (`history_months/{YYYY-MM}` e `nutrition_months/{YYYY-MM}`).
  2. **Tier 2 (Global async cache - IndexedDB `idb-keyval`):** Memorizza l'intero albero di stato `UserData` (chiave `'logbook_cached_user_data'`). Supera la quota rigida di 5MB di `localStorage`, prevenendo eccezioni `QuotaExceededError`.
  3. **Tier 3 (Sync local volatile - `localStorage`):** Riservato esclusivamente ai dati che richiedono persistenza sincrona istantanea (`'logbook_local_workout'`, `'logbook_is_guest'`, tab correnti `'logbook_activeTab'`, stati dei timer e bozze locali).
     - **LocalStorage Parse Strictness (`useLocalStorage.ts`):** Divieto assoluto di accettare o restituire plain string o dati non validati se `JSON.parse` o lo schema Zod falliscono. L'hook `useLocalStorage` supporta la validazione opzionale tramite Zod (`schema.safeParse`). Se il valore in `localStorage` genera un errore di parsing o non rispetta lo schema, l'hook deve loggare l'errore e restituire tassativamente `initialValue`. Tutte le scritture su `localStorage` devono essere serializzate con `JSON.stringify()`.
- **Fast pre-render bootstrap (`src/main.tsx` $\rightarrow$ `window.__INITIAL_USER_DATA__`):**
  - All'avvio dell'app (`initApp` in `src/main.tsx`), prima della chiamata `createRoot().render()`, la cache utente globale viene recuperata in modo asincrono da IndexedDB e assegnata a `window.__INITIAL_USER_DATA__`.
  - Lo store Zustand `useAppStore` viene inizializzato immediatamente tramite `getInitialUserData()`, validando la cache con `UserDataSchema.parse()`.
  - **PerchÃ© Ã¨ cruciale?** Elimina qualsiasi race condition con il ciclo di vita React e `AuthContext`:
    - Impedisce il flash di schermate vuote o overlay di sincronizzazione spuri (`setSyncing(true)` / `#sync-overlay`) all'avvio in modalitÃ  offline o su connessioni lente.
    - Evita la cancellazione distruttiva dei dati in modalitÃ  Guest: previene che `loginAsGuest()` veda `userData` come `null` e lo sovrascriva con lo stato vuoto `defaultUserData`.
    - Evita la perdita dei dati locali durante il collegamento dell'account Google (`linkGoogleAccount`).
- **ModalitÃ  cloud & merge dei dati (Deterministic Guest Merge):**
  - Al login con Google, il listener `onAuthStateChanged` in `src/contexts/AuthContext.tsx` recupera i dati da Firestore tramite `DB.loadUserData()`.
  - Se un utente guest effettua il login o collega un account Google, i suoi dati locali vengono fusi con quelli del cloud tramite un **merge deterministico per collezione**:
    - Ãˆ tassativamente vietato usare uno spread superficiale cieco (`...cloudData, ...guestData`) che sovrascriverebbe e cancellerebbe collezioni cloud.
    - Array con ID (`library`, `routines`, `customFoods`, `trainingCycles`, `history`, `supplements`): unione deduplicata per `id`, dando prioritÃ  alle modifiche locali (guest) in caso di collisione di ID.
    - Record per data `nutrition` (`Record<string, NutritionDay>`): unione delle date (`YYYY-MM-DD`), e per le date coincidenti merge deduplicato dei sotto-array `meals` (per `m.id`) e `supplementsIntake` (per `si.id`).
    - Campi scalari (`profile`, `nutritionPlanning`, `activeWorkout`, `activeCycleId`): prioritÃ  ai dati guest se valorizzati/non-vuoti, altrimenti dati cloud.
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
  5. **Gestione rigorosa delle Promise (Nessun successo silenzioso):** Le funzioni `saveUserData` e `updateUserData` DEVONO rigettare la Promise restituita qualora `DB.saveUserData` sollevi un'eccezione o fallisca la persistenza. Ãˆ vietato risolvere silenziosamente (`resolve()`) nel `catch` o nel `finally` quando si verifica un errore. Lo store deve impostare `saveError` con il messaggio di errore e reimpostare `syncing: false` nel blocco `finally`.
  6. **Bucketing mensile Firestore & superamento del limite di 1MB:**
     - Documento principale `users/{uid}`: memorizza `profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements` (con controllo rigido `checkDocSize < 950KB`).
     - Subcollection `users/{uid}/history_months/{YYYY-MM}`: sessioni di allenamento raggruppate per mese.
     - Subcollection `users/{uid}/nutrition_months/{YYYY-MM}`: registrazioni nutrizionali giornaliere e misure per mese.
     - Le scritture e cancellazioni dei soli mesi effettivamente modificati vengono raggruppate in un `writeBatch(db)` atomico con timeout protettivo di 7000ms.
- **Invarianti non negoziabili per modifiche allo State:**
  Se si aggiunge una proprietÃ  a `UserData`, Ã¨ imperativo aggiornare simultaneamente:
  - `src/types.ts` (interfaccia)
  - `src/lib/schema.ts` (Gateway Zod e fallback difensivi)
  - `src/lib/db.ts` (`loadUserData` e `saveUserData` con diffing strutturale)
  - `src/contexts/AuthContext.tsx` (`defaultUserData`)
  - `firestore.rules` (whitelist delle chiavi root in `incomingData().keys().hasOnly([...])`),
    **solo quando viene modificato lo schema dei dati cloud-sincronizzati in
    `users/{uid}`**.
  - `tests/firestore_security_rules.test.ts` (lista di chiavi consentite e
    test di autorizzazione), quando cambia la whitelist Firestore.

  L’aggiunta di stato UI, temporaneo o solo locale non implica automaticamente
  una modifica alle Firestore Rules: prima classificare esplicitamente il dato
  come effimero, locale persistito, cloud-root oppure mensilizzato.

  Per ogni nuova chiave cloud-root verificare e, se necessario, aggiornare:
  `src/types.ts`, `src/lib/schema.ts`, `src/contexts/AuthContext.tsx`,
  `src/lib/db.ts`, `firestore.rules`, `tests/firestore_security_rules.test.ts`,
  logica di merge/import-export e controlli di dimensione del documento.
  *Violare questa invariante causerÃ  la perdita silenziosa dei dati al primo ciclo di salvataggio/caricamento a causa dello strip di Zod o del fast-deep-equal.*

## 4. Gestione delle date e dei timezone
- **Niente `toISOString` puro:** Le date di sistema, i log di allenamento e le registrazioni nutrizionali devono essere salvati nel fuso orario locale usando SEMPRE `Logic.getLocalDateString()` (es. `2026-08-14`).
- **PerchÃ©?** L'orario UTC sfasa la mezzanotte locale: un allenamento completato alle 00:30 verrebbe salvato nel giorno precedente se formattato in UTC puro.
- **Utility date:** Usare le utility in `src/lib/utils/date.ts` / `Logic` (`getLocalDateString`, `formatItalianDate`, `parseDateInput`, `calculateAge`, `formatTime`, `formatDuration`, `getCalendarMonthGrid`) e la libreria `date-fns` per la manipolazione di intervalli temporali e scadenze.

## 5. Vincoli Firebase, hosting Vercel e sicurezza domini
- **Sicurezza configurazione Firebase & fail-fast:** Ãˆ severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o Ã¨ vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
- **Vite static access & environment variables (Prevenzione crash di build):** 
  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la build (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
  - Le chiavi Firebase Web sono pubbliche per natura client-side. PoichÃ© il fail-fast fa crashare l'app in assenza delle variabili, Ã¨ obbligatorio fornire un file `.env.production` (da committare nel repository) oppure configurare le variabili d'ambiente direttamente nella dashboard di Vercel (*Project Settings* $\rightarrow$ *Environment Variables*), altrimenti la build andrÃ  a buon fine ma il sito in cloud si tradurrÃ  in una schermata nera (crash a runtime).
- **Hosting e deploy continuo su Vercel (Root base path):**
  - L'applicazione Ã¨ ospitata ufficialmente sulla piattaforma **Vercel**.
  - Il deploy è continuo e automatico a ogni `git push` sul branch principale. Tuttavia, **non è più zero-config**: Vercel attende tassativamente il completamento con successo dei workflow di GitHub Actions ("Unit and Integration Tests" e "Playwright E2E Tests") tramite la funzionalità **Deployment Checks** prima di promuovere la build a Production.
  - L'app gira tassativamente sulla radice (`/`) del dominio, come configurato in `vite.config.ts` (`base: '/'`). Ãˆ vietato l'utilizzo di subpath o prefissi URL annidati.
  - Il monitoraggio delle prestazioni e l'analisi degli utenti reali sono affidati ai pacchetti integrati `@vercel/analytics` e `@vercel/speed-insights`.
- **Invarianti non negoziabili per Sicurezza e Domini:**
  Se si cambia o si aggiunge un dominio di hosting (es. un nuovo sottodominio Vercel), Ã¨ TASSATIVO autorizzare il nuovo dominio in due punti: **Firebase Auth (Authorized domains)** e **Google Cloud Console (RESTrizioni Browser API Key)**. In caso contrario, le chiamate Firestore e l'autenticazione falliranno con errori 403 Forbidden o `auth/unauthorized-domain`.
- Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite.
- Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
- Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformitÃ : fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.

## 6. Anti-pattern React (Prevenzione freeze e loop di re-render)
- **Shallow equality killer:** MAI usare inizializzatori inline per array o oggetti vuoti all'interno dei selettori Zustand:
  - â�Œ `const dati = useAppStore(state => state.dati || [])` (Crea una nuova referenza a ogni render, generando loop infiniti).
  - âœ… `const EMPTY_ARRAY = [];` dichiarato fuori dal componente, e poi `useAppStore(state => state.dati || EMPTY_ARRAY)`.
- **Memoizzazione mirata nei componenti ad alta frequenza:** Nelle viste di allenamento attivo (`SessionExerciseCard.tsx`, `SessionSetRow.tsx`), utilizzare `React.memo` con comparatore personalizzato per evitare re-render a cascata dell'intera lista esercizi durante la digitazione rapida di carichi e ripetizioni.

## 7. UX Mobile, iOS e PWA constraints
- **Finestre modali `<dialog>` proibite per form ed editor:** Vietato usare finestre modali o `<dialog>` per form complessi di inserimento/modifica. Rompono lo scrolling su iOS e creano conflitti con le tastiere virtuali. Utilizzare espansioni a tendina ("accordion") o viste inline condizionali a tutto schermo (`if (isEditing) return <EditView />`).
- **Dialoghi globali di sistema (`useDialogStore` & `GlobalDialog.tsx`):** Per notifiche, alert e conferme di eliminazione/logout, NON usare mai i metodi bloccanti nativi `window.confirm()` o `window.alert()`. Usare tassativamente `useDialogStore.getState().showAlert(...)` e `useDialogStore.getState().showConfirm(...)` renderizzati dal componente `GlobalDialog.tsx`.
- **Prevenzione zoom Safari:** Qualsiasi `input`, `select` o `textarea` DEVE avere `font-size: 16px !important` nel CSS, per evitare lo zoom automatico e fastidioso di Safari su iOS.
- **CSS flexbox mobile:** Inserire sempre `min-width: 0` nei figli diretti di container `display: flex` per prevenire overflow orizzontale su schermi stretti.
- **Input numerici:** Nei form usare sempre `<input type="number" inputMode="decimal" onFocus={e => e.target.select()} />`. Permettere che il campo diventi una stringa vuota `""` se l'utente cancella tutto (non forzare il reset automatico a `0` durante la digitazione).
- **Keep-alive e scroll preservation:** In `App.tsx`, le viste principali preservano la posizione di scroll tramite il dizionario `tabScrollPositions`.
- **CompatibilitÃ  Cross-Device e Touch Target:** Assicurati sempre che l'interfaccia sia responsiva (usando media query dai 320px in su) e integra le aree sicure (es. `env(safe-area-inset-top)`) per prevenire tagli visivi da Notch/Dynamic Island o indicatori home. Applica sempre touch target di almeno 44x44px (o classi che lo garantiscano, come nel `global.css`) a bottoni, link e campi di input.
- **Menu Contestuali (Azioni secondarie):** Per le azioni su liste o card (es. Modifica, Duplica, Elimina), è **obbligatorio** utilizzare il componente `src/components/UI/ContextMenu.tsx` invece di bottoni inline orizzontali. Questo garantisce pulizia visiva su mobile e touch target adeguati. Assicurarsi di isolare sempre gli eventi di click (`stopPropagation`) per non attivare gli accordion sottostanti o navigazioni non volute.

## 8. Blindatura dello stato in background (Safari Suspend & Storage Ibrido)
- Se l'utente chiude il browser, spegne lo schermo o passa ad altra applicazione nel mezzo di un allenamento, il sistema operativo (in particolare iOS WebKit e Android PWA) puÃ² congelare o terminare all'istante il thread JavaScript, interrompendo qualsiasi Promise, microtask o timeout pendente.
- **Salvataggio sincrono istantaneo:** Il salvataggio del workout attivo (`localWorkout`) **deve rimanere tassativamente confinato a `localStorage` sincrono** con chiave `'logbook_local_workout'`.
  - **PerchÃ© `localStorage` e MAI IndexedDB per il live workout?** `localStorage.setItem()` Ã¨ un'operazione sincrona bloccante che il browser garantisce prima di congelare il processo. IndexedDB si basa su transazioni asincrone con callback/Promise che verrebbero abortite dall'OS prima del completamento.
- **Listener `visibilitychange` in `src/store/useAppStore.ts`:**
  - Quando `document.visibilityState === 'hidden'`, lo store intercetta l'evento ed esegue immediatamente `localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout))`, bypassando il debouncer locale di 300ms.
- **Protezione anti-sovrascrittura (Local workout shield):** In `useAppStore.setUserData`, un fetch proveniente dalla rete NON deve mai sovrascrivere il `localWorkout` attivo sul dispositivo locale: la copia in memoria locale Ã¨ la source of truth assoluta della sessione in corso.

## 9. Logica di allenamento (Routines, Cicli, Serie speciali e Timer)
- **Routines e training cycles:** Le **Routines** (schede) sono blueprint statici di esercizi; i **Training cycles** (cicli) definiscono la rotazione, la durata in settimane e la progressione.
- **Suggerimento della prossima scheda:** Il calcolo Ã¨ demandato a `getNextScheduledRoutine` in `src/lib/calc/planning.ts`, basato sul conteggio delle sessioni completate per il ciclo attivo (`completedSessions % routineCount`).
- **Serie speciali (Dropset e Isometrie):**
  - Le serie speciali NON si auto-propagano all'aggiunta di una nuova serie normale (per scelta dell'utente).
  - L'aggiunta manuale numera sequenzialmente le serie: `â†³ Dropset 1`, `â†³ Dropset 2`, `â†³ Isometria 1` (con durata in secondi).
- **Tipologie di tracciamento (`trackingType`):** Supporto per `weight_reps` (peso e ripetizioni), `time` (tempo in secondi e carico opzionale) e `cardio` (durata, distanza, calcolo automatico velocitÃ  `dist / (time / 60)`, inclinazione e calorie).
- **Cronometri e timer di recupero (`WorkoutTimer.tsx`):**
  - MAI usare `setInterval` puro per il conteggio del tempo (subisce forte throttling o congelamento in background).
  - Si memorizza il timestamp iniziale `Date.now()` in `localStorage` (`logbook_timer_start`, `logbook_timer_state`, `logbook_timer_accumulated`) e si ricalcola il delta a ogni tick visivo e al ritorno dal background tramite `visibilitychange`.

## 10. Design system (Dark Glassmorphism)
- Il tema Ã¨ profondo, minimale e governato centralmente da `src/styles/global.css`.
- **Variabili CSS principali:**
  - Sfondi: `--bg-color: #000000;`, `--surface-color: #0d0d0d;`, `--surface-light: #1a1a1a;`
  - Accenti: `--primary-color: #00e5ff;`, `--primary-glow: rgba(0, 229, 255, 0.3);`, `--accent-color: #cc00ff;`
  - Feedback: `--danger-color: #ff4d6d;`, `--warning-color: #ffb703;`, `--success-color: #2ecc71;`
  - Trasparenze in vetro: `--glass-bg: rgba(13, 13, 13, 0.85);`, `--glass-border: rgba(255, 255, 255, 0.1);`
  - Testi: `--text-main: #f0f0f0;`, `--text-muted: #9ba3af;`
- **Classi e prefissi standard:** `.card`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-small`, `.btn-icon`, `.form-group`, `.input-row`, `.spinner`.
- **Tipografia e dimensioni (Best Practice):**
  - Usare sempre le classi di utilità globali per i testi (`.text-xs`, `.text-sm`, `.text-md`, `.text-base`, `.text-lg`, `.text-xl`) definite in `global.css`.
  - Non usare *mai* stili inline (`style={{ fontSize: '...' }}`) a meno di eccezioni dinamiche imprescindibili.
  - Usare sempre l'unità `rem` e mai `px` per scalare con le preferenze di accessibilità del sistema operativo.
  - Affidarsi ai tag semantici (`<h1>`, `<h2>`, `<h3>`, `<h4>`) per i titoli, che hanno già le loro dimensioni standardizzate in `global.css`.
  - *Unica eccezione:* I campi `<input>`, `<select>` e `<textarea>` devono tassativamente mantenere `font-size: 16px !important` (già gestito a livello globale) per prevenire lo zoom automatico e distruttivo su iOS Safari.
- **Regola di consistenza:** Quando aggiungi un elemento di UI, assicurati che rispetti la densità, il contrasto e il feeling premium del tema dark glassmorphism.

## 11. Stile testuale (Sentence case italiano)
- Ogni testo rivolto all'utente (label, bottoni, placeholder, alert, titoli di sezione) DEVE rispettare rigorosamente la convenzione italiana del **Sentence case**: *Solo ed esclusivamente la primissima lettera della frase va in maiuscolo*. Le parole successive sono minuscole, salvo nomi propri, sigle o marchi.
- â�Œ **Sbagliato (Title case):** "Nuova Misurazione Corporea", "Salva Modifiche Scheda", "Dati Biometrici", "Aggiungi Esercizio".
- âœ… **Corretto:** "Nuova misurazione corporea", "Salva modifiche scheda", "Dati biometrici", "Aggiungi esercizio".

## 12. Feedback immediato e mental model
- Nessuna azione deve essere "cieca". Se l'utente preme un pulsante (es. "Aggiungi", "Salva", "Elimina"), deve esserci un riscontro visivo istantaneo (aggiornamento ottimistico, comparsa di un toast, svuotamento dell'input, progress bar) *nella stessa schermata in cui si trova*. Non costringere l'utente a cambiare schermata o ricaricare per verificare l'esito dell'operazione.

## 13. Export dati ed eliminazione account
- **Esportazione CSV (`src/lib/export.ts`):**
  - La funzione `Exporter.exportToCSV` genera due file CSV formattati con byte order mark UTF-8 (`\uFEFF`) per garantire la compatibilitÃ  immediata con Microsoft Excel su Windows e Mac: `allenamenti.csv` (con dettaglio serie, dropset e isometrie) e `misurazioni.csv` (peso, calorie, macro e circonferenze corporee).
  - Ogni nuova metrica o misurazione biometrica aggiunta all'app deve essere mappata in `src/lib/export.ts`.
- **Eliminazione account e dati (`DB.deleteAccount`):**
  - Nella sezione Impostazioni ("Zona pericolosa"), l'eliminazione dell'account non si limita a pulire la cache locale, ma rimuove a cascata su Firestore le subcollection `history_months` e `nutrition_months`, il documento utente principale `users/{uid}` e infine cancella l'utente da Firebase Auth.

## 14. Git workflow & buone pratiche di sviluppo
- **Vietato teorizzare e proporre modifiche cieche:** Usa sempre `grep_search` e `view_file` in modo approfondito per ispezionare l'implementazione reale prima di toccare qualsiasi riga di codice. **Prima di proporre o aggiungere un elemento (es. un banner, un form o una logica), verifica rigorosamente in tutto il codebase che non sia giÃ  presente.**
- **Chiedere prima di presumere:** Se un requisito di design o una logica di business non Ã¨ chiara, non tirare a indovinare: chiedi sempre chiarimenti.
- **Commenti e contesto nel codice (Il "Perché"):** Quando scrivi o modifichi del codice, inserisci sempre delle note o commenti che spieghino *il perché* hai inserito quel codice o scelto quell'approccio. In questo modo, quando l'IA o un altro sviluppatore leggerà quella parte di codice in futuro, avrà immediatamente a disposizione tutto il contesto decisionale.
- **Invarianti non negoziabili per Commit/Push:** Ogni modifica deve passare silenziosamente `npm run test`, `npm run build` e `npm run lint`. Mai committare codice con fallimenti, warning o errori di tipizzazione.
- **Igiene del repository:** File temporanei, note e file di istruzioni locali restano esclusi dal version control tramite `.gitignore`. Non inquinare i branch di produzione.

## 15. Delega operazioni meccaniche e di ricerca (Perplexity Pro & Gemini Pro)
- **Regola:** L'utente possiede un abbonamento attivo a **Perplexity Pro** e **Google Gemini Pro**. Per operazioni puramente meccaniche (generazione di dataset, liste, formattazioni), per **ricerche estese** sul web o per **consulenze**, Ã¨ vietato consumare risorse in questa sessione.
- **Azione richiesta:** Invece di eseguire tu stesso il lavoro, delega il compito: fornisci all'utente il **Prompt esatto da copiare e incollare** su Perplexity o Gemini. Assicurati di includere nel prompt il contesto e le regole di formato (es. struttura JSON esatta, markdown specifico) affinchÃ© l'utente possa semplicemente farsi restituire il lavoro dall'AI esterna e passartelo pronto per l'integrazione.

## 16. Firebase App Check, Firestore Security Rules e Catalogo Globale (Infrastruttura operativa)

### 16a. Firebase App Check â€” reCAPTCHA Enterprise
- **Provider corretto:** L'app usa `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`). La chiave Ã¨ configurata tramite la variabile d'ambiente `VITE_RECAPTCHA_V3_SITE_KEY` (il nome Ã¨ storico, il provider Ã¨ Enterprise). La logica si trova in `src/lib/appCheck.ts`.
- **`isSupported` non esiste:** Il modulo `firebase/app-check` NON esporta `isSupported`. Usare il check manuale su `window.crypto` e `window.fetch` per verificare il supporto del browser.
- **Throttle iniziale (appCheck/initial-throttle):** Al primo caricamento del sito, Firebase App Check acquisisce il token reCAPTCHA con un breve ritardo. Durante questo intervallo, Firestore puÃ² rispondere `permission-denied`. Questo Ã¨ normale e atteso â€” i dati sono giÃ  al sicuro in IndexedDB. In `src/lib/db.ts`, l'errore `permission-denied` sul `batch.commit()` viene intercettato silenziosamente con un `console.warn` senza mai propagarlo all'utente.
- **Attivazione App Check:** La registrazione della chiave su Firebase App Check e Google Cloud deve essere sempre verde ("Registered"), altrimenti le richieste Firestore riceveranno `permission-denied`.

### 16b. Firestore Security Rules â€” Deploy obbligatorio
- **Il file `firestore.rules` non si applica da solo.** Modificare `firestore.rules` nel repository non ha alcun effetto su Firebase finchÃ© non viene eseguito esplicitamente il deploy. Firebase usa le proprie regole interne (di default: blocca tutto) fino al primo deploy.
- **Sintomo tipico se le regole non sono mai state deployate:** Tutti i tentativi di lettura/scrittura Firestore restituiscono `FirebaseError: Missing or insufficient permissions`, incluso il CatalogService che tenta di leggere `global_catalog/manifest`.
- **Come deployare le regole:**
  ```
  npx firebase-tools login          # autenticazione browser (una tantum per macchina)
  npx firebase-tools deploy --only firestore:rules
  ```
  I file `firebase.json` (punta a `firestore.rules`) e `.firebaserc` (progetto `logbook-db-98cc4`) sono giÃ  presenti nel repository e non vanno toccati.
- **Quando ri-deployare:** Ogni volta che si modifica `firestore.rules`. Non Ã¨ necessario un redeploy Vercel â€” le regole sono separate dall'app.
- **âš ï¸� Il file `service-account.json` Ã¨ nel `.gitignore` e NON va mai committato.** Contiene le credenziali admin del database. Va scaricato da Firebase Console (*Impostazioni progetto â†’ Account di servizio â†’ Genera nuova chiave privata*) e usato solo localmente per operazioni admin (seeding, script), poi eliminato.

### 16c. Catalogo Globale (`global_catalog`) â€” Seeding e Zod Invariants
- **Struttura Firestore:** La collezione `global_catalog` contiene tre documenti:
  - `manifest`: versione, data aggiornamento, `schemaVersion`, `docRefs` (punta ai documenti dati) e `itemCounts`.
  - `exercises_v1`: `{ items: [...] }` con tutti gli esercizi del catalogo.
  - `foods_v1`: `{ items: [...] }` con tutti gli alimenti del catalogo.
- **Regole Firestore:** `global_catalog` ha `allow read: if true` (pubblico in sola lettura) e `allow write: if false`.
- **Seed locali vuoti (`enforce manual input`):** I seed locali in `src/lib/catalog/seedExercises.json` e `src/lib/catalog/seedFoods.json` sono *intenzionalmente vuoti*. L'app impone l'inserimento manuale o il download dal cloud (per ridurre il bundle size).
- **Fallback offline (Array Vuoti):** Se `global_catalog/manifest` non Ã¨ raggiungibile, il `CatalogService` cade silenziosamente sul seed locale. Essendo quest'ultimo intenzionalmente vuoto, il fallback *restituisce array vuoti validi*, non un catalogo popolato. L'app non va in crash e i `customItems` dell'utente continuano a funzionare regolarmente.
- **Invariante Zod (Ghost Objects):** Il gateway Zod (`UserDataSchema`) applica una validazione severa per proteggere l'app da oggetti fantasma o serializzazioni rotte:
  - Scarta a monte (nel transformer) elementi nulli, primitivi o mancanti di un `id` valido (`id === ''`).
  - Se l'elemento ha un `id` valido ma altri campi sono corrotti (es. numero al posto di stringa), l'elemento *non viene scartato* ma sanitizzato con i valori di default, preservando la referenza vitale per logbook e cronologia.
- **ATTENZIONE su `seed-catalog.mjs`:** Non rieseguire MAI accidentalmente questo script! Dal momento che i JSON locali sono stati svuotati per la policy "enforce manual input", eseguire lo script andrebbe a sovrascrivere `global_catalog` su Firestore con array vuoti, distruggendo il database cloud di esercizi e alimenti per tutti gli utenti.

## 17. ModalitÃ  Pianificazione Rigorosa (Strict Planning Mode)
- **Regola vitale:** Dato che il progetto Ã¨ diventato grande e articolato, le modifiche dirette al codice possono avere effetti collaterali imprevisti su logiche complesse (es. Zod, IndexedDB, Firebase). Pertanto, quando l'utente propone una modifica, fa domande architetturali, o fornisce analisi provenienti da altre AI (es. Perplexity), Ã¨ **SEVERAMENTE VIETATO** scrivere o modificare codice sorgente in prima battuta.
- **Azione richiesta:** Devi **SEMPRE** redigere o aggiornare il file `implementation_plan.md` descrivendo in dettaglio le modifiche che intendi fare, file per file, e le potenziali ripercussioni. Successivamente devi fermarti e richiedere esplicitamente l'**approvazione** dell'utente.
- Solo dopo che l'utente ha letto e approvato il piano, potrai passare alla fase esecutiva e modificare i file. L'utente deve avere sempre l'ultima parola prima di ogni modifica strutturale.
  
## 18. Sicurezza HTTP, Logout e Tooling Bundle (PWA Hardening)
- **Sicurezza HTTP:** L'app usa header rigorosi (`Content-Security-Policy`, `X-Frame-Options`, `HSTS`, `Referrer-Policy`, `Permissions-Policy`) configurati in `vercel.json`. È **TASSATIVAMENTE VIETATO** rimuovere i domini Firebase (`*.firebaseapp.com`, `*.googleapis.com`, `*.firebaseio.com`) o Vercel dalla CSP, altrimenti si rompono Auth, Analytics e sincronizzazione Firestore.
- **Logica di Logout (Invariante Critica):** In `db.ts`, durante le procedure di disconnessione o eliminazione account, il sistema cancella rigorosamente `idb-keyval` (IndexedDB) e `localStorage` per garantire la privacy, specialmente in contesti guest condivisi. Tuttavia, è **TASSATIVAMENTE VIETATO** eliminare la cache del Service Worker (`caches.delete()`), in quanto contiene l'App Shell vitale per avviare l'app offline prima del login.
- **Tooling di Ispezione Bundle:** È installato `rollup-plugin-visualizer`. Qualsiasi operazione che comporti l'aggiunta di nuove dipendenze (`npm install`) DEVE essere seguita dall'esecuzione del comando `npm run analyze`. Questo genera il report `bundle-stats.html`. Se la nuova dipendenza supera la soglia di attenzione (es. >50 KB gzip), si deve avviare una review obbligatoria con l'utente per valutare alternative più leggere.
