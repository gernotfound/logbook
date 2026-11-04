# Retention schedule — TheLogBook

> Policy di conservazione da approvare prima del pilot e mantenere allineata al comportamento reale. Le durate di progetto non sono "imposte dal GDPR": devono essere motivate da finalità, necessità, rischio e obblighi applicabili.

**Fonte tecnica:** [AGENTS](../../AGENTS.md), [Telemetria e privacy](../../.agents/rules/telemetry-and-privacy.md) e [Consenso salute](../../.agents/rules/health-consent.md). I checkpoint Production sotto sono osservazioni storiche datate, da non usare come prova live attuale; le questioni giuridiche e i segnaposto restano aperti.

## Decisione pubblicazione con segnaposto — 12 ottobre 2026

Per la revoca esplicita dei dati salute, la UI non cancella automaticamente gli archivi locali e cloud: sospende le funzionalità, mantiene accessibili export e cancellazione, e può consentire nuovo consenso esplicito. La retention **dopo la revoca** non è ancora giustificata né approvata sul piano giuridico: **`[DEFINIRE_FINALITÀ_BASE_GIURIDICA_DURATA_E_CANCELLAZIONE_POST_REVOCA]`**. Non confondere la tutela tecnica contro una perdita dati o una cancellazione prematura con l'autorizzazione giuridica a conservare indefinitamente. Il product owner ha autorizzato il merge con segnaposto; resta da completare prima di trattare dati reali in un pilot.

## Tabella

| Categoria | Storage | Trigger iniziale | Target/retention | Cancellazione | Stato tecnico |
|---|---|---|---|---|---|
| Dati core account | Firestore + copia locale owner-scoped | Creazione/inserimento | Per la durata dell'account e finché necessari al servizio; eventuale policy inattività `[TO_DECIDE]` | Account deletion + cancellazione locale dopo prova completion | Implementato per cancellazione account |
| Dati guest | IndexedDB/localStorage dispositivo | Primo uso | Finché l'utente li mantiene o li elimina/migra | Azioni locali / browser OS / migrazione | Implementato |
| Telemetria Firestore legacy `telemetry_errors` | Firestore | Ultima occorrenza aggregata | **30 giorni dall'ultima occorrenza** | Campo `expireAt` + maintenance cron giornaliero | Configurazione Production verificata; prima esecuzione del nuovo cron da osservare |
| Telemetria Firestore legacy `telemetry_events` / `telemetry_anomalies` | Firestore | Evento/anomalia | **30 giorni dall'evento** | Campo `expireAt` + maintenance cron giornaliero | Configurazione Production verificata; prima esecuzione del nuovo cron da osservare |
| Copia business del consenso legale | `UserData.legalConsent` nel root cifrato | Accettazione | Finché serve a dimostrare la versione accettata e per la durata pertinente del rapporto/obblighi | Definire dopo cessazione: `[TO_VALIDATE]` | Persistito, retention post-account da definire |
| Consenso salute autorevole | `health_consent_withdrawals/{uid}`, server-only | Prima accettazione e successive decisioni | Stato/revisione e versioni legali correnti; durata giuridica `[TO_VALIDATE]` | Separato dalla copia business; la cancellazione dei soli dati conserva il marker per il fencing | Contratto presente nel codice; provider e accountability da verificare |
| Health-data erasure job/tombstone | Firestore server-only | Richiesta esplicita dopo revoca | **30 giorni dopo completion** come soglia iniziale; i record senza prova di epoch possono permanere oltre | Cron giornaliero con prova transazionale di `erasedBeforeRevision`; senza prova, ricevuta conservata e nuovo tentativo differito di sette giorni | Contratto presente nel codice; indici e runtime live da verificare |
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

## Dismissione della telemetria client

Il client non invia report automatici degli errori a Sentry né a Firestore e non crea più code diagnostiche. Gli eventuali dati pregressi presso Sentry e i log dei servizi Firebase/Vercel richiedono verifiche separate nei rispettivi provider.

Le collection Firestore telemetriche pre-lancio sono fuori dal contratto client: le Rules negano lettura, query, creazione, aggiornamento e cancellazione anche all'owner con consenso attivo. Non si supportano i precedenti client né un loro upgrade `expireAt`. La retention nominale di 30 giorni resta nel maintenance Admin per eventuali record residui; il ritiro dell'accesso client non prova che il dataset live sia vuoto e non autorizza la rimozione del cleanup.

La cancellazione viene eseguita dal maintenance cron server-side già schedulato quotidianamente. La sweep usa Firebase Admin e interroga direttamente le tre collection group `telemetry_*` con pagine bounded da 400 documenti scaduti per query, senza enumerare preventivamente tutti gli utenti in memoria. La cancellazione filtra rigidamente i percorsi attesi `users/{uid}/telemetry_*/*`, ignora i risultati inattesi e può riprendere in modo idempotente all'invocazione successiva se il budget della Function termina prima di completare il ciclo.

