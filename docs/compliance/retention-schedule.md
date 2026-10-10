# Retention schedule — TheLogBook

> Policy di conservazione da approvare prima del pilot e mantenere allineata al comportamento reale. Le durate di progetto non sono "imposte dal GDPR": devono essere motivate da finalità, necessità, rischio e obblighi applicabili.

## Tabella

| Categoria | Storage | Trigger iniziale | Target/retention | Cancellazione | Stato tecnico |
|---|---|---|---|---|---|
| Dati core account | Firestore + copia locale owner-scoped | Creazione/inserimento | Per la durata dell'account e finché necessari al servizio; eventuale policy inattività `[TO_DECIDE]` | Account deletion + cancellazione locale dopo prova completion | Implementato per cancellazione account |
| Dati guest | IndexedDB/localStorage dispositivo | Primo uso | Finché l'utente li mantiene o li elimina/migra | Azioni locali / browser OS / migrazione | Implementato |
| Telemetria tecnica corrente | Sentry | Errore/anomalia Production | `[VERIFY_PLAN_AND_CONFIGURATION]` | Policy/configurazione Sentry | Implementato nel client; retention esterna da verificare |
| Telemetria Firestore legacy `telemetry_errors` | Firestore | Ultima occorrenza aggregata | **30 giorni dall'ultima occorrenza** | Campo `expireAt` + maintenance cron giornaliero | Solo compatibilità/cleanup client precedenti |
| Telemetria Firestore legacy `telemetry_events` / `telemetry_anomalies` | Firestore | Evento/anomalia | **30 giorni dall'evento** | Campo `expireAt` + maintenance cron giornaliero | Solo compatibilità/cleanup client precedenti |
| Coda telemetria offline legacy/compatibilità | localStorage owner/device | Failure/offline | Bounded a 50 elementi; espulsione/retry secondo codice | Queue lifecycle/logout/storage cleanup | Implementato |
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

Il client corrente invia errori/anomalie tecniche a Sentry e non crea nuove scritture nelle collection Firestore `telemetry_*`. La retention Sentry è esterna al repository e deve essere verificata sul piano/configurazione effettivi prima del go-live.

Per i client precedenti e i dati legacy, il repository applica una retention nominale di 30 giorni tramite un campo Firestore `expireAt` calcolato dall'evento o dall'ultima occorrenza dell'errore e Security Rules che rifiutano nuove scritture telemetriche prive di scadenza. I client PWA obsoleti possono perdere temporaneamente la sola telemetria best-effort finché non si aggiornano; le funzionalità essenziali restano indipendenti da questo canale.

La cancellazione viene eseguita dal maintenance cron server-side già schedulato quotidianamente. La sweep usa Firebase Admin e interroga direttamente le tre collection group `telemetry_*` con pagine bounded da 400 documenti scaduti per query, senza enumerare preventivamente tutti gli utenti in memoria. La cancellazione filtra rigidamente i percorsi attesi `users/{uid}/telemetry_*/*`, ignora i risultati inattesi e può riprendere in modo idempotente all'invocazione successiva se il budget della Function termina prima di completare il ciclo.

Ogni delete usa una precondizione `lastUpdateTime`: se un errore aggregato riceve una nuova occorrenza e la sua scadenza viene estesa dopo la lettura, il batch non elimina il documento aggiornato e la sweep può ritentare alla successiva esecuzione. Un risultato inatteso fuori dai percorsi privati viene conteggiato ma non cancellato; in quel caso `completedCycle` rimane falso. Se il tempo residuo è insufficiente dopo una query, non si avvia il batch distruttivo.

Prima del go-live devono essere completati e documentati:

- Security Rules live con gate obbligatorio `expireAt` sul progetto Firebase reale;
- verifica di eventuali documenti telemetrici preesistenti privi di `expireAt`; se presenti, migrazione o cancellazione secondo una procedura approvata;
- verifica runtime dopo il rilascio che i nuovi documenti contengano `expireAt` e che le scritture non siano rifiutate;
- osservazione di almeno un'esecuzione reale del cron con i contatori `telemetryDocumentsScanned`, `telemetryPurged`, `telemetryUnexpectedDocuments` e `telemetryCycleCompleted`;
- conferma che l'informativa Privacy pubblicata descriva la retention effettivamente attiva.

La retention applicativa non dipende dalle policy Firestore TTL native: il maintenance cron usa Firebase Admin e resta quindi compatibile con il piano Firebase corrente senza introdurre un requisito di billing solo per la cancellazione telemetrica.
