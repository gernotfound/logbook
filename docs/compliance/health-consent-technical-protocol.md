# Revoca consenso salute — protocollo tecnico distribuito, gate legale pre-pilot aperto

Decisione UX del product owner (12 ottobre 2026): dopo la revoca nessuna funzione fitness è accessibile. La schermata di servizio sospeso consente informativa, diritti, esportazione, cancellazione account e nuova accettazione separata ed esplicita. Dopo la nuova accettazione, tutte le funzioni possono riattivarsi. Non esiste una modalità fitness ridotta.

## Confine autorevole

`health_consent_withdrawals/{uid}` è esclusivamente server-managed. Il backend autentica UID Firebase, verifica App Check limited-use e origini consentite. Lo stato `withdrawn` blocca tramite Security Rules tutte le nuove scritture della zona fitness e della telemetria; le letture dirette dell'owner sono bloccate in stato revocato anche per client obsoleti; per esercitare i diritti e produrre il backup cloud il server espone un endpoint separato autenticato e paginato, senza aprire Firestore ai vecchi client. `active` richiede una nuova scelta esplicita con versioni legali correnti, mai un ripristino automatico da backup o da `legalConsent` client. La registrazione della revoca è idempotente. Nessuna revoca cancella dati o account in modo implicito; l'account deletion elimina il marker come parte del suo cleanup.

## Verifiche ancora richieste prima del pilot con utenti reali

- Enforcement locale e cross-tab del blocco; avvio autenticato, offline, dispositivi secondari e sospensione di writer in-flight.
- Riattivazione di un account revocato: il fence di generazione è implementato nelle Rules e coperto da regressioni; verificare il percorso autenticato multi-dispositivo e l'assenza di replay dei journal precedenti nel runtime Production.
- Esportazione/diritti/account deletion anche in caso di backend indisponibile, senza dichiarare successo non verificato.
- CI canonica e deploy frontend/backend/Rules del release commit sono completati; resta lo smoke autenticato coordinato nel runtime Production.
- Validazione con avvocato: basi art. 6/9 GDPR, libertà del consenso, conseguenze del diniego, conservazione residua dopo revoca, informativa, DPIA, DPA/trasferimenti.

La PR #366 è integrata e il release commit `5d21dc0` è in Production; i controlli pre-pilot elencati non sono certificati dalla sola CI o dal deploy.

## Confine export dopo revoca (implementato; smoke autenticato aperto)

Durante la revoca, tutte le letture dirette delle collection `users/{uid}` sono negate dalla Security Rule anche a client obsoleti. `api/health-consent-export` verifica origin, Firebase UID, App Check limited-use e stato revocato ad ogni pagina; il server invia il root e le collection mensili in pagine di massimo due documenti, senza esporre documenti amministrativi. Il client verifica gli ID mensili, evita cursori ripetuti e costruisce il Backup Schema 3 con copertura `cloud-and-device` soltanto dopo la lettura completa. Se la UI è sospesa ma il server ha già accettato un nuovo consenso su un altro dispositivo, lo stato locale non basta a selezionare il trasporto: il client legge lo stato trusted attuale e usa l'endpoint Admin **solo se il server è `withdrawn`**; quando è `active`, usa la normale lettura owner Firestore, senza bypass Admin. Il controllo si applica anche alla riaccettazione in corso e allo stato `stale-request` senza trattarli come prove sufficienti dello stato del server. Se manca il server o il dispositivo è offline, il percorso esistente richiede la conferma esplicita per esportare il solo archivio locale, marcato parziale.

Il parser dei metadati cloud accetta e valida `_sync.writer.consentRevision` opzionale nel Sync Protocol 3, coerentemente con il writer e le Rules: un account riattivato con revisione positiva non deve essere classificato erroneamente come documento incompatibile. Valori malformati o fuori range vengono rifiutati senza conversione permissiva.

Le regole di accesso e il fence delle revisioni sono stati integrati con la PR #366. CI e deploy sono completati. Il collaudo con un account reale, la revisione giuridica e la retention postrevoca restano ancora da validare prima del pilot.

## Fence delle generazioni di consenso

Dopo la prima revoca, il marker server non viene eliminato al re-consenso: la revisione cresce monotonicamente. Le Rules accettano un nuovo `sync_control` e le scritture con `_sync.writer` soltanto se dichiarano esplicitamente `consentRevision` uguale alla revisione server `active`. Un vecchio client Protocol 3 privo di tale campo non può né ri-registrare la replica né scrivere un vecchio journal. Il parser TypeScript riconosce il campo opzionale senza incrementare artificialmente il Sync Protocol 3.

