# Supporto e SLA — template LogBook

> Definire solo impegni realmente sostenibili. Per il primo pilot è preferibile un modello best-effort se non esistono ancora reperibilità, monitoraggio e procedure capaci di sostenere SLA misurabili.

## Canali

- Supporto: `[SUPPORT_EMAIL]`
- Incident escalation: `[INCIDENT_CHANNEL]`
- Orari operativi: `[HOURS_AND_TIMEZONE]`

## Classificazione

| Severità | Esempio | Presa in carico promessa | Aggiornamenti |
|---|---|---|---|
| S1 critica | Accesso indebito, perdita dati diffusa, servizio inutilizzabile | `[TARGET]` | `[CADENCE]` |
| S2 alta | Funzione primaria compromessa con workaround limitato | `[TARGET]` | `[CADENCE]` |
| S3 normale | Bug non bloccante / problema singolo utente | `[TARGET]` | `[CADENCE]` |
| S4 richiesta | Informazioni / miglioramento | `[TARGET]` | `[CADENCE]` |

Lasciare vuoti i target finché non vengono approvati commercialmente.

## Disponibilità

- Modello: `[BEST_EFFORT / SLA]`
- Uptime target, se previsto: `[NONE / PERCENTAGE]`
- Finestra misurazione: `[PERIOD]`
- Esclusioni: `[PLANNED_MAINTENANCE / PROVIDER_OUTAGES / FORCE_MAJEURE / OTHER]`

## Backup e recovery

Non confondere il funzionamento offline-first e l'export utente con un servizio di disaster recovery enterprise.

- Backup server: `[NONE / PITR / SCHEDULED]`
- RPO promesso: `[NONE / VALUE]`
- RTO promesso: `[NONE / VALUE]`
- Restore test: `[DATE/NOT_AVAILABLE]`

Non inserire RPO/RTO nel contratto finché il processo non è implementato e testato.

## Escalation sicurezza/privacy

Gli incidenti privacy/security seguono `incident-breach-runbook.md` e non devono essere trattati come ticket ordinari quando richiedono valutazione breach o contenimento urgente.

## Review

- Owner: `[ROLE]`
- Approvazione: `[DATE]`
- Frequenza review: `[CADENCE]`
