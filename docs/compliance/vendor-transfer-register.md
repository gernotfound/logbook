# Registro fornitori, subprocessori e trasferimenti — TheLogBook

> Compilare da documentazione contrattuale e console correnti. Non dedurre localizzazione, ruolo o meccanismo di trasferimento dal solo repository.

**Perimetro tecnico:** [AGENTS](../../AGENTS.md), [Cifratura](../../.agents/rules/secure-storage.md) e [Telemetria](../../.agents/rules/telemetry-and-privacy.md). Le descrizioni sotto derivano dal contratto repository; ruoli, termini, localizzazioni e retention provider rimangono da verificare e approvare.

## Fornitori runtime correnti

| Fornitore/servizio | Funzione | Dati potenzialmente trattati | Ruolo contrattuale | Localizzazione | Trasferimento extra SEE / garanzia | Retention | Stato |
|---|---|---|---|---|---|---|---|
| Google / Firebase Authentication | Login/account | UID, email, dati provider auth | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Cloud Firestore | Replica cloud cifrata utenti, registri tecnici server-only ed eventuali residui telemetrici pre-lancio | Ciphertext business/salute, metadati causali pubblici, dati amministrativi minimi; nessun nuovo invio telemetrico client a Firestore | `[VERIFY_DPA]` | Database: `[VERIFY_LIVE]` | `[VERIFY]` | App + servizio | Aperto |
| Google / reCAPTCHA Enterprise / App Check | Anti-abuse/attestazione | Dati tecnici dispositivo/rete secondo servizio | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Firebase Hosting | Hosting statico frontend/PWA | Request metadata e asset pubblici; nessun dato business utente intenzionale | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Vercel Functions / Cron | API trusted per lifecycle, consenso/diritti, custodia chiave cloud e manutenzione | Request metadata; payload API minimi; ADK accessibile al server trusted tramite KEK protetta; log tecnici minimizzati, mai chiavi/token/dati salute liberi | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY_PLAN]` | Aperto |
| Sentry | Error Monitoring e source map | Classificazioni tecniche ammesse e messaggi fissi, session ID tecnico, release/build e contesto tecnico minimizzato; messaggi/stack originali esclusi anche se sanitizzati; nessun UID/email deliberatamente allegato dall'app | `[VERIFY_DPA]` | `[VERIFY_LIVE]` | `[VERIFY]` | `[VERIFY_PLAN_AND_CONFIGURATION]` | Errori tecnici |
| GitHub | Repository e CI | Codice, metadati dev, log CI; nessun dato utente intenzionale | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Dev-only |

Google Analytics 4/Firebase Analytics è dismesso e non è un fornitore runtime corrente: integrazione client e collegamento Firebase rimossi, proprietà Analytics dismessa e variabile di build eliminata, secondo le operazioni confermate dal product owner. Anche Vercel Analytics e Speed Insights restano ritirati. Sentry Replay, tracing, logging e Application Metrics sono esclusi dalla configurazione corrente. Le configurazioni storiche restano rintracciabili nella cronologia Git.

## Checklist per ogni fornitore

- `[ ]` DPA/termini correnti archiviati o linkati internamente.
- `[ ]` Elenco subprocessori verificato.
- `[ ]` Regioni/data location effettive verificate.
- `[ ]` Trasferimenti extra SEE identificati.
- `[ ]` Meccanismo applicabile verificato (adeguatezza/DPF/SCC/altro).
- `[ ]` Eventuali misure supplementari valutate.
- `[ ]` Retention/logging verificati.
- `[ ]` Accessi amministrativi e MFA verificati.
- `[ ]` Contatto security/privacy del fornitore registrato.

## Registro trasferimenti

| Dataset | Origine | Destinazione | Fornitore/subprocessor | Paese | Meccanismo | Misure supplementari | Verificato il |
|---|---|---|---|---|---|---|---|
| `[DATASET]` | `[EU]` | `[COUNTRY]` | `[VENDOR]` | `[COUNTRY]` | `[SCC/DPF/ADEQUACY/OTHER]` | `[MEASURES]` | `[DATE]` |

## Change control

Nuovo SDK, CDN, monitoring, email provider, support tool o analytics = nuova riga prima del rilascio. Se il fornitore riceve dati salute o identificatori utente, rivalutare DPIA, informativa, contratto e base giuridica.
