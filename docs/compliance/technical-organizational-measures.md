# Misure tecniche e organizzative — TheLogBook

> Scheda TOM Art. 32 da allineare allo stato reale. "Presente nel codice" non equivale a "configurato live": le verifiche esterne sono esplicitamente separate.

## Misure tecniche osservabili nel repository

| Area | Misura | Evidenza/stato |
|---|---|---|
| Separazione account | Dati Firestore owner-scoped; account deletion barrier | Security Rules + test emulator |
| Persistenza locale | Envelope owner-scoped, journal semantico, recovery fail-closed | Implementato e testato |
| Cache Firestore | Cache locale persistente Firebase non usata; runtime memory-only | Implementato |
| Sync | Local durability prima della replica cloud; recovery lost-ack | Implementato/testato |
| Validazione | Gateway Zod ai boundary persistiti | Implementato |
| Telemetria | Sanitizzazione PII, allowlist dettagli, queue bounded | Implementato |
| Analytics di utilizzo | Google Analytics 4/Firebase Analytics e Vercel Analytics/Speed Insights dismessi; Firebase scollegato da GA4 e variabile Measurement ID eliminata; Sentry resta error monitoring tecnico | Codice verificato su GitHub; dismissione esterna confermata dal product owner |
| Account deletion | Workflow server-mediated, idempotente, Auth cancellata per ultima | Implementato/testato |
| Segreti | Firebase Admin/cron server-only, esclusi dal bundle | Contratto repository |
| HTTP | CSP, frame denial, referrer/permissions policies e cache policy app-shell/SW | `firebase.json` + smoke Firebase Hosting |
| CI | Exact-SHA Canonical Verification + M8 | GitHub Actions |
| Deploy | Firebase Hosting solo dopo CI verde exact-SHA su `main`; Vercel backend main-only | Workflow GitHub + `vercel.json` |
| PWA update | Reload barrier prima dell'update | Implementato/testato |

## Misure esterne da verificare

| Sistema | Controllo | Stato |
|---|---|---|
| Firebase | Security Rules live corrispondono al commit approvato | sorgente live identica a `firestore.rules` di `main` — verificato 2026-10-02 |
| App Check | Enforcement effettivo sui servizi applicabili | `ENFORCED` su Firestore, Authentication e RTDB — verificato 2026-10-02 |
| Firebase Auth | Authorized domains | Vercel frontend rimosso; Firebase defaults + `thelogbook.web.app` verificati 2026-10-02 |
| Firebase Auth | Password policy / provider config | ENFORCE: min 8 + maiuscola/minuscola/numero/non-alfanumerico; Improved Email Privacy ON — verificato 2026-10-02 |
| Google Cloud | Restrizioni Browser API key | referrer Vercel rimosso; Firebase action origin + `thelogbook.web.app` mantenuti — verificato 2026-10-02 |
| Firestore | Regione/database location | `europe-west12`, Native Standard/free tier — verificato 2026-10-02 |
| Firestore | Delete protection / Backup-PITR | Delete protection ENABLED; PITR/backup gestiti disabilitati perché richiedono billing — verificato 2026-10-02 |
| Vercel | Env server trusted presenti e corretti | `[VERIFY]` |
| Vercel | Accessi team, MFA, log retention | `[VERIFY]` |
| GitHub | Ruleset/required check exact-SHA | `[VERIFY]` |
| Account amministrativi | MFA/2FA | `[VERIFY]` |

## Misure organizzative da istituire

- accesso amministrativo limitato per necessità;
- inventario account privilegiati con review periodica;
- incident/breach runbook con ruoli e canali;
- processo diritti interessati;
- registro trattamenti e vendor/transfer register;
- changelog legale quando cambiano dati/finalità/fornitori;
- onboarding/offboarding di eventuali collaboratori;
- divieto di copiare dati reali in issue, PR, fixture, prompt o ambienti di test;
- test periodico di export, account deletion e restore se vengono attivati backup;
- review annuale o su cambiamento significativo di DPIA/TOM.

## Evidenza minima per il pilot

Allegare/archiviare:

1. SHA Production e CI verde;
2. release Firebase Hosting e deployment Vercel backend associati allo stesso stato di `main`;
3. Rules/App Check live verificati;
4. elenco env richieste senza valori segreti;
5. risultati smoke account/deletion pertinenti;
6. data ultima review accessi amministrativi;
7. versione RoPA/DPIA screening/retention/vendor register;
8. conferma revisione professionale dei documenti legali.
