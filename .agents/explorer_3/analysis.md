# Analysis & Verification Planning: AGENTS.md Architecture & Deployment Documentation

## 1. Overview & Problem Boundary
- **Objective**: Modernize the architectural bible `AGENTS.md` to reflect the current Vercel hosting platform, remove obsolete CI/CD (GitHub Actions, `deploy.yml`, GitHub Pages, `/logbook/` base path) references, and establish a mandatory security checklist for domain authorization across Firebase Authentication and Google Cloud Credentials.
- **Target File**: `c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`
- **Scope & Constraints**: 
  - Read-only investigation and planning (Worker will apply changes).
  - Strict compliance with `AGENTS.md` Rule 11 (Italian Sentence Case).
  - Full verification against the 4 acceptance criteria in `ORIGINAL_REQUEST.md` and `SCOPE.md`.

---

## 2. Forensic Inspection of `AGENTS.md`

### 2.1 Obsolete CI/CD & Deploy Mentions Identified
| Location in `AGENTS.md` | Exact Text / Pattern | Status / Action Required |
|---|---|---|
| Line 77 | `- **Vite Static Access & CI/CD (Prevenzione Crash di Build):**` | **Replace**: Obsolete header mentioning CI/CD. Update to reference Vite Static Access & Vercel hosting. |
| Line 79 | `...o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build...` | **Replace**: Explicit mention of `(es. GitHub Actions)`. Replace with Vercel Environment Variables configuration. |
| Whole document | Absence of "Vercel" hosting documentation | **Add**: Explicit documentation that Vercel is the official hosting platform, deploy is automatic on `git push`, no dedicated workflow file is needed, and app runs on root `/`. |
| Whole document | Absence of Domain Security Checklist | **Add**: Mandatory checklist ("⚠️ CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI") requiring Firebase Authentication (Authorized domains) and Google Cloud (Browser key / referrers) with wildcard asterisk syntax (`*nome.vercel.app/*`). |

### 2.2 Repository Context Verification
- `vite.config.ts`: Line 6 sets `const basePath = '/'` with comment `// Base path: set to '/' for Vercel or root domains.` and `base: basePath`.
- `.github/workflows/`: No workflow files exist in the repository; deployment is handled natively by Vercel on push.
- Test Suite (`vitest`): 30 test files / 543 tests all passing.
- Build (`tsc --noEmit && vite build`): Succeeded in 992ms.
- Linter (`oxlint`): 0 errors across 120 files.

---

## 3. Worker Implementation Plan

### 3.1 Edits in `AGENTS.md`

#### Edit 1: Update Section 1 (`## 1. Stack tecnologico & strumenti`)
Add explicit hosting technology entry:
```markdown
- **Hosting & deployment:** Vercel (deploy automatico a ogni `git push`, root base path `/`).
```

#### Edit 2: Update Section 5 Title & Content (`## 5. Vincoli Firebase...`)
Update the section header and content to integrate Vercel hosting rules and the mandatory security checklist:

**Target Section (Lines 75-83):**
```markdown
## 5. Vincoli Firebase & Hosting Vercel (WriteBatch, Null, Fail-Fast Config & Domini)
- **Sicurezza configurazione Firebase & Fail-Fast:** È severamente vietato inserire chiavi API, URL o ID di progetto Firebase hardcoded come valori di fallback nel codice sorgente (`src/lib/firebase.ts`). Tutte le 8 variabili d'ambiente `import.meta.env.VITE_FIREBASE_*` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`) DEVONO essere presenti e non vuote; se anche una sola variabile manca o è vuota, l'applicazione deve lanciare immediatamente un'eccezione bloccante (`Error`) prima dell'invocazione di `initializeApp`.
- **Vite Static Access & Hosting Vercel (Prevenzione Crash di Build):** 
  - Mai usare l'accesso dinamico con parentesi quadre (`import.meta.env[key]`) per iterare sulle variabili d'ambiente. Vite sostituisce le variabili in modo *statico* durante la build (`npm run build`); l'accesso dinamico fallisce e restituisce `undefined` in produzione, causando falsi positivi nel fail-fast. Usare sempre la notazione statica (`import.meta.env.VITE_...`).
  - Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file `.env.production` (da committare nel repository) o configurare le Environment Variables nel pannello di controllo di Vercel, altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).