Ogni delete usa una precondizione `lastUpdateTime`: se un errore aggregato riceve una nuova occorrenza e la sua scadenza viene estesa dopo la lettura, il batch non elimina il documento aggiornato e la sweep può ritentare alla successiva esecuzione. Un risultato inatteso fuori dai percorsi privati viene conteggiato ma non cancellato; in quel caso `completedCycle` rimane falso. Se il tempo residuo è insufficiente dopo una query, non si avvia il batch distruttivo.

## Verifiche Production e coerenza Privacy — checkpoint del 10 ottobre 2026

- **Verificato (GitHub/servizi):** sul commit `28c852cdf11ef9ea54130eda3329b73b2cb07054` il [gate canonico](https://github.com/gernotfound/logbook/actions/runs/38042438321), la [riconciliazione Firestore](https://github.com/gernotfound/logbook/actions/runs/38042623399) e il [deploy Firebase Hosting](https://github.com/gernotfound/logbook/actions/runs/38042640956) sono verdi. La lettura live della riconciliazione Firestore ha confermato Rules corrispondenti al repository e tutti gli indici/field override desiderati `READY`. Vercel Production (`dpl_EV6K1jbqMR2VUnTLrWMNcuLg8Ad3`) è READY sullo stesso SHA. Il gate verifica anche i test Rules e le regressioni della retention.
- **Verificato da Codex/Work, come riportato al product owner (evidenza esterna):** tre conteggi aggregati nell'intero database Firestore Production `(default)` il 10 ottobre, senza filtri per utente o scadenza: `telemetry_errors: 0`, `telemetry_events: 0`, `telemetry_anomalies: 0`. Non risultavano documenti legacy, inclusi quelli senza `expireAt`; non serve alcuna bonifica del dataset osservato. Il dato è valido al momento delle letture, non è un controllo continuo né una prova di eliminazione da parte del cron.
- **Verificata la coerenza *testuale* della sorgente dell'informativa inclusa nel frontend distribuito:** `src/pages/PrivacyPolicy.tsx` descrive la retention di 30 giorni delle raccolte Firestore legacy e la pulizia periodica server-side, il record tecnico di recovery post-cancellazione programmato a 30 giorni e la retention Sentry dipendente dalla configurazione del fornitore. Nel checkpoint del 10 ottobre queste affermazioni erano state confrontate con i relativi sorgenti, incluso l'helper client `src/lib/telemetry/retention.ts` poi ritirato. Il contratto corrente va letto in `src/lib/storageIntegrity.ts`, `server/telemetryRetention.ts`, `server/accountDeletion/retention.ts` e `vercel.json`; i precedenti moduli di coda client sono stati ritirati. Al momento di quel checkpoint non era stata cambiata l'informativa pubblica né `LEGAL_VERSIONS.privacy`; tale rilievo storico precede la successiva dismissione Sentry e l'aggiornamento dell'informativa. Il successo del deploy Hosting non sostituisce un controllo visivo del testo nell'interfaccia, né una revisione giuridica.
- **Ancora non verificato:** l'esito di un ciclo reale del nuovo algoritmo. La finestra dell'11 ottobre 2026 è trascorsa e i log storici non erano più disponibili nel controllo documentato nel `docs/operations/external-services-register.md`; non va presentata come verifica ancora eseguibile. Osservare una successiva esecuzione del cron mentre i log Vercel sono disponibili, cercando `[account-deletion-cron] completed`, `telemetryDocumentsScanned`, `telemetryPurged`, `telemetryUnexpectedDocuments`, `telemetryCycleCompleted` ed eventuali errori. Con database vuoto sono normali zero documenti esaminati o eliminati. Un ciclo vuoto riuscito non dimostra che una delete reale/race concorrente abbia funzionato in Production.
- **Ancora non verificato / attività pre-pilot:** eventuale cancellazione degli eventi storici Sentry, log e retention Firebase/Vercel, pubblicazione completa dei contenuti legali, contatti del titolare e valutazione/approvazione legale. Le nuove scritture di vecchi client con `expireAt` non sono state generate deliberatamente in Production: Security Rules e test le coprono, ma manca un'osservazione runtime di quel caso.

Nel solo checkpoint storico del 10 ottobre, per il perimetro **retention Firestore legacy**, erano state riferite la configurazione e l'assenza di documenti da migrare; la prova runtime dell'esecuzione programmata resta aperta. Questo checkpoint tecnico non certifica conformità GDPR, cancellazione effettiva di documenti inesistenti o retention di fornitori esterni.

La retention applicativa non dipende dalle policy Firestore TTL native: il maintenance cron usa Firebase Admin e resta quindi compatibile con il piano Firebase corrente senza introdurre un requisito di billing solo per la cancellazione telemetrica.