**Implementazione integrata con PR #366:** il client conserva la revisione in IndexedDB e nel marker browser, isola il journal precedente e offre un recupero attivabile esclusivamente con una scelta aggiuntiva esplicita. La riapertura della replica avviene dopo nuova conferma del server e controllo dei pending; il collaudo autenticato multi-dispositivo resta obbligatorio prima del pilot con utenti reali.

## Quarantena non distruttiva del journal locale

Il client mantiene `consentRevision` opzionale nel Local Envelope V5. All'apertura di un account riattivato, la revisione locale può avanzare solo se non esistono pending operation della revisione precedente; il passaggio è un update IndexedDB atomico. I pending precedenti restano nel loro archivio originale e impediscono l'accesso fitness (stato `recovery-required`); l'utente vede la necessità di esportare i dati, non un successo sync. Il writer `_sync` e il registro `sync_control` presentano la stessa revisione verificata dal server. Le Rules rifiutano vecchi writer/registri anche se l'account è tornato `active`.

La quarantena non autorizza la cancellazione dei pending originali. Il percorso di ripresa integrato con PR #366 archivia in un'unica transazione l'originale prima di ricostruire un journal autorizzato dall'utente rispetto al cloud; la PR è integrata, ma recovery manuale multi-device, controllo indipendente e diritti privacy rimangono da verificare prima del pilot.

Il logout e il purge locale **ordinari** preservano il marker di una revoca/riaccettazione non ancora confermata dal server e i journal offline ancora pendenti dopo una revoca o appartenenti alla generazione precedente. Questi casi falliscono prima di `auth.signOut()` e prima del purge, preservando credenziali e dati per la riconciliazione. La cancellazione esplicita dell'account rimane un'operazione distinta e usa il percorso server-mediated con prova del completamento.

Anche il marker browser strict della revisione fa parte del SessionSnapshot locale, per cui una vecchia tab perde la validità della propria sessione quando la revisione cambia in un'altra tab. Il marker revoca `pending/withdrawn` è incluso nello stesso controllo; la sua mutazione invalida write in-flight senza affidarsi a React.

## Ospite (solo dispositivo)

In assenza di account Firebase, il marker `logbook:v2:guest:health-consent-withdrawal` è durevole nel browser: blocca mutazioni, nasconde tutto il fitness e invalida le sessioni delle altre schede. La sospensione lascia solo informativa, backup locale, cancellazione dati ospite, logout e nuova accettazione separata esplicita. Il re-consenso salva il documento locale prima di rimuovere il marker; nessun backend viene chiamato per il consenso ospite. Le Rules Firestore restano il confine dei soli account autenticati.

## Ripresa consapevole del journal dopo nuovo consenso (implementata; collaudo multi-dispositivo aperto)

Quando vi sono pending precedenti, non vengono spediti. La schermata `recovery-required` offre una scelta separata ed esplicita: utilizzare nuovamente le modifiche locali confrontandole con una lettura integrale e aggiornata dei documenti cloud. L'algoritmo produce un **nuovo** journal causale relativo al cloud corrente, preserva il consenso firmato dal server e conserva nell'archivio locale precedente i valori, il baseline e tutte le vecchie operazioni. Il cambio avviene in un'unica transazione IndexedDB con controllo di revisione e sessione; in caso di errore resta il vecchio journal. L'utente va avvisato dei conflitti e della necessità di scaricare un backup prima del recupero. Non si tratta di replay automatico.

## Concorrenza fra revoca e riaccettazione

Una riconferma della revoca già superata verifica nuovamente il marker e la generazione del dispositivo **dopo** la GET server: una richiesta vecchia non può convertire in `pending` una scelta locale sopravvenuta. Ogni richiesta trusted `withdraw` oppure `reaccept` contiene la revisione server che l'ha originata; il backend la confronta all'interno della transazione Firestore e risponde con conflitto su uno stato più recente. Le richieste offline di revoca conservano in modo durevole `pending:<revisione>`; il client non ripresenta automaticamente una richiesta più vecchia del consenso aggiornato. La schermata offre due scelte esplicite: riconfermare la revoca oppure mantenere il consenso più recente verificato server-side. Analogamente un vecchio retry di nuova accettazione non può riaprire il trattamento dopo una successiva revoca. Le ripetizioni idempotenti dello **stesso** cambiamento sono consentite solo rispetto alla revisione originale e alle versioni legali correnti.

**Residuo prima del pilot con utenti reali:** verifica effettiva multi-dispositivo, smoke autenticato backend/Rules/Hosting coordinati, verifica accessibilità UI/viewport e approvazione della base giuridica, del trattamento dopo revoca e dei contatti/documenti privacy. CI, codice e compliance non sono equivalenti.
