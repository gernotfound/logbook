# Retention schedule — TheLogBook

> Policy di conservazione da approvare prima del pilot e mantenere allineata al comportamento reale. Le durate di progetto non sono "imposte dal GDPR": devono essere motivate da finalità, necessità, rischio e obblighi applicabili.

**Fonte tecnica:** [AGENTS](../../AGENTS.md), [Telemetria e privacy](../../.agents/rules/telemetry-and-privacy.md) e [Consenso salute](../../.agents/rules/health-consent.md). I checkpoint Production sotto sono osservazioni storiche datate, da non usare come prova live attuale; le questioni giuridiche e i segnaposto restano aperti.

## Decisione pubblicazione con segnaposto — 12 ottobre 2026

Per la revoca esplicita dei dati salute, la UI non cancella automaticamente gli archivi locali e cloud: sospende le funzionalità, mantiene accessibili export e cancellazione, e può consentire nuovo consenso esplicito. Il codice offre una richiesta **distinta di cancellazione dei soli dati business** dopo revoca confermata, senza eliminare l'account, ma tale richiesta non viene eseguita automaticamente al momento della revoca. La retention **dopo la revoca** non è ancora giustificata né approvata sul piano giuridico: **`[DEFINIRE_FINALITÀ_BASE_GIURIDICA_DURATA_E_CANCELLAZIONE_POST_REVOCA]`**. Non confondere la tutela tecnica contro una perdita dati o una cancellazione prematura con l'autorizzazione giuridica a conservare indefinitamente. Il product owner ha autorizzato il merge con segnaposto; resta da completare prima di trattare dati reali in un pilot.

## Tabella

