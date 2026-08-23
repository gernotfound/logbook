# Task Assignment: Security, App Check & Spark Quota Specialist

## Working Directory
`C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_2`

## Mandatory Documents
- `C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md`
- `C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`

## Objective
Analyze App Check architecture (ReCaptchaV3Provider, token TTL, client-side site key, isSupported() == false handling, offline degradation vs enforcement), Firestore Security Rules for zero-cost Spark tier (single-doc limits, subcollections, array size caps, string limits, field whitelisting, zero `get()`/`exists()` queries), and Firebase Spark tier quota budget mathematical modeling.

## Expected Output
Deliver your complete findings in `analysis.md` and `handoff.md` in your working directory.

## 2026-08-22T19:50:31Z
You are explorer_survey_2, a Security & Spark Quota Specialist.
Your working directory is: C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_2
Read C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_2\DISPATCH.md, C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md, and C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md before starting work.
Investigate and design:
1. Firebase App Check integration: ReCaptchaV3Provider, token TTL, client-side site key safety, two-phase rollout (monitor -> enforcement), isSupported() == false handling with offline fallback vs cloud block, Auth authorized domains and API Key referrer security checklist.
2. Firestore Security Rules under strict 0-cost Spark Tier constraints: zero get()/exists() calls (0 extra reads), document size limit (950KB check in db.ts + rule payload validation), subcollection ownership and structure, array lengths, string bounds, and strict field whitelisting.
3. Spark Tier Quota Modeling: Detailed mathematical budget of daily reads/writes for average and power users against the 20k/40k/50k daily quotas.
4. Write your detailed report in C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_2\analysis.md and handoff.md.
When finished, send a brief message with your handoff path to parent.
