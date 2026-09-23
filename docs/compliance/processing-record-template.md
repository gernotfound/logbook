# Registro delle attività di trattamento — template LogBook

> Template di lavoro Art. 30 GDPR. Compilare in base al ruolo effettivo e far validare prima del pilot.

## Intestazione

- Organizzazione: `[PROVIDER_LEGAL_NAME]`
- Forma giuridica: `[PROVIDER_LEGAL_FORM]`
- Sede/recapito: `[PROVIDER_ADDRESS]`
- Contatto privacy: `[PRIVACY_EMAIL]`
- DPO, se applicabile: `[DPO_OR_NOT_APPLICABLE]`
- Versione registro: `[VERSION]`
- Data approvazione: `[DATE]`
- Responsabile dell'approvazione: `[ROLE]`

## Attività 1 — Erogazione LogBook e dati applicativi

| Campo | Contenuto da validare |
|---|---|
| Ruolo GDPR | `[CONTROLLER / PROCESSOR / OTHER — SEE controller-role-decision.md]` |
| Interessati | Utenti maggiorenni di LogBook |
| Finalità | Erogare funzioni richieste: allenamento, nutrizione, misurazioni, persistenza locale/cloud, sync, recovery |
| Categorie dati | Account; routine/sessioni/esercizi; nutrizione; peso/composizione/circonferenze; sonno; dolori/fatica; preferenze e metadati tecnici |
| Dati particolari | Dati relativi alla salute quando le informazioni inserite rientrano nell'art. 9 GDPR |
| Base Art. 6 | `[TO_VALIDATE]` |
| Condizione Art. 9 | Consenso esplicito attuale; adeguatezza e revoca da validare |
| Fonte | Direttamente dall'utente |
| Destinatari | Fornitori tecnici strettamente necessari; nessun accesso palestra nell'architettura corrente |
| Trasferimenti extra SEE | Vedi `vendor-transfer-register.md`; `[TO_VERIFY]` |
| Retention | Vedi `retention-schedule.md` |
| Misure | Vedi `technical-organizational-measures.md` |
| Sistemi | Browser/PWA; IndexedDB/localStorage; Firebase Authentication/Firestore; Vercel |

## Attività 2 — Autenticazione e gestione account

| Campo | Contenuto da validare |
|---|---|
| Finalità | Login, identificazione account, recupero accesso, sicurezza sessione |
| Dati | UID Firebase, email e dati restituiti dal provider di autenticazione applicabile |
| Base | `[TO_VALIDATE]` |
| Fornitori | Google/Firebase |
| Retention | Finché l'account è attivo; cancellazione tramite workflow account deletion, salvo record tecnici di recovery limitati |
| Misure | Auth Firebase, Security Rules, App Check lato client; enforcement live da verificare |

## Attività 3 — Telemetria tecnica propria

| Campo | Contenuto da validare |
|---|---|
| Finalità | Sicurezza, affidabilità, diagnosi errori, integrità/recovery |
| Dati | UID tecnico per account autenticati, session ID, versione app, piattaforma derivata, stato online, errori/stack sanitizzati, eventi diagnostici bounded |
| Esclusioni | Nessun tracking proprietario di avvio/salvataggio workout o funnel installazione PWA |
| Base | Legittimo interesse dichiarato nell'informativa corrente; eseguire/archiviare LIA prima del pilot |
| Retention | Target breve da rendere tecnicamente esecutivo; vedi `retention-schedule.md` |
| Destinatari | Firestore / personale autorizzato strettamente necessario |
| Misure | Sanitizzazione PII, allowlist dettagli, ownership Rules, queue bounded |

## Attività 4 — Analytics opzionali

| Campo | Contenuto da validare |
|---|---|
| Finalità | Statistiche tecniche e di utilizzo non essenziali |
| Fornitore | Vercel Analytics / Speed Insights |
| Attivazione | Opt-in; disabilitati per default e revocabili |
| Base | Consenso |
| Dati | Dati tecnici secondo il servizio e configurazione effettiva; non includere deliberatamente contenuto fitness grezzo |
| Retention/trasferimenti | Verificare documentazione e configurazione Vercel corrente |

## Attività 5 — Account deletion e recovery

| Campo | Contenuto da validare |
|---|---|
| Finalità | Cancellazione sicura, idempotenza e recovery cross-device |
| Dati | Job tecnico, timestamp/stato, hash non reversibile della receipt; nessun dato fitness nel tombstone finale |
| Retention | 30 giorni per il tombstone tecnico, poi purge giornaliero previsto |
| Sistema | Vercel Functions + Firebase Admin + Firestore/Auth |
| Accesso | Server-only |

## Attività 6 — Richieste privacy e supporto

| Campo | Contenuto da validare |
|---|---|
| Finalità | Gestire diritti, richieste, reclami, supporto e incidenti |
| Dati | Identità/contatto del richiedente, contenuto della richiesta, evidenze minime, esito |
| Base | Obbligo legale / gestione rapporto secondo il caso |
| Retention | `[DEFINE_CASE_FILE_RETENTION]` |
| Canale | `[PRIVACY_EMAIL]` / `[SUPPORT_EMAIL]` |

## Registro modifiche

| Data | Versione | Modifica | Approvata da |
|---|---|---|---|
| `[DATE]` | `[VERSION]` | Prima emissione | `[ROLE]` |