- **Deploy su Vercel & Base Path:**
  - L'applicazione è ospitata ufficialmente su **Vercel**. Il deployment viene eseguito in maniera completamente automatica a ogni `git push` sul repository. Non è necessario alcun file di workflow dedicato.
  - L'applicazione viene servita sulla radice (`/`) del dominio, come configurato in `vite.config.ts` (`base: '/'`).
- **⚠️ CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI (Fail-Fast Domini & Prevenzione Errori 403):**
  Qualora venga modificato, aggiunto o collegato un nuovo dominio all'applicazione (es. domini generati da Vercel `*.vercel.app` o domini personalizzati), è OBBLIGATORIO eseguire tassativamente i seguenti due passaggi di sicurezza:
  1. **Firebase Authentication (Authorized domains):** Aggiungere il nuovo dominio nell'elenco "Authorized domains" della console Firebase (Authentication $\rightarrow$ Settings $\rightarrow$ Authorized domains) per abilitare i flussi di autenticazione e login.
  2. **Google Cloud (Browser key / referrers):** Aggiungere il dominio con sintassi wildcard (es. `*nome.vercel.app/*` o `https://*nome.vercel.app/*`) nelle restrizioni HTTP referrers della "Browser key" su Google Cloud Credentials (Google Cloud Console $\rightarrow$ API e servizi $\rightarrow$ Credenziali $\rightarrow$ Browser key), per prevenire errori 403 Forbidden durante le chiamate alle API Google.
- Firebase Firestore SDK rifiuta categoricamente qualsiasi valore `undefined` nell'albero JSON, sollevando eccezioni non gestite.
- Prima di serializzare e salvare lo stato, assicurarsi che i campi opzionali o svuotati siano esplicitamente convertiti a `null` oppure che la chiave venga omessa (`delete obj.key`).
- Gli schemi difensivi Zod e i mapping di `db.ts` devono garantire la conformità: fallback `activeWorkout: state.activeWorkout || null`, `activeCycleId: state.activeCycleId || null`, ecc.
```

---

## 4. Multi-Role Verification Matrix

| Role | Responsibility | Verification Tasks & Commands |
|---|---|---|
| **Worker** | Document Edit | Apply exact markdown edits to `AGENTS.md` without modifying any TypeScript/CSS source code files. |
| **Reviewer** | Syntax & Content Audit | 1. Grep for `GitHub Actions`, `deploy.yml`, `GitHub Pages` (ensure 0 matches).<br>2. Verify "Vercel" appears as official host.<br>3. Verify presence of "Firebase Authentication (Authorized domains)" and "Google Cloud (Browser key / referrers)" with wildcard asterisk example.<br>4. Check Sentence case compliance. |
| **Challenger** | Adversarial Verification | 1. Attempt edge-case searches (case variations, partial tokens).<br>2. Check for any broken links, unescaped markdown or missing checklist steps.<br>3. Run full test suite (`npm.cmd test`), build (`npm.cmd run build`), lint (`npm.cmd run lint`). |
| **Auditor** | Final Governance Sign-Off | Confirm all 4 acceptance criteria are strictly satisfied and no regressions occurred. |

---

## 5. Verification Commands for Handoff & Testing
```powershell
# 1. Zero forbidden strings check
Get-Content AGENTS.md | Select-String -Pattern "GitHub Actions|deploy\.yml|GitHub Pages"

# 2. Required terms check
Get-Content AGENTS.md | Select-String -Pattern "Vercel|Authorized domains|Browser key|referrers|\*.*\.vercel\.app/\*"

# 3. Project test suite
npm.cmd test

# 4. Project build
npm.cmd run build

# 5. Project lint
npm.cmd run lint
```
