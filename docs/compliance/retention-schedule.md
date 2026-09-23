# Retention schedule — LogBook

> Policy di conservazione da approvare prima del pilot e mantenere allineata al comportamento reale. Le durate di progetto non sono "imposte dal GDPR": devono essere motivate da finalità, necessità, rischio e obblighi applicabili.

## Tabella

| Categoria | Storage | Trigger iniziale | Target/retention | Cancellazione | Stato tecnico |
|---|---|---|---|---|---|
| Dati core account | Firestore + copia locale owner-scoped | Creazione/inserimento | Per la durata dell'account e finché necessari al servizio; eventuale policy inattività `[TO_DECIDE]` | Account deletion + cancellazione locale dopo prova completion | Implementato per cancellazione account |
| Dati guest | IndexedDB/localStorage dispositivo | Primo uso | Finché l'utente li mantiene o li elimina/migra | Azioni locali / browser OS / migrazione | Implementato |
| Telemetria tecnica `telemetry_errors` | Firestore | Ultima occorrenza aggregata | **30 giorni dall'ultima occorrenza** | Campo `expireAt` + TTL Firestore | Repository pronto; **attivazione live da verificare** |
| Telemetria tecnica `telemetry_events` | Firestore | Evento | **30 giorni dall'evento** | Campo `expireAt` + TTL Firestore | Repository pronto; **attivazione live da verificare** |
| Telemetria storage `telemetry_anomalies` | Firestore | Anomalia | **30 giorni dall'evento** | Campo `expireAt` + TTL Firestore | Repository pronto; **attivazione live da verificare** |
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

## Attivazione tecnica telemetry

Il repository prepara una retention nominale di 30 giorni tramite un campo Firestore `expireAt` calcolato dall'evento o dall'ultima occorrenza dell'errore, Security Rules compatibili con client già installati e policy TTL dichiarate in `firestore.indexes.json`. Il campo TTL è escluso dagli indici ordinari perché non viene interrogato dall'app.

Prima del merge/go-live della relativa informativa devono essere completati e documentati:

- deploy delle Security Rules compatibili sul progetto Firebase reale;
- confronto/esportazione degli eventuali indici Firestore già esistenti nel progetto: poiché il repository non aveva finora un manifest indici, `firestore.indexes.json` non deve essere deployato alla cieca prima di aver riconciliato lo stato live;
- attivazione e stato effettivo delle tre policy TTL `expireAt` per `telemetry_errors`, `telemetry_events` e `telemetry_anomalies`;
- verifica di eventuali documenti telemetrici preesistenti privi di `expireAt`, con backfill o cancellazione secondo una procedura approvata;
- verifica runtime dopo il rilascio che i nuovi documenti contengano `expireAt` e che le scritture non siano rifiutate;
- conferma che l'informativa Privacy pubblicata descriva la retention effettivamente attiva.

La cancellazione TTL non è istantanea: un documento scaduto può permanere per il ritardo tecnico del servizio prima della rimozione effettiva.
