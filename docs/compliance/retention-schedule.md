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

## Diagnostica client e servizi tecnici

TheLogBook gestisce errori, anomalie locali, consenso, logout e recupero senza inviare report diagnostici automatici a fornitori esterni. Non sono presenti code di invio né raccolte o routine server dedicate alla telemetria di pre-lancio.

Firebase Hosting, Authentication, Firestore, App Check e le API trusted Vercel possono generare log tecnici di servizio: la durata effettiva e gli adempimenti contrattuali dei rispettivi fornitori restano soggetti a verifica in console e ad approvazione legale.

La cancellazione account e la cancellazione dei soli dati salute continuano a utilizzare job trusted, lease, verifica delle sottoraccolte inattese e ricevute di recovery con le rispettive politiche di conservazione. Il ritiro del codice diagnostico non costituisce attestazione dell'assenza di eventuali vecchi documenti nel database Production: un'eventuale bonifica del dataset deve essere verificata ed eseguita separatamente, senza cancellare le raccolte attive o i dati di configurazione del servizio.
