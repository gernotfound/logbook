# Misure tecniche e organizzative — LogBook

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
| Analytics | Google/Firebase Analytics rimosso; Vercel analytics opt-in | Implementato |
| Account deletion | Workflow server-mediated, idempotente, Auth cancellata per ultima | Implementato/testato |
| Segreti | Firebase Admin/cron server-only, esclusi dal bundle | Contratto repository |
| HTTP | CSP, HSTS, frame denial, referrer/permissions policies | `vercel.json` + verifica Production |
| CI | Exact-SHA Canonical Verification + M8 | GitHub Actions |
| Deploy | Solo `main` abilita Git deployment Vercel | Contratto repository |
| PWA update | Reload barrier prima dell'update | Implementato/testato |

## Misure esterne da verificare

| Sistema | Controllo | Stato |
|---|---|---|
| Firebase | Security Rules live corrispondono al commit approvato | `[VERIFY]` |
| App Check | Enforcement effettivo sui servizi applicabili | `[VERIFY]` |
| Firebase Auth | Authorized domains | `[VERIFY]` |
| Firebase Auth | Password policy / provider config | `[VERIFY]` |
| Google Cloud | Restrizioni Browser API key | `[VERIFY]` |
| Firestore | Regione/database location | `[VERIFY]` |
| Firestore | Backup/PITR e restore test | `[DECIDE/VERIFY]` |
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
2. deploy Vercel associato;
3. Rules/App Check live verificati;
4. elenco env richieste senza valori segreti;
5. risultati smoke account/deletion pertinenti;
6. data ultima review accessi amministrativi;
7. versione RoPA/DPIA screening/retention/vendor register;
8. conferma revisione professionale dei documenti legali.
