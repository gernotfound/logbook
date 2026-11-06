# Conservazione e cancellazione dei dati — TheLogBook

> **Stato: policy legale NON approvata per utenti esterni (6 novembre 2026, issue [#824](https://github.com/gernotfound/logbook/issues/824)).** I tempi tecnici già implementati non sono termini imposti dal GDPR. Per ogni trattamento occorrono finalità, base giuridica, necessità, accessi e durata/criterio motivati e verificabili.
>
> **Contratto tecnico implementato:** [PR #826](https://github.com/gernotfound/logbook/pull/826) e [PR #829](https://github.com/gernotfound/logbook/pull/829), integrate in `main`. Cancellazione automatica dei dati applicativi alla revoca trusted, non dell'identità Firebase Authentication. La prova su dispositivi reali e la verifica delle copie provider sono ancora aperte.

**Fonti:** [Consenso salute](../../.agents/rules/health-consent.md), [Account](../../.agents/rules/account-lifecycle.md), [Cifratura](../../.agents/rules/secure-storage.md), [Telemetria](../../.agents/rules/telemetry-and-privacy.md), [protocollo tecnico](health-consent-technical-protocol.md), [registro fornitori](vendor-transfer-register.md). Le precedenti proposte di cancellazione su secondo pulsante e riaccettazione offline sul vecchio archivio sono storiche, conservate in Git e non più vigenti.

## Revoca: decisione corrente e limiti

- **Prima:** la PWA offre un backup JSON facoltativo; non condiziona l'esercizio della revoca.
- **Account online:** la stessa transazione server registra il consenso `withdrawn` in `health_consent_withdrawals/{uid}` e accoda `health_data_erasures/{uid}`. Il worker/cron cancella root e raccolte private, verifica anche residui inattesi e rimuove la chiave cloud soltanto nel completamento lease-fenced. Le funzioni fitness sono sospese subito; Firebase Auth resta distinta.
- **Offline:** il dispositivo registra la revoca locale pending e blocca mutazioni e replica; il cloud non è dichiarato cancellato. Solo ricevuta `complete`, revisione e assenza della chiave cloud attestate dal server autorizzano il purge locale owner-scoped. Failure e dispositivi non riconnessi richiedono recovery e non provano cancellazione universale.
- **Ospite:** cancellazione locale protetta e fine sessione, senza backend.
- **Dopo:** nuova accettazione solo su archivio vuoto dopo cancellazione completa. Niente riattivazione o replay delle generazioni eliminate. L'export rights-only non può attestare una copia cloud completa se la cancellazione è in corso.

La **cancellazione account** è un flusso separato che elimina anche l'identità Auth con i suoi gate e ricevute. Un dato cifrato resta dato personale ove attribuibile all'interessato; la cifratura non giustifica conservazione postrevoca. Non confondere un periodo di recovery tecnico con una base autonoma per conservare contenuti fitness.

## Matrice dei dataset e delle durate

| Dataset / copia | Luogo e scopo tecnico | Trigger di cancellazione / retention implementata | Questione giuridica o live da verificare |
|---|---|---|---|
| Allenamenti, nutrizione, misurazioni, profilo e root `users/{uid}`, shard mensili, `sync_control` | Firestore cifrato e proiezione locale owner-scoped; servizio fitness | Revoca server confermata accoda **automaticamente** il job; account deletion è alternativa distinta; client locale dopo ricevuta completa | Base Art. 6 e condizione Art. 9 ove applicabile, tempi reali di erasure e assenza residui, policy di account inattivi |
| Dati guest, bozze, journal e vault | IndexedDB/localStorage nel dispositivo | Revoca guest con purge protetto; revoca account con fence e cleanup solo dopo prova server; i dispositivi definitivamente offline non sono cancellabili a distanza | Confini delle copie personali, gestione richieste dell'interessato e informative senza promesse impossibili |
| `UserData.legalConsent` | Campo nel root business cifrato | Segue la cancellazione del root business | Distinguere dal marker trusted; prova e retention residua non dedotte dal campo business |
| `health_consent_withdrawals/{uid}` | Firestore server-only: prova minima di scelta, revisione e `erasedBeforeRevision` contro replay | Conservato dopo erasure business; lifecycle distinto nella cancellazione account | Finalità, minimizzazione, base Art. 6 e, se pertinente, Art. 9, durata e accessi da approvare |
| `health_data_erasures/{uid}` | Job/ricevuta server-only, lease, retry e verifica | Job completo: `purgeAfter` a **30 giorni**; cron verifica l'epoch prima di rimuovere. Prova assente: conserva la ricevuta e posticipa il retry di **7 giorni** | Giustificare durata tecnica, eccezioni e possibili estensioni; non è una retention dei dati salute |
| `account_deletions/{uid}` | Job/ricevuta server-only per cancellazione account | Soglia tecnica indicata di **30 giorni** dopo completion, sweep cron; verificare il workflow effettivo | Finalità e retention autonome della prova e di eventuali copie residue |
| Firebase Authentication (UID, email, provider) | Servizio Google per accesso e gestione dell'identità | L'erasure salute **non** cancella Auth; account deletion sì. Google descrive eliminazione Auth da live/backup entro **180 giorni** dopo cancellazione utente | Base Art. 6, durata per account attivo/inattivo, trattamento in USA e condizioni contrattuali |
| IP/log di Authentication e log Firebase/Hosting/App Check | Metadati di sicurezza/servizio Google | Google indica IP Auth per **alcune settimane**; altri servizi `[VERIFY]` | Durate, accessi, ruoli, subprocessori e copie specifiche del servizio/tenant |
| API trusted e log Vercel | Metadati di richieste e funzioni; backend/cron | Piano Hobby osservato il 5–6 novembre 2026; **1 ora di consultazione** log runtime secondo la documentazione di piano, non prova di eliminazione completa | DPA Art. 28 Hobby, location di tutti i dataset, retention effettiva, accessi e preferenza AI da verificare |
| Backup/PITR Firestore e copie provider | Eventuali snapshot/restore fuori dal normale job applicativo | Esistenza/configurazione, durata e ripristini `[VERIFY_LIVE]` | Testare che un restore non reintroduca dati già cancellati; verificare tempi e procedure del fornitore |
| Backup JSON/CSV scaricati dall'interessato | File esterni non sotto il controllo della PWA | Non cancellabili a distanza dall'app | Informare chiaramente che un export facoltativo è in chiaro e sotto custodia dell'utente |
| Richieste privacy/supporto e case file | Canale e archivio organizzativo da individuare | `[DEFINE_AND_VALIDATE]` | Identità, base giuridica, dati minimizzati, accessi, termini e cancellazione del fascicolo |

Le indicazioni pubbliche del fornitore descrivono il **servizio** e non certificano la specifica configurazione TheLogBook. Fonti puntuali e limiti sono riportati nel [registro fornitori](vendor-transfer-register.md). Le soglie del codice e gli stati osservati in PR non dimostrano esecuzioni reali nel tenant.

## Matrice delle finalità da validare

| Trattamento | Ipotesi da verificare professionalmente | Dopo la revoca |
|---|---|---|
| Erogazione dei servizi fitness, misurazioni, note e alimentazione | Art. 6(1)(b) ove effettivamente necessario; Art. 9(2)(a) solo ove il dato riveli salute e il consenso sia valido, libero ed esplicito | Il contratto applicativo avvia erasure senza secondo clic. Nessuna conservazione per mera possibile riaccettazione |
| Identità e gestione account Auth | Finalità autonoma e relativa base Art. 6, distinta dalle categorie particolari salute | Auth persiste finché non è richiesta la cancellazione account; durata e altri obblighi da motivare |
| Registro minimo di consenso/revoca e revisioni anti-replay | Accountability, sicurezza e difesa da richieste obsolete: individuare base Art. 6 e valutare Art. 9 ove pertinente | Solo campi indispensabili, accessi limitati e criterio di cancellazione approvato |
| Ricevute/job di erasure e account deletion | Idempotenza, completamento e retry protetto, non conservazione dei contenuti fitness | Valutare se soglie e rinvii tecnici siano proporzionati, motivati e documentati |
| Log e copie dei fornitori | Finalità di servizio/sicurezza distinte, ruoli e garanzie contrattuali da acquisire | Applicare le procedure realmente disponibili e comunicare eccezioni e limiti di cancellazione |

La revoca del consenso non giustifica di per sé il mantenimento di dati il cui trattamento dipendeva esclusivamente da esso. L'[art. 17(1)(b)](https://eur-lex.europa.eu/eli/reg/2016/679/oj) e le [Linee guida EDPB 05/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en) devono essere applicati insieme alle eventuali eccezioni effettivamente documentate. Il consenso Art. 9 non sostituisce una base Art. 6. Non assegnare tempi inventati alle prove residue.

## Regole operative e gate ancora aperti

- Allineare informativa, UI e procedure a **trigger effettivi** e termini provati, non alle intenzioni o alle capacità teoriche dei provider.
- Verificare live **regione Firestore, PITR, backup schedulati, restore e log**; impedire che un restore rianimi epoche cancellate. L'assenza di configurazione nel repository non dimostra che non esistano copie.
- Acquisire documenti e conferme pertinenti per **Google/Firebase e Vercel Hobby**: DPA/termini, ruoli, elenco subprocessori, trasferimenti extra SEE, retention, accessi e preferenza AI, senza presumere uso di dati salute per training.
- Documentare un canale monitorato per richieste e la retention dei fascicoli, oltre alle eccezioni legali e alla minimizzazione.
- Collaudare con dati **sintetici** e autorizzazioni appropriate revoca online/offline, worker incompleto, retry, ADK, purge e re-consenso multi-dispositivo. Non usare Production come sandbox distruttiva.
- Richiedere validazione professionale della matrice, libertà del consenso, Art. 28, eventuale DPIA e testi pubblici prima del primo utente esterno. **NO-GO** fino a chiusura documentata.

Il [gate di consenso](health-consent-release-gate.md) raccoglie i criteri di test; la [procedura diritti](data-subject-rights-procedure.md) regola richieste, prova del completamento e comunicazioni. La cronologia Git conserva le istruttorie antecedenti alla cancellazione automatica.
