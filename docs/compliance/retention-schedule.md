# Retention schedule — LogBook

> Policy di conservazione da approvare prima del pilot e mantenere allineata al comportamento reale. Le durate di progetto non sono "imposte dal GDPR": devono essere motivate da finalità, necessità, rischio e obblighi applicabili.

## Tabella

| Categoria | Storage | Trigger iniziale | Target/retention | Cancellazione | Stato tecnico |
|---|---|---|---|---|---|
| Dati core account | Firestore + copia locale owner-scoped | Creazione/inserimento | Per la durata dell'account e finché necessari al servizio; eventuale policy inattività `[TO_DECIDE]` | Account deletion + cancellazione locale dopo prova completion | Implementato per cancellazione account |
| Dati guest | IndexedDB/localStorage dispositivo | Primo uso | Finché l'utente li mantiene o li elimina/migra | Azioni locali / browser OS / migrazione | Implementato |
| Telemetria tecnica `telemetry_errors` | Firestore | Invio errore | **Target 30 giorni dall'ultima occorrenza** | TTL/purge automatico `[TO_IMPLEMENT_AND_VERIFY]` | **Blocker P1** |
| Telemetria tecnica `telemetry_events` | Firestore | Invio evento | **Target 30 giorni dall'evento** | TTL/purge automatico `[TO_IMPLEMENT_AND_VERIFY]` | **Blocker P1** |
| Telemetria storage `telemetry_anomalies` | Firestore | Invio anomalia | **Target 30 giorni dall'evento** | TTL/purge automatico `[TO_IMPLEMENT_AND_VERIFY]` | **Blocker P1** |
| Coda telemetria offline | localStorage owner/device | Failure/offline | Bounded a 50 elementi; espulsione/retry secondo codice | Queue lifecycle/logout/storage cleanup | Implementato |
| Consenso legale | UserData root | Accettazione | Finché serve a dimostrare la versione accettata e per la durata pertinente del rapporto/obblighi | Definire dopo cessazione: `[TO_VALIDATE]` | Persistito, retention post-account da definire |
| Consenso analytics | storage locale | Opt-in | Finché preferenza attiva o storage disponibile | Revoca/settings/storage clear | Implementato come preferenza; evidenza/versioning da migliorare |
| Deletion job/tombstone | Firestore server-only | Richiesta cancellazione | 30 giorni dopo completion | Cron giornaliero | Contratto implementato; runtime cron da verificare periodicamente |
| Log Vercel | Vercel | Request/function event | `[VERIFY_PLAN_AND_CONFIGURATION]` | Policy Vercel | Esterno da verificare |
| Log Firebase/Google Cloud | Google | Evento servizi | `[VERIFY_SERVICE_CONFIGURATION]` | Policy servizio | Esterno da verificare |
| Backup Firestore | `[NONE / PITR / SCHEDULED]` | `[TO_DECIDE]` | `[TO_DECIDE]` | `[TO_DECIDE]` | Decisione esterna pendente |
| Richieste privacy/supporto | Sistema/canale adottato | Apertura caso | `[DEFINE_AND_VALIDATE]` | Cancellazione/archiviazione case file | Organizzativo |

## Regole operative

1. Una retention dichiarata nella Privacy Policy deve corrispondere a una misura tecnica o procedura realmente verificabile.
2. Una copia di backup non deve diventare una retention indefinita: definire ciclo, restore e cancellazione.
3. La cancellazione account deve includere le collection private note e fallire chiusa in presenza di dati privati inattesi.
4. Le retention dei fornitori vanno riportate solo dopo verifica del piano/configurazione reale.
5. Ogni eccezione legale alla cancellazione deve essere documentata con dataset, base, durata e accessi ridotti.

## Blocker tecnico telemetry

Il target di 30 giorni è una scelta di minimizzazione proposta per la diagnostica tecnica. Prima di dichiararlo operativo servono:

- campo/strategia di scadenza compatibile con Firestore;
- Security Rules coerenti;
- purge/TTL live verificato sulle tre collection group;
- test di regressione;
- aggiornamento Privacy Policy se la descrizione della retention cambia materialmente.

Finché questi punti non sono chiusi, il target non va presentato agli utenti come retention effettiva.
