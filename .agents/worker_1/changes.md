# Implementation Changes: AGENTS.md Architecture & Deployment Update

## Target File
- `c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`

## Summary of Changes
1. **Section 1 (`## 1. Stack tecnologico & strumenti`):**
   - Added entry for Vercel hosting & deployment: `- **Hosting & deployment:** Vercel (deploy automatico a ogni \`git push\`, servito sulla radice \`/\` del dominio, zero-config CI/CD).`
   - Updated PWA entry to document `@vercel/analytics` and `@vercel/speed-insights`: `- **PWA & monitoraggio:** \`vite-plugin-pwa\` per la gestione del service worker e del manifest; \`@vercel/analytics\` e \`@vercel/speed-insights\` per metriche real user.`

2. **Section 5 (`## 5. Vincoli Firebase, hosting Vercel e sicurezza domini`):**
   - Updated section title to include Vercel hosting and domain security: `## 5. Vincoli Firebase, hosting Vercel e sicurezza domini`.
   - Replaced legacy CI/CD header and removed explicit mention of `(es. GitHub Actions)`.
   - Documented environment variable management via `.env.production` or Vercel dashboard (*Project Settings* $\rightarrow$ *Environment Variables*).
   - Documented Vercel hosting architecture: official hosting on Vercel, continuous automated deploy on every `git push` to main branch, zero-config CI/CD, running strictly on root domain (`/`), nested subpaths prohibited, and real user monitoring via `@vercel/analytics` and `@vercel/speed-insights`.
   - Added mandatory security checklist: `⚠️ CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI (Firebase Auth & Google Cloud API Key)` with:
     1. `Firebase Authentication (Authorized domains)`: Adding domain to Firebase console (*Authentication* $\rightarrow$ *Settings* $\rightarrow$ *Authorized domains*).
     2. `Google Cloud (Browser key / referrers)`: Adding domain with wildcard asterisk syntax (`*nome.vercel.app/*` / `*nome-app.vercel.app/*`) in HTTP referrers restrictions on Google Cloud Credentials Browser key to prevent 403 Forbidden errors.

3. **Style & Linguistic Integrity:**
   - Maintained strict Italian sentence case across all updated headers, bullet titles, and text, honoring Section 11 of `AGENTS.md`.

## Verification Results
- Zero forbidden strings (`GitHub Actions`, `deploy.yml`, `GitHub Pages`, `/logbook/`) confirmed by PowerShell `Select-String`.
- Positive presence of required terms (`Vercel`, `Firebase Authentication (Authorized domains)`, `Google Cloud (Browser key / referrers)`, wildcard syntax) confirmed.
- `npm test`: 30 test files passed, 543 tests passed.
- `npm run build`: Vite & TypeScript compilation succeeded with zero errors.
- `npm run lint`: `oxlint` completed with zero errors across 120 files.
