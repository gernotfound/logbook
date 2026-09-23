# Registro fornitori, subprocessori e trasferimenti — LogBook

> Compilare da documentazione contrattuale e console correnti. Non dedurre localizzazione, ruolo o meccanismo di trasferimento dal solo repository.

## Fornitori runtime correnti

| Fornitore/servizio | Funzione | Dati potenzialmente trattati | Ruolo contrattuale | Localizzazione | Trasferimento extra SEE / garanzia | Retention | Stato |
|---|---|---|---|---|---|---|---|
| Google / Firebase Authentication | Login/account | UID, email, dati provider auth | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Cloud Firestore | Dati cloud utenti, telemetria tecnica | Dati app, salute, metadati tecnici | `[VERIFY_DPA]` | Database: `[VERIFY_LIVE]` | `[VERIFY]` | App + servizio | Aperto |
| Google / reCAPTCHA Enterprise / App Check | Anti-abuse/attestazione | Dati tecnici dispositivo/rete secondo servizio | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Vercel Hosting / Functions | Hosting e API server | Request metadata; payload API necessari; log tecnici | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY_PLAN]` | Aperto |
| Vercel Analytics / Speed Insights | Analytics opzionali | Dati tecnici secondo servizio/config | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Opt-in |
| GitHub | Repository e CI | Codice, metadati dev, log CI; nessun dato utente intenzionale | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Dev-only |

Google/Firebase Analytics è escluso dal runtime LogBook corrente.

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
