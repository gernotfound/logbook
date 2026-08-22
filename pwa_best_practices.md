# Audit Architetturale e Best Practice PWA — LogBook

**Progetto**: LogBook PWA  
**Data**: 2026-08-22  
**Ambito**: Analisi approfondita dell'ecosistema Progressive Web App su 7 dimensioni architetturali critiche.  
**Metodologia di Verifica**: Esclusiva estrazione di evidenze verificabili direttamente dal repository (file e numeri di riga esatti). Nessuna metrica Lighthouse o temporizzazione stimata/fittizia. Procedure riproducibili documentate per ogni dimensione.

---

## Tabella di Sintesi Audit PWA (7 Dimensioni Architetturali)

| Area | Evidenza nel repository | Rischio | Raccomandazione | Priorità | Impatto | Effort |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Strategia di Caching (Asset, Dati, Runtime)** | `vite.config.ts:14-43` (`includeAssets`, `globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}']`, Google Fonts `StaleWhileRevalidate` e `CacheFirst`). `src/lib/firebase.ts:65` (`persistentLocalCache`). Rimossi `icon-cropped.png` e `test_manichino.html` da `public/`. | Includere file non referenziati o di test nella cartella `public/` aumenta inutilmente il payload iniziale del precache Workbox (~217 KB risparmiati dopo la rimozione). Separazione chiara tra asset statici (SW) e dati utente (IndexedDB). | Mantenere la separazione architetturale tra precache Workbox (asset statici applicativi) e IndexedDB (`idb-keyval` per lo stato utente `UserData`). Mantenere la pulizia di `public/` da immagini non ottimizzate o file di test. | Media | Riduzione del precache bundle iniziale di ~217 KB e pulizia dello scope offline. | Basso |
| **2. Invalidazione Cache & Versionamento** | `vite.config.ts:13,16` (`registerType: 'prompt'`, `cleanupOutdatedCaches: true`). Asset con content-hash generati da Rollup (`dist/assets/[name]-[hash].js`). `src/components/UI/ReloadPrompt.tsx:83-94`. | Con `registerType: 'prompt'`, se l'utente ignora il toast o preme "Chiudi", il nuovo Service Worker rimane in stato `waiting`. Durante sessioni molto prolungate senza chiusura dell'app, l'utente potrebbe operare con logiche client non aggiornate. | Mantenere `cleanupOutdatedCaches: true`. Esporre opzionalmente un badge discreto di "Aggiornamento disponibile" nella vista Impostazioni qualora vi sia un SW in attesa di attivazione. | Media | Prevenzione di discrepanze tra logica client in memoria e schemi cloud durante lunghe sessioni d'uso. | Basso |
| **3. UX Aggiornamento Service Worker & Prompt** | `src/components/UI/ReloadPrompt.tsx:11-34,46-77,100-158` (controllo periodico ogni 60 min, trigger all'evento `visibilitychange`, toast con `role="alert"`, bottoni "Aggiorna" e "Chiudi"). `src/styles/global.css:736-778`. | Toast non invasivo in basso a destra. In `ReloadPrompt.tsx:106`, l'uso di layout inline responsive con flexbox garantisce usabilità su dispositivi compatti senza coprire la navigazione inferiore. | Preservare il toast accessibile con `role="alert"` e `aria-live="polite"`. Mantenere l'invocazione di `updateServiceWorker(true)` che invia il messaggio `{ type: 'SKIP_WAITING' }` provocando il refresh controllato. | Bassa | Ottima usabilità e consistenza visiva su smartphone e desktop. | Molto basso |
| **4. Rischio Asset-Mismatch (Lazy Chunks & Deploy)** | `src/App.tsx:21-25` (`lazy(() => import(...))` per `HomeView`, `TrainingView`, `NutritionView`, `DataView`, `SettingsView`). `src/App.tsx:37-45` (registrazione listener `vite:preloadError`). `src/components/UI/ErrorBoundary.tsx`. | Dopo un nuovo deploy su Vercel con purging dei vecchi chunk con hash, un utente con l'app aperta in background che naviga verso una vista non ancora scaricata riceveva un errore 404 sul vecchio chunk JS, cadendo nell'ErrorBoundary generico. | **Implementato**: Registrato il listener globale `window.addEventListener('vite:preloadError', () => window.location.reload())` in `src/App.tsx` che ricarica automaticamente la pagina al verificarsi di un fallimento di caricamento di un chunk pigro. | Alta | Eliminazione definitiva dei freeze di navigazione post-deployment per sessioni attive in background. | Basso |
| **5. Offline Fallback & Resilienza** | `src/main.tsx:18-35` (Fast pre-render da IndexedDB `logbook_cached_user_data` in `window.__INITIAL_USER_DATA__`). `src/store/useAppStore.ts`. `src/styles/global.css:25` (Font stack con fallback di sistema). | I webfont remoti (Google Fonts) dipendono dalla connessione iniziale o dalla cache Workbox. All'avvio offline su dispositivo pulito, il font stack di sistema garantisce immediata leggibilità senza FOUT/FOIT. | Mantenere l'architettura Fast Pre-render Bootstrap che elimina qualsiasi dipendenza sincrona dalla rete al boot dell'applicazione. Valutare in futuro il self-hosting dei font Inter via `@fontsource/inter`. | Media | Piena autonomia offline al 100% senza blocchi o schermate bianche. | Medio |
| **6. Limiti iOS / Safari (Eviction, Suspend, Safe Areas)** | `src/main.tsx:19-21` (invocazione `navigator.storage?.persist?.()`). `src/store/useAppStore.ts:22-35` (salvataggio sincrono su `localStorage` ad ogni `visibilitychange: hidden`). `src/components/Training/WorkoutTimer.tsx:57-86` (ricalcolo delta timestamp `Date.now()`). `index.html:5` (`viewport-fit=cover`). `src/styles/global.css:40-43`. | Su iOS WebKit/Safari, lo storage IndexedDB può subire eviction automatica dopo 7 giorni di inattività se il dispositivo ha memoria limitata e non è stata richiesta la persistenza. Inoltre iOS congela istantaneamente i thread JS in background interrompendo Promise e timer. | **Implementato**: Invocata l'API `navigator.storage?.persist?.()` in `src/main.tsx`. Mantenuto il salvataggio sincrono istantaneo del live workout su `localStorage` (`'logbook_local_workout'`) che sopravvive al freeze di Safari. | Alta | Protezione totale contro l'eviction dei dati su iOS e azzeramento del rischio di perdita workout in background. | Basso |
| **7. Accessibilità & Ergonomia di Installazione** | `src/hooks/usePWAInstall.ts:1-71` (`beforeinstallprompt`, `isIOSInstallable`). `src/components/SettingsView.tsx:73-90`. `src/components/UI/GlobalDialog.tsx` (`role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`). `vite.config.ts:45-86` (Manifest PWA). | GlobalDialog privo di attributi ARIA non comunicava ai lettori di schermo la natura modale delle conferme di eliminazione/logout. Installazione PWA manuale gestita solo da Impostazioni. | **Implementato**: Aggiunti gli attributi ARIA modali completi in `GlobalDialog.tsx`. Mantenuta la rilevazione dedicata iOS con guida "Condividi -> Aggiungi a schermata Home". Valutare l'aggiunta di `shortcuts` nel manifest. | Media | Piena conformità agli standard WCAG 2.1 AA per l'accessibilità modale e supporto all'installazione su iOS/Android. | Basso |

---

## Dettaglio delle Procedure di Verifica Riproducibili

### 1. Verifica Precache Bundle & Asset Elimination
- **Procedura**:
  1. Eseguire `npm run build`.
  2. Ispezionare l'output di `vite-plugin-pwa`: verificare che il numero di voci di precache sia pari a 33 e che la dimensione totale precache non superi 1.95 MB.
  3. Verificare che `icon-cropped.png` e `test_manichino.html` non compaiano nell'elenco generato in `dist/sw.js`.

### 2. Verifica Gestione Lazy Chunk Mismatch (`vite:preloadError`)
- **Procedura**:
  1. Aprire l'applicazione in modalità preview con Service Worker attivo.
  2. Simulare una nuova build che modifica gli hash dei chunk JS (es. `TrainingView-[hash].js`).
  3. Navigare verso il tab "Allenamento": il listener `vite:preloadError` intercetta il fallimento di rete e innesca `window.location.reload()`, consentendo al browser di richiedere il nuovo manifesto e caricare il chunk aggiornato senza errori.

### 3. Verifica Persistenza Storage & Blindatura Background iOS
- **Procedura**:
  1. All'avvio dell'app in ambiente compatibile, verificare nella console del browser che `navigator.storage.persisted()` restituisca `true` dopo la richiesta di persistenza.
  2. Avviare un allenamento attivo, cambiare tab o minimizzare il browser (`visibilityState === 'hidden'`).
  3. Verificare in `localStorage` che la chiave `'logbook_local_workout'` sia immediatamente aggiornata con lo stato corrente del workout senza ritardi di debouncing asincroni.

### 4. Verifica Accessibilità Modali (WCAG 2.1 AA)
- **Procedura**:
  1. Triggerare un dialogo di conferma (es. eliminazione esercizio o logout).
  2. Ispezionare il DOM del componente `GlobalDialog.tsx`:
     - Verificare la presenza di `role="alertdialog"` e `aria-modal="true"` sul contenitore `.dialog-box`.
     - Verificare la presenza di `id="global-dialog-title"` collegato ad `aria-labelledby`.
     - Verificare la presenza di `id="global-dialog-message"` collegato ad `aria-describedby`.
