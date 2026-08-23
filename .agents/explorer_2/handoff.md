# Handoff Report — Explorer 2: AGENTS.md Vercel & Domain Security Analysis

## 1. Observation
1. **Exact occurrences in `AGENTS.md` (Total lines: 151):**
   - File path: `c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`
   - Line 79 (within Section 5):
     `79:   - Le chiavi Firebase Web sono pubbliche. Poiché il fail-fast fa crashare l'app in assenza delle variabili, è obbligatorio fornire un file \`.env.production\` (da committare nel repository) o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).`
     (Contains "GitHub Actions" at character position 180).
   - "deploy.yml": 0 occurrences in `AGENTS.md`.
   - "GitHub Pages": 0 occurrences in `AGENTS.md`.
   - "/logbook/": 0 occurrences in `AGENTS.md`.
   - Line 143: `## 14. Git workflow & buone pratiche di sviluppo` (Generic git best practices, non-CI/CD specific).

2. **Base path verification in `vite.config.ts`:**
   - File path: `c:\Users\gerar\Documents\GitHub\logbook\vite.config.ts`, lines 5-6:
     `5: // Base path: set to '/' for Vercel or root domains.`
     `6: const basePath = '/'`
   - Base path is already configured to root `'/'`.

3. **Baseline test and build health:**
   - `npm.cmd test`: 30 test files passed (543 passed, 0 failed).
   - `npm.cmd run build`: Built client environment in 1.38s (0 errors).
   - `npm.cmd run lint`: 0 errors (25 warnings in test files, 0 errors).

---

## 2. Logic Chain
1. **Observation 1 $\rightarrow$ Scope Definition:** The only obsolete deployment reference in `AGENTS.md` is at line 79 ("es. GitHub Actions"). Replacing this sentence with Vercel environment variables and continuous deployment guidelines will completely eradicate obsolete CI/CD terms.
2. **Observation 1 & 2 $\rightarrow$ Architectural Alignment:** The project is configured with `base: '/'` in `vite.config.ts` specifically for Vercel root deployments without subpaths. Documenting root path `/` and automated push deployments in Section 5 (and Section 1) aligns the documentation with the code reality.
3. **Requirement R3 $\rightarrow$ Domain Authorization Architecture:** When an application is deployed to Vercel (e.g. `*.vercel.app`), Firebase Authentication and Google Identity Toolkit require two authorization mechanisms:
   - Firebase Auth requires adding the domain to "Authorized domains" to prevent `auth/unauthorized-domain`.
   - Google Cloud Credentials requires adding the wildcard referrer `*nome.vercel.app/*` to the "Browser key" API restrictions to prevent HTTP `403 Forbidden` errors.
4. **Style Constraint $\rightarrow$ Sentence Case Verification:** Applying Italian Sentence Case ensures that headings (`## 5. Vincoli Firebase, hosting Vercel e sicurezza domini`) and item labels (`**Hosting su Vercel e accesso statico alle variabili d'ambiente:**`, `**Checklist obbligatoria di sicurezza e autorizzazione domini (Prevenzione errori 403 e Auth):**`) maintain consistent typography throughout `AGENTS.md`.

---

## 3. Caveats
- No other files in the repository contain legacy `.github/workflows/deploy.yml` files (confirmed 0 occurrences).
- The analysis is strictly read-only and provides ready-to-apply diffs in `analysis.md` without modifying `AGENTS.md` directly.

---

## 4. Conclusion
The comprehensive analysis of `AGENTS.md` is complete. The exact location of the single legacy reference ("GitHub Actions" at line 79) has been mapped. The proposed text replacements for Section 1 and Section 5 fully incorporate Vercel hosting, root path `/` routing, zero workflow file maintenance, and the mandatory 2-step security checklist for Firebase Authentication Authorized Domains and Google Cloud Credentials HTTP referrers (`*nome.vercel.app/*`), strictly written in Italian Sentence Case.

---

## 5. Verification Method
1. **Inspect report files:**
   - Analysis: `c:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_2\analysis.md`
   - Handoff: `c:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_2\handoff.md`
2. **Check string absence and presence in proposed diff:**
   - In proposed text: "GitHub Actions", "deploy.yml", "GitHub Pages" = 0 occurrences.
   - In proposed text: "Vercel", "Authorized domains", "*nome.vercel.app/*", "Browser key", "HTTP referrers" = present.
3. **Project validation command execution:**
   - `npm.cmd test`
   - `npm.cmd run build`
   - `npm.cmd run lint`
