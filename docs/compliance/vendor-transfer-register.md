# Fornitori, subprocessori e trasferimenti — TheLogBook

**Registro tecnico/legale da validare, NON attestazione GDPR.** Registrare soltanto servizi usati dal codice legacy ancora presente o scelti per la nuova architettura. Localizzazione e condizioni contrattuali richiedono documenti ufficiali e prova nel tenant competente. Il piano Cloudflare è un **fresh start**, senza migrazione di account o dati pre-lancio.

## Fornitori e trattamenti nel perimetro attuale

| Fornitore | Funzione e stato | Dati potenzialmente trattati | Ruolo/DPA | Regioni e trasferimenti | Retention e gate |
|---|---|---|---|---|---|
| **Kinde — target** | Identità e email Auth; Email/Google selezionati nell'onboarding, login non integrato | Email, identità, token, rete, MFA e metadati di sicurezza; nessun dato salute previsto | `[VERIFY_DPA]` | Regione Irlanda selezionata in UI, subprocessori/email e trasferimenti `[VERIFY]` | Cancellazione identità, log, retention, Free, password/Google/email reali `[VERIFY]` |
| **Cloudflare Workers Static Assets / Workers API — target** | Static Assets Worker disponibile, API non pubblicata | Request metadata e log; dati applicativi sanitari **solo cifrati** nel target | `[VERIFY_DPA]` | Esecuzione Workers, log, subprocessori `[VERIFY]` | TTL/retention e sicurezza `[VERIFY]` |
| **Cloudflare D1 — sandbox isolata** | SQL EU con fixture sintetiche, non database utenti | Fixture oggi; ciphertext e controllo account/consenso in futuro | `[VERIFY_DPA]` | `jurisdiction=eu` osservata sul DB sandbox, altra residenza non implicata | Backup/restore/retention/erasure/quote `[VERIFY]` |
| **Google — legacy Firebase Auth/Firestore/App Check** | Chiamanti e security boundary ancora nel codice non sostituito; Hosting statico disabilitato | UID/email, metadati e ciphertext/controlli applicativi del runtime precedente | `[VERIFY_DPA]` | Configurazione del vecchio progetto `[VERIFY]` | Non necessario al target dopo porting e dismissione verificati |
| **Vercel — backend legacy sospeso** | Functions/Cron e credenziali legacy ancora nel codice, deploy Git disabilitato | Metadati API e chiavi server del vecchio boundary, secondo implementazione | Copertura Art. 28 sul piano Hobby non provata | Region/log e transfer `[VERIFY]` | Nessun percorso target; ritiro dopo conversione dei diritti/chiavi/job, verifica e mandato |
| **GitHub** | Repository, Action/CI, sicurezza e codice pubblico | Commit, metadata sviluppatori, log CI; nessun dato salute utente intenzionale | `[VERIFY]` | `[VERIFY]` | Log/retention e permessi `[VERIFY]` |

## Checklist obbligatoria prima del GO per ciascun provider effettivo

- [ ] DPA, ruolo (titolare/responsabile) e contatti privacy/security pertinenti al **piano effettivamente utilizzato**.
- [ ] Subprocessori, paesi dei trattamenti, trasferimenti fuori SEE e meccanismi (SCC/DPF/adeguatezza, se applicabili).
- [ ] Retention, backup, log, metadata di rete, cancellazione/portabilità e limiti delle richieste di erasure.
- [ ] Accessi IAM, MFA, risposta agli incidenti, misure tecniche e restrizioni dei token.
- [ ] Consegna e MIME delle email Auth e dei reset, tracciamento e gestione degli scanner.
- [ ] Quote Free, sicurezza antiabuso, fail-closed e blocco di eventuali costi aggiuntivi.
- [ ] Informativa, trattamento dei dati sanitari e consenso esplicito maggiorenni revisionati prima dell'accesso esterno.

## Registro dei trasferimenti — da compilare con evidenza live

| Dataset | Origine | Destinazione | Subprocessori / paese | Base di trasferimento | Data e prova |
|---|---|---|---|---|---|
| Identità, email, OAuth e log | PWA | Kinde / Google | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` |
| Dati cifrati, sessioni, consenso e metadati | PWA | Workers / D1 | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` |

Non inserire dati di salute in chiaro, credenziali, token o email personali nel registro. Eliminare un SDK non prova che il provider abbia eliminato automaticamente log o backup pregressi; questi non sono però servizi da ripristinare. La cronologia Git conserva le evidenze rimosse dal contesto operativo.

**Fonti tecniche:** [AGENTS](../../AGENTS.md), [servizi esterni](../../.agents/rules/external-services.md), [registro operativo](../operations/external-services-register.md), [consenso sanitario](health-consent-release-gate.md), [screening DPIA](dpia-screening-template.md).
