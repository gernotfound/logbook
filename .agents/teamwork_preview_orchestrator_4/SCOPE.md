# Scope: AGENTS.md Architecture & Deployment Documentation Update

## Architecture
- Target file: `AGENTS.md`
- Documentation update: Replace obsolete GitHub Pages / GitHub Actions / deploy.yml / /logbook/ base path documentation with Vercel deployment architecture and Firebase/Google Cloud domain authorization security checklist.

## Requirements
- **R1**: Rimuovere completamente da `AGENTS.md` ogni riferimento al precedente sistema di deploy (GitHub Actions, `deploy.yml`, GitHub Pages, base path `/logbook/` in Vite). -> **DONE**
- **R2**: Documentazione Deploy su Vercel: Aggiornare la sezione relativa al deployment specificando che l'applicazione è ora ospitata su Vercel, deploy automatico a ogni `git push`, nessun file di workflow dedicato necessario, app gira sulla radice (`/`) del dominio. -> **DONE**
- **R3**: Checklist Obbligatoria Sicurezza e Domini (Fail-Fast): Aggiungere una checklist obbligatoria chiara per chiunque modifichi il dominio dell'app con 2 passaggi critici:
  1. Aggiunta del nuovo dominio in "Authorized domains" di Firebase Authentication.
  2. Aggiunta del dominio con sintassi wildcard (es. `*nome.vercel.app/*`) nelle restrizioni HTTP referers della "Browser key" su Google Cloud Credentials per prevenire errori 403. -> **DONE**

## Acceptance Criteria
1. Grep search on `AGENTS.md` for "GitHub Actions", "deploy.yml", and "GitHub Pages" returns 0 matches. -> **VERIFIED (0 matches)**
2. `AGENTS.md` explicitly names "Vercel" as the official hosting platform. -> **VERIFIED (Present in Sections 1 & 5)**
3. Defined security checklist explicitly mentioning "Firebase Authentication (Authorized domains)" and "Google Cloud (Browser key / referrers)" with wildcard asterisk example. -> **VERIFIED (Section 5 lines 86-89)**
4. Quality & test verification (`npm test`, `npm run build`, `npm run lint`) all pass cleanly. -> **VERIFIED (543/543 tests pass, build 0 errors, lint 0 errors)**

## Status
**COMPLETED** (Gate Passed Iteration 1)
