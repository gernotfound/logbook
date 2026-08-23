## 2026-08-22T18:37:52Z

<USER_REQUEST>
You are the Project Orchestrator for the Cloud Firestore Security and Stability Audit project for LogBook PWA.

Your working directory is: `c:\Users\gerar\Documents\GitHub\logbook\.agents\orchestrator_audit_1`.
Authoritative request is recorded in: `c:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md` (under section `## 2026-08-22T18:36:54Z`).
Project repository root: `c:\Users\gerar\Documents\GitHub\logbook`.
Target deliverable working directory: `c:\Users\gerar\teamwork_projects\logbook_firebase_audit`.

Key Requirements:
- R1: Evaluation of current Firestore security rules vs best practices and constraints (NO get/exists in rules to preserve deleteAccount 400-doc batch compatibility; owner-only model).
- R2: Impact analysis and client compatibility with `src/lib/db.ts` (getDoc, getDocs during deleteAccount, writeBatch chunking).
- R3: Minimum test matrix with Firebase Rules Testing SDK (`@firebase/rules-unit-testing`) & Firestore Emulator Suite (Auth, CRUD matrix, realistic fixtures, atomic batch failure/cross-tenant isolation, outside collections denied).
- R4: Test setup, config (`firebase.json`), repeatable execution (`firebase emulators:exec`), security smoke test, rule coverage report, rollout/rollback procedures.
- CRITICAL: Do NOT modify production code in `c:\Users\gerar\Documents\GitHub\logbook\src`. All tests, config, and audit reports must be created in the deliverable directory `~/teamwork_projects/logbook_firebase_audit`.
- Follow AGENTS.md rules. Maintain `plan.md` and `progress.md` in your working directory.
- Dispatch specialist subagents (explorers, workers, test writers, challengers, reviewers) to carry out the research, implementation of tests, and audit report generation.
- When finished, produce your final report and handoff back to the Sentinel.
</USER_REQUEST>
