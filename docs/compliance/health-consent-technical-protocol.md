# Revoca consenso salute — protocollo tecnico distribuito, gate legale pre-pilot aperto

**Fonte normativa tecnica:** [AGENTS](../../AGENTS.md) e [Consenso salute](../../.agents/rules/health-consent.md). Le prove delle PR storiche citate sotto non attestano la release attuale; l'indice compliance mantiene separate approvazione legale e verifiche tecniche.

Decisione corrente del product owner (6 novembre 2026): dopo la revoca nessuna funzione fitness è accessibile. Il backup JSON è facoltativo **prima della conferma**; la revoca account trusted accoda automaticamente la cancellazione dei dati applicativi mantenendo Firebase Auth. Una nuova accettazione esplicita può avviare soltanto un archivio vuoto dopo completamento verificato. Non esiste una modalità fitness ridotta.

## Confine autorevole

`health_consent_withdrawals/{uid}` è esclusivamente server-managed. Il backend autentica UID Firebase, verifica App Check limited-use e origini consentite. Lo stato `withdrawn` blocca tramite Security Rules tutte le nuove scritture della zona fitness e della telemetria; le letture dirette dell'owner sono bloccate in stato revocato anche per client obsoleti; per esercitare i diritti e produrre il backup cloud il server espone un endpoint separato autenticato e paginato, senza aprire Firestore ai vecchi client. `active` richiede una nuova scelta esplicita con versioni legali correnti, mai un ripristino automatico da backup o da `legalConsent` client. La registrazione della revoca è idempotente. La revoca trusted accoda nella stessa transazione un job di cancellazione dei dati business; il record dell'account Firebase Auth rimane. L'account deletion separata elimina anche l'identità di accesso.

## Verifiche ancora richieste prima del pilot con utenti reali

- Enforcement locale e cross-tab del blocco; avvio autenticato, offline, dispositivi secondari e sospensione di writer in-flight.
- Riattivazione di un account revocato: il fence di generazione è implementato nelle Rules e coperto da regressioni; verificare il percorso autenticato multi-dispositivo e l'assenza di replay dei journal precedenti nel runtime Production.
- Esportazione/diritti/account deletion anche in caso di backend indisponibile, senza dichiarare successo non verificato.
- Le PR #826 e #829 sono integrate nel repository; le evidenze storiche di CI/deploy non provano lo smoke autenticato coordinato nel runtime Production corrente.
- Validazione con avvocato: basi art. 6/9 GDPR, libertà del consenso, conseguenze del diniego, conservazione residua dopo revoca, informativa, DPIA, DPA/trasferimenti.

La PR #366 e le successive PR #826/#829 sono integrate. I commit di rilascio storici e i test automatizzati non certificano da soli il comportamento live né le configurazioni dei fornitori.

## Confine export dopo revoca (implementato; smoke autenticato aperto)

Durante la revoca, tutte le letture dirette delle collection `users/{uid}` sono negate dalla Security Rule anche a client obsoleti. `api/health-consent-export` verifica origin, Firebase UID, App Check limited-use e stato revocato ad ogni pagina; il server invia il root e le collection mensili in pagine di massimo due documenti, senza esporre documenti amministrativi. Il client verifica gli ID mensili, evita cursori ripetuti e costruisce il Backup Schema 3 con copertura `cloud-and-device` soltanto dopo la lettura completa. Se la UI è sospesa ma il server ha già accettato un nuovo consenso su un altro dispositivo, lo stato locale non basta a selezionare il trasporto: il client legge lo stato trusted attuale e usa l'endpoint Admin **solo se il server è `withdrawn`**; quando è `active`, usa la normale lettura owner Firestore, senza bypass Admin. Il controllo si applica anche alla riaccettazione in corso e allo stato `stale-request` senza trattarli come prove sufficienti dello stato del server. Se manca il server o il dispositivo è offline, il percorso esistente richiede la conferma esplicita per esportare il solo archivio locale, marcato parziale.

Il parser dei metadati cloud accetta e valida `_sync.writer.consentRevision` opzionale nel Sync Protocol 3, coerentemente con il writer e le Rules: un account riattivato con revisione positiva non deve essere classificato erroneamente come documento incompatibile. Valori malformati o fuori range vengono rifiutati senza conversione permissiva.