| Categoria | Storage | Trigger iniziale | Target/retention | Cancellazione | Stato tecnico |
|---|---|---|---|---|---|
| Dati core account | Firestore + copia locale owner-scoped | Creazione/inserimento | Per la durata dell'account attivo e finché necessari al servizio; eventuale policy inattività `[TO_DECIDE]`; la conservazione postrevoca richiede distinta base valida `[TO_VALIDATE]` | Account deletion oppure cancellazione dei soli dati dopo revoca server confermata; cleanup locale subordinato a prova completion | Flussi distinti implementati; revoca da sola non cancella |
| Dati guest | IndexedDB/localStorage dispositivo | Primo uso | Finché l'utente li mantiene o li elimina/migra | Azioni locali / browser OS / migrazione | Implementato |
| Copia business del consenso legale | `UserData.legalConsent` nel root cifrato | Accettazione | Finché serve a dimostrare la versione accettata e per la durata pertinente del rapporto/obblighi | Definire dopo cessazione: `[TO_VALIDATE]` | Persistito, retention post-account da definire |
| Consenso salute autorevole | `health_consent_withdrawals/{uid}`, server-only | Prima accettazione e successive decisioni | Stato/revisione e versioni legali correnti; durata giuridica `[TO_VALIDATE]` | Separato dalla copia business; la cancellazione dei soli dati conserva il marker per il fencing | Contratto presente nel codice; provider e accountability da verificare |
| Health-data erasure job/tombstone | Firestore server-only | Richiesta esplicita dopo revoca | **30 giorni dopo completion** come soglia iniziale; i record senza prova di epoch possono permanere oltre | Cron giornaliero con prova transazionale di `erasedBeforeRevision`; senza prova, ricevuta conservata e nuovo tentativo differito di sette giorni | Contratto presente nel codice; indici e runtime live da verificare |
| Deletion job/tombstone | Firestore server-only | Richiesta cancellazione | 30 giorni dopo completion | Cron giornaliero | Contratto implementato; runtime cron da verificare periodicamente |
| Log Vercel | Vercel | Request/function event | Piano **Hobby** verificato: **1 ora di consultazione dei runtime log** secondo il fornitore; ciclo di conservazione completo `[VERIFY]` | Policy Vercel, altre copie da verificare | Finestra documentata, non attestazione di cancellazione |
| Log Firebase/Google Cloud | Google | Evento servizi | `[VERIFY_SERVICE_CONFIGURATION]` | Policy servizio | Esterno da verificare |
| Firebase Authentication — dati identificativi | Google | Registrazione/login | Dati dell'utente fino a cancellazione account; secondo [Google](https://firebase.google.com/support/privacy/) eliminati da sistemi live/backup entro 180 giorni dall'istruzione | Flusso account deletion + policy provider | Documentazione fornitore verificata, esito singola cancellazione non osservato |
| Firebase Authentication — IP di sicurezza | Google | Autenticazione | Alcune settimane, secondo [Google](https://firebase.google.com/support/privacy/) | Policy servizio | Durata esatta/configurazione del tenant non verificata |
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

La cancellazione account e la cancellazione dei soli dati salute continuano a utilizzare job trusted, lease, verifica delle sottoraccolte inattese e ricevute di recovery con le rispettive politiche di conservazione. Il 5 novembre 2026 il product owner ha riportato tre interrogazioni Firestore `COUNT` senza filtri su collection group e sottoraccolte, con risultati pari a zero per tutte le raccolte diagnostiche pre-lancio ritirate (evidenza manuale registrata nella issue #809). Questo è un controllo puntuale, non una garanzia permanente sul contenuto di Production e non autorizza reset generali.

## Evidenza aggiuntiva fornitori (5 novembre 2026)

I limiti di consultazione dei runtime log Vercel sono [specificati per piano](https://vercel.com/docs/logs/runtime) e non sono automaticamente un termine generale di cancellazione di ogni log o dato del servizio. Il [Cloud Data Processing Addendum Google](https://cloud.google.com/terms/data-processing-addendum) prevede specifiche tempistiche di eliminazione del customer data su istruzione, **non** una durata universale di conservazione degli archivi TheLogBook né prova dei tempi per ogni servizio Firebase. Conservare i valori `[VERIFY_*]` fino a verifica del piano e dei trattamenti effettivi, inclusi backup e residenze dati. La revoca e le eventuali modifiche al runtime sono tracciate in [issue #824](https://github.com/gernotfound/logbook/issues/824).

## Istruttoria tecnica e decisione postrevoca — issue #824 (5 novembre 2026)

**Stato: NON approvato per persone esterne.** La seguente mappa descrive comportamento esistente verificato nel repository allo SHA `bafc0970b77f9c68ac7be867ad93849468127fc9` e obblighi da valutare. Non istituisce una nuova base giuridica, una durata, un consenso, né autorizza la cancellazione di dati reali. Le informazioni pubbliche della PWA dovranno riflettere la policy solo dopo validazione e implementazione.

| Dataset / prova | Comportamento tecnico attuale | Trattamento dopo revoca e verifica giuridica necessaria |
|---|---|---|
| `users/{uid}` e `history_months`, `nutrition_months`, `sync_control` | Il backend trusted registra `withdrawn` e le Rules interrompono l'accesso business, ma **non eliminano** root o sottoraccolte; la cancellazione è una richiesta separata | Non è dimostrata una base Art. 6 **e**, per le categorie particolari, una condizione Art. 9 per proseguire la conservazione dopo revoca. Determinare finalità residua, necessità e cancellazione senza ritardo ingiustificato, se non sussiste altra base valida |
| Archivio cifrato IndexedDB, bozze, journal e marker locali owner-scoped | Sospensione immediata sul dispositivo; i pending vengono preservati e non possono essere ripubblicati automaticamente. Altri dispositivi offline possono restare con copie preesistenti | Nessun purge indiscriminato a revoca pendente: definire l'erasure locale dopo una prova server e le limitazioni per dispositivi che non tornano online; informare accuratamente l'interessato |
| `user_data_keys/{uid}` e chiavi locali | La chiave account cifrata rimane finché il job non verifica la rimozione dei dati; nella cancellazione esplicita la chiave cloud è eliminata atomicamente con la completion; il purge locale avviene dopo ulteriore prova | Preservare sicurezza e capacità di ripresa durante una cancellazione in corso; non usare la necessità di recovery per autorizzare conservazione senza limite dei dati fitness |
| `health_consent_withdrawals/{uid}` | Registro trusted con revisione monotona, revoca e `erasedBeforeRevision`; persiste dopo cancellazione dei soli dati, viene ritirato nel lifecycle di cancellazione account | Distinguere le prove minime del consenso/revoca dai dati fitness. Definire dati effettivamente necessari, Art. 6 per accountability/sicurezza, accessi e durata motivata, senza conservazione indiscriminata |
| `health_data_erasures/{uid}` | Job idempotente, paginato, con verifica dei residui; ricevuta `complete` prevista per 30 giorni, poi sweep con verifica epoch; in assenza di prova un retry è rinviato di 7 giorni | Verificare che il periodo della ricevuta e le possibili estensioni siano necessari e documentati. Sono **durate implementate**, non periodi imposti dal GDPR |
| Firebase Authentication | Mantiene UID, identificativi e accesso dopo la cancellazione dei soli dati; l'eliminazione totale dell'account è un percorso distinto | Individuare base Art. 6 e retention dell'identità per account attivo/inattivo, separandola da dati salute. Per Auth Google pubblica trasferimento/processing USA e proprie scadenze dopo la cancellazione |
| Backup JSON/CSV già scaricati, dispositivi offline, copie/log provider | L'app non può cancellare file esportati o dispositivi perennemente offline; configurazione di backup/PITR Firestore e retention complete dei fornitori non verificate | Distinguere i file sotto il controllo dell'interessato dalle copie del titolare/fornitori; verificare se esistono backup, tempi e procedure di cancellazione/restore; non garantire eliminazioni impossibili |

### Decisione giuridica e di prodotto ancora indispensabile

1. **Basi giuridiche per finalità:** validare la necessità contrattuale Art. 6(1)(b) dichiarata nell'informativa per il servizio e per l'account; individuare separatamente la condizione Art. 9 per le informazioni che rivelano salute. La checkbox Art. 9 non costituisce una base Art. 6. Valutare se l'obbligo di consenso per *tutte* le funzionalità fitness rispetti la libertà della scelta ai sensi dell'Art. 7(4) e delle [linee guida EDPB 05/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_it).
2. **Destinazione degli archivi alla revoca:** l'[Art. 17(1)(b) GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/?locale=it) richiede cancellazione senza ingiustificato ritardo quando il consenso è revocato e manca un'altra base giuridica valida. **Raccomandazione preliminare:** non adottare conservazione indefinita per facilitare la riaccettazione; valutare un percorso di cancellazione dei dati business collegato alla revoca, riusando il job e i fence esistenti. Eventuali finestre per export o ulteriori conservazioni richiedono giustificazione, modalità e durata approvate; non inventare scadenze.
3. **Operatività e recovery:** prima di implementare il percorso scelto definire cosa avviene per revoca offline pendente, richiesta di export, concorrenza fra dispositivi/schede, riaccettazione, chiave cloud, dati parzialmente eliminati, marcatori di consenso, account deletion e backup provider. Un job distruttivo non parte dalla sola revoca locale non confermata, né da un'interpretazione di client obsoleti.
4. **Fornitori e informativa:** risolvere il DPA per Vercel Hobby (piano verificato sul tenant il 5 novembre 2026), controllare la clausola Model Training/opt-out dei Termini Vercel e le localizzazioni/trasferimenti di Firestore e servizi; completare i criteri di retention e le garanzie specifiche. Vedi [registro fornitori](vendor-transfer-register.md).
5. **Gate:** ottenere validazione privacy/legale competente delle scelte, adeguare UI, backend e testi pubblici nello stesso cambiamento con regressioni CRITICAL, versioni legali e gate canonico su SHA candidato. Prima di allora resta NO-GO per l'attivazione di persone esterne.
