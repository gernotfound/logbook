# Handoff Report — Explorer 3: AGENTS.md Documentation & Verification Planning

## 1. Observation
- **Target File**: `c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md` (Total lines: 151).
- **Direct Code Inspection**:
  - `AGENTS.md:77`: `- **Vite Static Access & CI/CD (Prevenzione Crash di Build):**`
  - `AGENTS.md:79`: `...o configurare adeguatamente i Secrets nel CI/CD (es. GitHub Actions), altrimenti la build andrà a buon fine ma il sito in cloud si tradurrà in una schermata nera (crash a runtime).`
  - Search for `GitHub Actions` produced 1 match (`AGENTS.md:79`).
  - Search for `deploy.yml` and `GitHub Pages` produced 0 matches in `AGENTS.md`.
  - Section 1 (`AGENTS.md:7-17`) lists tech stack components but does not explicitly name Vercel under hosting/deploy.
  - Section 5 (`AGENTS.md:75-83`) currently lacks documentation of Vercel deployment mechanics (auto-deploy on `git push`, no dedicated workflow file, root base path `/`) and the mandatory 2-step domain authorization checklist (Firebase Authentication & Google Cloud Credentials HTTP referrers wildcard).
- **Project Test Execution**:
  - `npm.cmd test`: Exited with code 0 (30 test files passed, 543 unit/integration tests passed).
  - `npm.cmd run build`: Exited with code 0 (2280 modules transformed, PWA generated in 992ms).
  - `npm.cmd run lint`: Exited with code 0 (0 errors, 25 unused import warnings in test files).
- **Vite Config Inspection**:
  - `vite.config.ts:6-9`: `const basePath = '/'` with comment `// Base path: set to '/' for Vercel or root domains.` and `base: basePath`.

## 2. Logic Chain
1. **From Observation 1**: Line 79 of `AGENTS.md` contains `(es. GitHub Actions)` and line 77 contains `CI/CD (Prevenzione Crash di Build)`. To satisfy Requirement R1 and Acceptance Criterion 1, all occurrences of `GitHub Actions`, `deploy.yml`, `GitHub Pages`, and old CI/CD workflow references must be cleanly removed.
2. **From Observation 2**: Vercel is the production hosting platform, and `vite.config.ts` configures root `/` base path. To satisfy Requirement R2 and Acceptance Criterion 2, `AGENTS.md` Section 1 and Section 5 must explicitly state that the application is hosted on Vercel, deployed automatically on `git push` without dedicated workflow files, and served on the root (`/`) base path.
3. **From Observation 3**: Firebase Auth and Google Cloud API keys enforce strict domain restrictions. Modifying the domain without adding it to Firebase "Authorized domains" breaks Google OAuth login, and without adding wildcard HTTP referrers (`*nome.vercel.app/*`) in Google Cloud Console Browser key triggers 403 Forbidden errors. To satisfy Requirement R3 and Acceptance Criterion 3, a structured mandatory checklist must be added to Section 5.
4. **From Observation 4**: Vitest, TypeScript build, and Oxlint are fully green. Documentation changes in `AGENTS.md` will preserve 100% test integrity and build passing status (Acceptance Criterion 4).

## 3. Caveats
- No caveats. The target changes are strictly confined to markdown documentation in `AGENTS.md` and do not alter application logic or dependencies.

## 4. Conclusion
- Exploration is complete and the implementation plan is fully outlined in `.agents/explorer_3/analysis.md`.
- Worker can perform the exact replacements in `AGENTS.md` Section 1 and Section 5.
- Reviewers, Challengers, and Auditor have clear, deterministic verification commands and criteria to ensure 100% compliance.

## 5. Verification Method
1. **Forbidden Terms Grep**:
   ```powershell
   Get-Content AGENTS.md | Select-String -Pattern "GitHub Actions|deploy\.yml|GitHub Pages|/logbook/"
   ```
   *Expected*: 0 matches.
2. **Required Terms Grep**:
   ```powershell
   Get-Content AGENTS.md | Select-String -Pattern "Vercel|Authorized domains|Browser key|referrers"
   ```
   *Expected*: Matches found in Section 1 and Section 5.
3. **Automated Quality Checks**:
   ```powershell
   npm.cmd test
   npm.cmd run build
   npm.cmd run lint
   ```
   *Expected*: All exit with code 0.