Le regole di accesso e il fence delle revisioni sono stati integrati con la PR #366 e successivamente rafforzati. Il job automatico può impedire l'export rights-only completo dopo la revoca: proporre il backup **prima** della conferma e non promettere una copia cloud completa durante un job attivo. Il collaudo con account fittizio autenticato, la revisione giuridica e la retention residua restano da validare prima del pilot.

## Cancellazione automatica dei dati dopo revoca trusted (integrata; smoke autenticato aperto)

La revoca confermata accoda automaticamente il job `health_data_erasures/{uid}` nella stessa transazione che aggiorna il consenso. Il worker cancella root e raccolte private in modo riprendibile via API/cron, senza un secondo comando manuale; l'autorizzazione iniziale richiede Auth e App Check trusted. L'eliminazione di Firebase Auth è esplicitamente vietata in questo percorso. Durante il job non sono consentite nuove accettazioni; il server aggiorna `revision` e `erasedBeforeRevision` del record consenso solo dopo verifica di assenza di residui.

La ricevuta completa non basta a garantire la cancellazione di copie su dispositivi offline: il client richiedente esegue il purge owner-scoped e lo sign-out solo dopo conferma trusted `complete`. Se il job completo è stato eliminato dopo 30 giorni, il GET ricostruisce la stessa prova soltanto dalla revisione finale e da `erasedBeforeRevision` nel record consenso server, verificando anche UID, stato `withdrawn` e assenza della chiave cloud. Nessuna prova locale o ricevuta obsoleta autorizza il purge. Il GET trusted del consenso espone anche `erasedBeforeRevision`: un archivio con journal pendente della generazione cancellata **non può essere reinviato né recuperato nel business state**. I dati originali restano protetti dai fence finché il purge owner-scoped è autorizzato dalla prova server; non promettere recupero fitness dopo l'erasure. Il job parziale o una pulizia locale fallita sono comunicati come tali. La retention della ricevuta server completa ha una soglia iniziale di 30 giorni con sweep cron; se manca la prova transazionale dell'epoch, il cron conserva la ricevuta e ne rinvia il tentativo di ritiro di sette giorni, senza bloccare indefinitamente le ricevute successive. Il marcatore minimo di consenso rimane per la protezione dagli epoch vecchi. Il collaudo autenticato e multi-dispositivo resta distinto dalla CI; la revisione legale resta aperta. Non esiste un cloud Test isolato: rispettare [limiti e perimetro dei collaudi](../operations/e2e-reliability.md), senza usare Production come sandbox distruttiva.

## Fence delle generazioni di consenso

Dopo la prima revoca, il marker server non viene eliminato al re-consenso: la revisione cresce monotonicamente. Le Rules accettano un nuovo `sync_control` e le scritture con `_sync.writer` soltanto se dichiarano esplicitamente `consentRevision` uguale alla revisione server `active`. Un vecchio client Protocol 3 privo di tale campo non può né ri-registrare la replica né scrivere un vecchio journal. Il parser TypeScript riconosce il campo opzionale senza incrementare artificialmente il Sync Protocol 3.

Il client conserva la revisione in IndexedDB e nel marker browser. Il journal precedente resta isolato; se la revisione è coperta da `erasedBeforeRevision`, **non è eleggibile per una ripresa**, neppure dopo nuovo consenso. La replica di una nuova generazione apre soltanto un archivio vuoto dopo prova trusted di completamento e cleanup locale. Il collaudo autenticato multi-dispositivo resta obbligatorio prima del pilot con utenti reali.

## Quarantena non distruttiva del journal locale

Il client mantiene `consentRevision` opzionale nel Local Envelope V5. All'apertura di un account riattivato, la revisione locale può avanzare solo se non esistono pending operation della revisione precedente; il passaggio è un update IndexedDB atomico. I pending precedenti restano nel loro archivio originale e impediscono l'accesso fitness (stato `recovery-required`); l'utente vede la necessità di esportare i dati, non un successo sync. Il writer `_sync` e il registro `sync_control` presentano la stessa revisione verificata dal server. Le Rules rifiutano vecchi writer/registri anche se l'account è tornato `active`.

