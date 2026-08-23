# Analisi Tecnica Dettagliata: Revisione Architetturale `AGENTS.md` (Deploy Vercel & Sicurezza Domini)

**Data:** 2026-08-20  
**Autore:** Explorer 1  
**File Target:** `c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`  

---

## 1. Mappatura e Rilevamento dei Riferimenti Obsoleti (CI/CD Legacy)

Un'ispezione approfondita riga per riga di `AGENTS.md` (151 righe) e del repository ha prodotto i seguenti riscontri:

### 1.1 Riferimenti Trovati in `AGENTS.md`
- **Riga 79 (Sezione 5, `Vite Static Access & CI/CD`):**
  ```markdown
  - Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (da committare nel repository) o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).
  ```
  - **Criticità rilevata:** La presenza esplicita della dicitura `(es. GitHub Actions)` viola il requisito R1.

### 1.2 Riferimenti Verificati nel Resto del File
- `deploy.yml`: 0 occorrenze in `AGENTS.md`.
- `GitHub Pages`: 0 occorrenze in `AGENTS.md`.
- `/logbook/`: 0 occorrenze in `AGENTS.md`.
- `GitHub Actions`: 1 occorrenza (riga 79).

### 1.3 Stato del Codebase del Progetto
- `vite.config.ts` (righe 5–6, 9): Definisce `const basePath = '/'` e `base: basePath`, specificando nel commento `// Base path: set to '/' for Vercel or root domains.`.
- `package.json` (righe 14–15): Include le dipendenze ufficiali `@vercel/analytics: ^2.0.1` e `@vercel/speed-insights: ^2.0.0`.
- `src/App.tsx` (righe 13–14, 212–213): Monta regolarmente i componenti `<Analytics />` e `<SpeedInsights />`.
- Directory `.github/workflows/`: Nessun file presente nel repository (nessun `deploy.yml`).

---

## 2. Struttura di `AGENTS.md` e Integrazione di Vercel

`AGENTS.md` è organizzato in sezioni numerate (da `## 1.` a `## 14.`), con elenchi puntati strutturati e checklist marcate con icone di avviso (es. `- **⚠️ CHECKLIST OBBLIGATORIA IN 5 PASSAGGI PER NUOVE PROPRIETÀ:**` a riga 60).

Per integrare in modo armonioso e organico i requisiti R1, R2 e R3:

1. **Sezione 1 (`## 1. Stack tecnologico & strumenti`):**
   - Aggiungere Vercel tra gli strumenti di hosting/deployment:
     `- **Hosting & deployment:** Vercel (deploy continuo automatico a ogni \`git push\`, servito nativamente sulla radice \`/\` del dominio, zero-config CI/CD).`

2. **Sezione 5 (`## 5. Vincoli Firebase (WriteBatch, Null e Fail-Fast Config)`):**
   - Rinominare o mantenere il titolo aggiornandolo se opportuno: `## 5. Vincoli Firebase, hosting Vercel e sicurezza domini`.
   - Modificare il sottoparagrafo Vite/CI/CD (righe 77–79) eliminando `(es. GitHub Actions)` e menzionando le variabili d'ambiente in Vercel (*Project Settings* $\rightarrow$ *Environment Variables*).
   - Inserire il punto architetturale sul deployment Vercel:
     - Deploy automatico a ogni `git push` sul branch principale.
     - Nessun file di workflow CI/CD o configurazione dedicata (zero-config).
     - Esecuzione obbligatoria sulla radice (`/`) del dominio (`base: '/'` in `vite.config.ts`), vietando qualsiasi subpath legacy come `/logbook/`.
     - Tracciamento analitico con `@vercel/analytics` e `@vercel/speed-insights`.

---

## 3. Bozza della Checklist di Sicurezza e Domini (Sentence Case Italiano)

In ossequio al principio enunciato nella Sezione 11 di `AGENTS.md` (*"Solo ed esclusivamente la primissima lettera della frase va in maiuscolo. Le parole successive sono minuscole, salvo nomi propri, sigle o marchi"*), la checklist è stata redatta come segue:

