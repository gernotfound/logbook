# Analisi architetturale di AGENTS.md per hosting Vercel e sicurezza domini

## 1. Censimento occorrenze nel file `AGENTS.md`

È stata eseguita un'analisi esaustiva linea per linea (151 righe complessive) del file `c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`.

| Termine ricercato | Occorrenze | Righe esatte | Contesto e testo verbatim |
|---|:---:|:---:|---|
| **GitHub Actions** | **1** | **Riga 79** | `Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file \`.env.production\` (da committare nel repository) o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).` |
| **deploy.yml** | **0** | Nessuna | Nessuna occorrenza trovata nel file `AGENTS.md`. (Né presente nella directory `.github/`). |
| **GitHub Pages** | **0** | Nessuna | Nessuna occorrenza trovata nel file `AGENTS.md`. |
| **/logbook/** | **0** | Nessuna | Nessuna occorrenza trovata in `AGENTS.md`. In `vite.config.ts` alla riga 6 il `basePath` è già configurato a `'/'` con commento `// Base path: set to '/' for Vercel or root domains.`. |
| **Altre menzioni Git/GitHub** | 1 | Riga 143 | `## 14. Git workflow & buone pratiche di sviluppo` (Riferimento generico a Git e buone pratiche di sviluppo, non legato a deploy obsoleto). |

---

## 2. Analisi delle sezioni impattate e proposta di aggiornamento

### Sezione 1: `## 1. Stack tecnologico & strumenti` (Integrazione hosting)
Per soddisfare pienamente l'Acceptance Criteria 2 ("Il file AGENTS.md contiene il nome Vercel come piattaforma ufficiale di hosting"), si propone di esplicitare la voce Vercel nello stack tecnologico della Sezione 1.

#### Proposta di integrazione (Sezione 1):
```markdown
- **Hosting & deploy:** Vercel (deploy continuo automatico a ogni `git push` sulla radice `/`).
```

---

### Sezione 5: `## 5. Vincoli Firebase (WriteBatch, Null e Fail-Fast Config)`
La Sezione 5 è il blocco principale in cui rimuovere il riferimento a GitHub Actions, documentare l'hosting Vercel (deploy automatico, nessun file workflow, root path `/`) e integrare la checklist obbligatoria di sicurezza e autorizzazione domini.

#### Testo attuale (Righe 75-83):
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

#### Testo proposto in sostituzione (Conforme a Italian Sentence Case):
```markdown
## 5. Vincoli Firebase, hosting Vercel e sicurezza domini
- **Sicurezza configurazione Firebase & fail-fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
- **Hosting su Vercel e accesso statico alle variabili d'ambiente:** 
  - L'applicazione è ospitata ufficialmente su **Vercel**, con distribuzione automatica (*continuous deployment*) a ogni `git push` sul branch principale. Non è richiesto alcun file di workflow dedicato.
  - L'app viene servita direttamente sulla radice del dominio (base path `/` in `vite.config.ts`), garantendo il corretto routing client-side e il funzionamento ottimale del service worker PWA e del manifest.
  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la compilazione (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
  - Le chiavi Firebase Web sono pubbliche per natura client-side. Poiché il fail-fast blocca l'avvio dell'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (committato nel repository) oppure configurare le variabili d'ambiente direttamente nella dashboard di Vercel (*Settings > Environment Variables*), altrimenti la build produrrà una schermata nera all'avvio (crash a runtime).
- **Checklist obbligatoria di sicurezza e autorizzazione domini (Prevenzione errori 403 e Auth):**
  Qualsiasi modifica, aggiunta di dominio o nuovo sottodominio di anteprima (es. anteprime o produzione su Vercel come `*nome.vercel.app/*`) richiede tassativamente il completamento dei seguenti due passaggi di configurazione:
  1. **Firebase Authentication (Authorized domains):** Aggiungere il nuovo dominio nella sezione *Authentication > Settings > Authorized domains* della console Firebase (es. `nome.vercel.app`). Senza questa voce, i tentativi di accesso con Google Auth o provider federati falliscono con errore `auth/unauthorized-domain`.
  2. **Google Cloud Credentials (Browser key e referrers HTTP):** Accedere a Google Cloud Console (*APIs & Services > Credentials*) e selezionare la chiave API pubblica client (*Browser key*). Nella sezione delle restrizioni per siti web (*HTTP referrers*), aggiungere il pattern con sintassi wildcard (es. `*nome.vercel.app/*`). L'assenza del pattern con asterisco blocca le chiamate API verso Identity Toolkit e Firebase Authentication, provocando errori bloccanti `403 Forbidden`.
- **Prevenzione valori undefined in Firestore:** Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite. Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
- **Conformità schemi difensivi:** Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.
```

---

## 3. Verifica di conformità stilistica (Italian Sentence Case)

Tutti i testi proposti sono stati verificati rispetto alla regola di stile della Sezione 11 di `AGENTS.md` ("*Solo ed esclusivamente la primissima lettera della frase va in maiuscolo*. Le parole successive sono minuscole, salvo nomi propri, sigle o marchi"):
- Titoli e intestazioni:
  - `## 5. Vincoli Firebase, hosting Vercel e sicurezza domini` $\rightarrow$ "Vincoli" (iniziale maiuscola), "Firebase" e "Vercel" (nomi propri), restante in minuscolo.
- Elenchi puntati:
  - `**Sicurezza configurazione Firebase & fail-fast:**` $\rightarrow$ Iniziale maiuscola, "Firebase" nome proprio, restante in minuscolo.
  - `**Hosting su Vercel e accesso statico alle variabili d'ambiente:**` $\rightarrow$ Iniziale maiuscola, "Vercel" nome proprio, restante in minuscolo.
  - `**Checklist obbligatoria di sicurezza e autorizzazione domini (Prevenzione errori 403 e Auth):**` $\rightarrow$ Iniziale maiuscola, "Prevenzione" (iniziale parentesi), "Auth" (nome prodotto), restante in minuscolo.
  - `**Prevenzione valori undefined in Firestore:**` $\rightarrow$ Iniziale maiuscola, "Firestore" nome proprio, restante in minuscolo.
  - `**Conformità schemi difensivi:**` $\rightarrow$ Iniziale maiuscola, restante in minuscolo.
- Punti della checklist:
  - `1. **Firebase Authentication (Authorized domains):**`
  - `2. **Google Cloud Credentials (Browser key e referrers HTTP):**`

---

## 4. Diff unificato pronto per l'applicazione

```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -15,6 +15,7 @@
 - **PWA:** `vite-plugin-pwa` per la gestione del service worker e del manifest.
+- **Hosting & deploy:** Vercel (deploy continuo automatico a ogni `git push` sulla radice `/`).
 - **Librerie di supporto:** `date-fns` per date e intervalli temporali, `fast-deep-equal` per il diffing delle scritture Firestore, `chart.js` & `react-chartjs-2` per i grafici, `fuse.js` per la ricerca fuzzy.
 - **Testing & quality:** `vitest` (`@testing-library/react`, `jsdom`) e `oxlint`.
 
-## 5. Vincoli Firebase (WriteBatch, Null e Fail-Fast Config)
-- **Sicurezza configurazione Firebase & Fail-Fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
-- **Vite Static Access & CI/CD (Prevenzione Crash di Build):** 
-  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la build (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
-  - Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (da committare nel repository) o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).
-- Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite.
-- Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
-- Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.
+## 5. Vincoli Firebase, hosting Vercel e sicurezza domini
+- **Sicurezza configurazione Firebase & fail-fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
+- **Hosting su Vercel e accesso statico alle variabili d'ambiente:** 
+  - L'applicazione è ospitata ufficialmente su **Vercel**, con distribuzione automatica (*continuous deployment*) a ogni `git push` sul branch principale. Non è richiesto alcun file di workflow dedicato.
+  - L'app viene servita direttamente sulla radice del dominio (base path `/` in `vite.config.ts`), garantendo il corretto routing client-side e il funzionamento ottimale del service worker PWA e del manifest.
+  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la compilazione (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
+  - Le chiavi Firebase Web sono pubbliche per natura client-side. Poiché il fail-fast blocca l'avvio dell'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (committato nel repository) oppure configurare le variabili d'ambiente direttamente nella dashboard di Vercel (*Settings > Environment Variables*), altrimenti la build produrrà una schermata nera all'avvio (crash a runtime).
+- **Checklist obbligatoria di sicurezza e autorizzazione domini (Prevenzione errori 403 e Auth):**
+  Qualsiasi modifica, aggiunta di dominio o nuovo sottodominio di anteprima (es. anteprime o produzione su Vercel come `*nome.vercel.app/*`) richiede tassativamente il completamento dei seguenti due passaggi di configurazione:
+  1. **Firebase Authentication (Authorized domains):** Aggiungere il nuovo dominio nella sezione *Authentication > Settings > Authorized domains* della console Firebase (es. `nome.vercel.app`). Senza questa voce, i tentativi di accesso con Google Auth o provider federati falliscono con errore `auth/unauthorized-domain`.
+  2. **Google Cloud Credentials (Browser key e referrers HTTP):** Accedere a Google Cloud Console (*APIs & Services > Credentials*) e selezionare la chiave API pubblica client (*Browser key*). Nella sezione delle restrizioni per siti web (*HTTP referrers*), aggiungere il pattern con sintassi wildcard (es. `*nome.vercel.app/*`). L'assenza del pattern con asterisco blocca le chiamate API verso Identity Toolkit e Firebase Authentication, provocando errori bloccanti `403 Forbidden`.
+- **Prevenzione valori undefined in Firestore:** Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite. Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
+- **Conformità schemi difensivi:** Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.
```