La quarantena non autorizza un purge prima della prova trusted. Il recupero esplicito del journal può essere valutato soltanto per revisioni **non cancellate** e dopo un controllo server aggiornato; quando `erasedBeforeRevision` copre la generazione, la precedenza è alla cancellazione protetta, senza ricostruzione del journal. Le verifiche manuali multi-device rimangono aperte.

Il logout e il purge locale **ordinari** preservano il marker di una revoca/riaccettazione non ancora confermata dal server e i journal offline ancora pendenti dopo una revoca o appartenenti alla generazione precedente. Questi casi falliscono prima di `auth.signOut()` e prima del purge, preservando credenziali e dati per la riconciliazione. La cancellazione esplicita dell'account rimane un'operazione distinta e usa il percorso server-mediated con prova del completamento.

Anche il marker browser strict della revisione fa parte del SessionSnapshot locale, per cui una vecchia tab perde la validità della propria sessione quando la revisione cambia in un'altra tab. Il marker revoca `pending/withdrawn` è incluso nello stesso controllo; la sua mutazione invalida write in-flight senza affidarsi a React.

## Ospite (solo dispositivo)

In assenza di account Firebase, il marker `logbook:v2:guest:health-consent-withdrawal` è durevole nel browser: blocca mutazioni, nasconde tutto il fitness e invalida le sessioni delle altre schede. La revoca ospite comporta cancellazione protetta dell'archivio e chiusura della sessione. Non è più possibile riaccettare sullo stesso archivio revocato: un nuovo accesso ospite crea una nuova generazione e richiede il consenso previsto dal flusso iniziale. Nessun backend viene chiamato per il consenso ospite. Le Rules Firestore restano il confine dei soli account autenticati.

## Divieto di ripresa delle generazioni cancellate

Il recupero del journal non è un modo per aggirare il job di erasure. Anche se una copia locale conserva pending storiche durante una revoca pendente o un errore di rete, `erasedBeforeRevision` è un limite trusted: se copre la generazione, non si possono creare nuove operazioni da quelle copie. La pulizia avviene con il lock dell'owner e solo dopo una prova trusted di completamento valida, anche quando la ricevuta tecnica è scaduta; la nuova accettazione parte da un archivio vuoto. Non proporre export/ripristino dei dati cancellati come funzionalità di riaccettazione.
## Concorrenza fra revoca e nuove scelte

Ogni richiesta trusted confronta la revisione attesa **dentro** la transazione Firestore, con idempotenza limitata alla stessa transizione. Una risposta in ritardo non può sovrascrivere uno stato locale più recente né riaprire dati di una generazione cancellata. La revoca offline conserva il marker pending fino a riconciliazione server; non può essere sostituita da una riaccettazione offline del vecchio archivio. Il re-consenso è ammesso soltanto dopo job `complete`, controllo dell'epoch e purge della generazione precedente. Errori, conflitti o sessioni cambiate richiedono riconciliazione, non consenso implicito.
**Residuo prima del pilot con utenti reali:** verifica effettiva multi-dispositivo, smoke autenticato backend/Rules/Hosting coordinati, verifica accessibilità UI/viewport e approvazione della base giuridica, del trattamento dopo revoca e dei contatti/documenti privacy. CI, codice e compliance non sono equivalenti.

## Revoca offline e nuovo consenso (contratto corrente, 6 novembre 2026)

La revoca offline registra l'intento sul dispositivo e sospende immediatamente le scritture fitness. Una nuova accettazione **non può riattivare i dati precedenti né localmente né nel cloud** mentre la revoca o la cancellazione automatica sono pendenti. Non è supportato il precedente percorso di riaccettazione solo-dispositivo con marker `offline-reaccepted`.

Alla riconnessione, la revoca pendente viene confermata dal backend e il job di cancellazione viene ripreso fino a completamento verificato. La nuova accettazione è consentita soltanto dopo la prova trusted del completamento e la pulizia protetta dell'archivio locale della generazione cancellata. Gli archivi vecchi non vengono riprodotti nel journal di una nuova generazione. Stato non verificabile, errori di rete, vault bloccato o cancellazione interrotta non equivalgono ad autorizzazione.

La PWA offre sempre l'esportazione **facoltativa prima della revoca**. Per eventuali dispositivi offline, copie esterne e backup di fornitori valgono i limiti nell'informativa. Questa sezione sostituisce il precedente protocollo di riaccettazione offline, non introduce supporto per installazioni pre-lancio.