```markdown
- **⚠️ CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI (Firebase Auth & Google Cloud API Key):**
  Qualsiasi modifica, aggiunta o migrazione del dominio dell'app (es. cambio dominio di produzione o nuovo sottodominio Vercel) impone tassativamente l'esecuzione immediata dei seguenti due passaggi di sicurezza per prevenire blocchi dell'autenticazione o errori 403 Forbidden:
  1. **Firebase Authentication (Authorized domains):** Aggiungere il nuovo dominio nella console Firebase (*Authentication* $\rightarrow$ *Settings* $\rightarrow$ *Authorized domains*, es. `nome-app.vercel.app`). Senza questo passaggio, il login con Google e le funzioni di autenticazione falliranno sollevando l'eccezione `auth/unauthorized-domain`.
  2. **Google Cloud Credentials (Browser key / HTTP referrers):** Aggiungere il dominio con sintassi wildcard (es. `*nome-app.vercel.app/*` oppure `https://*nome-app.vercel.app/*`) tra i referrer HTTP autorizzati nelle restrizioni della "Browser key" (chiave API web) nella Google Cloud Console (*APIs & Services* $\rightarrow$ *Credentials*). L'omissione o una sintassi non wildcard causerà errori 403 (Forbidden) su tutte le chiamate verso Identity Toolkit e Firestore.
```

---

## 4. Proposta di Modifica Dettagliata (Before vs After)

### 4.1 Modifica in Sezione 1 (`AGENTS.md` riga 7–18)

**Before:**
```markdown
## 1. Stack tecnologico & strumenti
- **Core:** React 19 (`react`, `react-dom` ^19.2), TypeScript, Vite.
- **State management:** Zustand 5 (Store globale centralizzato in `src/store/useAppStore.ts`).
- **Validazione runtime & sanitizzazione:** Zod (Gateway obbligatorio in `src/lib/schema.ts`).
- **Persistenza & storage ibrido:** IndexedDB (`idb-keyval`) per la cache globale persistente; `localStorage` sincrono per il workout attivo (`logbook_local_workout`), modalità guest (`logbook_is_guest`) e stati volatili (tab/timer/draft).
- **Backend & database:** Firebase Modular SDK v12 (`firebase/firestore`, `firebase/auth`). Configurazione rigorosamente da variabili d'ambiente `VITE_FIREBASE_*` con fail-fast immediato e divieto assoluto di credenziali hardcoded.
- **Styling:** CSS nativo (Vanilla CSS) basato su variabili (CSS custom properties in `src/styles/global.css`). Assolutamente **NO Tailwind** o framework CSS esterni.
- **Iconografia:** `lucide-react` (usare proporzioni coerenti, di norma `size={24}` o `size={20}`).
- **PWA:** `vite-plugin-pwa` per la gestione del service worker e del manifest.
- **Librerie di supporto:** `date-fns` per date e intervalli temporali, `fast-deep-equal` per il diffing delle scritture Firestore, `chart.js` & `react-chartjs-2` per i grafici, `fuse.js` per la ricerca fuzzy.
- **Testing & quality:** `vitest` (`@testing-library/react`, `jsdom`) e `oxlint`.
```

**After:**
```markdown
## 1. Stack tecnologico & strumenti
- **Core:** React 19 (`react`, `react-dom` ^19.2), TypeScript, Vite.
- **Hosting & deployment:** Vercel (deploy automatico a ogni `git push`, servito sulla radice `/` del dominio, zero-config CI/CD).
- **State management:** Zustand 5 (Store globale centralizzato in `src/store/useAppStore.ts`).
- **Validazione runtime & sanitizzazione:** Zod (Gateway obbligatorio in `src/lib/schema.ts`).
- **Persistenza & storage ibrido:** IndexedDB (`idb-keyval`) per la cache globale persistente; `localStorage` sincrono per il workout attivo (`logbook_local_workout`), modalità guest (`logbook_is_guest`) e stati volatili (tab/timer/draft).
- **Backend & database:** Firebase Modular SDK v12 (`firebase/firestore`, `firebase/auth`). Configurazione rigorosamente da variabili d'ambiente `VITE_FIREBASE_*` con fail-fast immediato e divieto assoluto di credenziali hardcoded.
- **Styling:** CSS nativo (Vanilla CSS) basato su variabili (CSS custom properties in `src/styles/global.css`). Assolutamente **NO Tailwind** o framework CSS esterni.
- **Iconografia:** `lucide-react` (usare proporzioni coerenti, di norma `size={24}` o `size={20}`).
- **PWA & monitoraggio:** `vite-plugin-pwa` per service worker e manifest; `@vercel/analytics` e `@vercel/speed-insights` per metriche real user.
- **Librerie di supporto:** `date-fns` per date e intervalli temporali, `fast-deep-equal` per il diffing delle scritture Firestore, `chart.js` & `react-chartjs-2` per i grafici, `fuse.js` per la ricerca fuzzy.
- **Testing & quality:** `vitest` (`@testing-library/react`, `jsdom`) e `oxlint`.
```

### 4.2 Modifica in Sezione 5 (`AGENTS.md` riga 75–83)

**Before:**
```markdown
## 5. Vincoli Firebase (WriteBatch, Null e Fail-Fast Config)
- **Sicurezza configurazione Firebase & Fail-Fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
- **Vite Static Access & CI/CD (Prevenzione Crash di Build):** 
  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la build (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
  - Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (da committare nel repository) o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).
- Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite.
- Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
- Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.
```

**After:**
```markdown
## 5. Vincoli Firebase, hosting Vercel e sicurezza domini
- **Sicurezza configurazione Firebase & Fail-Fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
- **Vite Static Access & Environment Variables (Prevenzione crash di build):** 
  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la build (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
  - Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (da committare nel repository) oppure configurare le variabili d'ambiente direttamente nella dashboard di Vercel (*Project Settings* $\rightarrow$ *Environment Variables*), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).
- **Hosting e deploy continuo su Vercel (Root base path):**
  - L'applicazione è ospitata ufficialmente sulla piattaforma **Vercel**.
  - Il deploy è continuo e automatico a ogni `git push` sul branch principale. Non è richiesto alcun file di workflow o pipeline di build dedicata (zero-config CI/CD).
  - L'app gira tassativamente sulla radice (`/`) del dominio, come configurato in `vite.config.ts` (`base: '/'`). È vietato l'utilizzo di subpath o prefissi URL (es. `/logbook/`).
  - Il monitoraggio delle prestazioni e l'analisi degli utenti reali sono affidati ai pacchetti integrati `@vercel/analytics` e `@vercel/speed-insights`.
- **⚠️ CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI (Firebase Auth & Google Cloud API Key):**
  Qualsiasi modifica, aggiunta o migrazione del dominio dell'app (es. cambio dominio di produzione o nuovo sottodominio Vercel) impone tassativamente l'esecuzione immediata dei seguenti due passaggi di sicurezza per prevenire blocchi dell'autenticazione o errori 403 Forbidden:
  1. **Firebase Authentication (Authorized domains):** Aggiungere il nuovo dominio nella console Firebase (*Authentication* $\rightarrow$ *Settings* $\rightarrow$ *Authorized domains*, es. `nome-app.vercel.app`). In caso contrario, il login con Google e le funzioni di autenticazione falliranno sollevando l'eccezione `auth/unauthorized-domain`.
  2. **Google Cloud Credentials (Browser key / HTTP referrers):** Aggiungere il dominio con sintassi wildcard (es. `*nome-app.vercel.app/*` oppure `https://*nome-app.vercel.app/*`) tra i referrer HTTP autorizzati nelle restrizioni della "Browser key" (chiave API web) nella Google Cloud Console (*APIs & Services* $\rightarrow$ *Credentials*). L'omissione o una sintassi non wildcard causerà errori 403 (Forbidden) su tutte le chiamate verso Identity Toolkit e Firestore.
- Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite.
- Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
- Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.
```

---

## 5. Esito Verifiche Tecniche di Progetto
- **`npm test`**: 30 file di test superati, 543 test passati (100% pass rate).
- **`npm run lint` (`oxlint`)**: 0 errori riscontrati.
- **`npm run build` (`tsc --noEmit && vite build`)**: Compilazione TypeScript e bundle Vite completati con codice di uscita 0.
