# Revoca consenso salute — protocollo tecnico (bozza pre-pilot)

Decisione UX del product owner (12 ottobre 2026): dopo la revoca nessuna funzione fitness è accessibile. La schermata di servizio sospeso consente informativa, diritti, esportazione, cancellazione account e nuova accettazione separata ed esplicita. Dopo la nuova accettazione, tutte le funzioni possono riattivarsi. Non esiste una modalità fitness ridotta.

## Confine autorevole

`health_consent_withdrawals/{uid}` è esclusivamente server-managed. Il backend autentica UID Firebase, verifica App Check limited-use e origini consentite. Lo stato `withdrawn` blocca tramite Security Rules tutte le nuove scritture della zona fitness e della telemetria; le letture dirette dell'owner sono bloccate in stato revocato anche per client obsoleti; per esercitare i diritti e produrre il backup cloud il server espone un endpoint separato autenticato e paginato, senza aprire Firestore ai vecchi client. `active` richiede una nuova scelta esplicita con versioni legali correnti, mai un ripristino automatico da backup o da `legalConsent` client. La registrazione della revoca è idempotente. Nessuna revoca cancella dati o account in modo implicito; l'account deletion elimina il marker come parte del suo cleanup.

## Verifiche ancora richieste prima della distribuzione

- Enforcement locale e cross-tab del blocco; avvio autenticato, offline, dispositivi secondari e sospensione di writer in-flight.
- Riattivazione di un account revocato: impedire replay di journal creati prima della nuova accettazione, inclusi i client vecchi ancora aperti. Uno stato `active` da solo non basta a distinguere generazioni di consenso: **non distribuire il ripristino senza un fence di generazione verificato dalle Rules**.
- Esportazione/diritti/account deletion anche in caso di backend indisponibile, senza dichiarare successo non verificato.
- Verifica canonica, review sullo SHA candidato, deploy coordinato frontend/backend/rules e smoke autenticato.
- Validazione con avvocato: basi art. 6/9 GDPR, libertà del consenso, conseguenze del diniego, conservazione residua dopo revoca, informativa, DPIA, DPA/trasferimenti.

Questo branch non è una funzionalità Production pronta finché i punti sopra sono aperti.

## Confine export dopo revoca (bozza tecnica)

Durante la revoca, tutte le letture dirette delle collection `users/{uid}` sono negate dalla Security Rule anche a client obsoleti. `api/health-consent-export` verifica origin, Firebase UID, App Check limited-use e stato revocato ad ogni pagina; il server invia il root e le collection mensili in pagine di massimo due documenti, senza esporre documenti amministrativi. Il client verifica gli ID mensili, evita cursori ripetuti e costruisce il Backup Schema 3 con copertura `cloud-and-device` soltanto dopo la lettura completa. Se manca il server o il dispositivo è offline, il percorso esistente richiede la conferma esplicita per esportare il solo archivio locale, marcato parziale.

Questa soluzione non sostituisce ancora i controlli di epoch/fencing delle scritture dopo nuova accettazione. Non pubblicare la PR senza chiudere quel confine e le verifiche dei diritti/privacy richieste.

## Fence delle generazioni di consenso

Dopo la prima revoca, il marker server non viene eliminato al re-consenso: la revisione cresce monotonicamente. Le Rules accettano un nuovo `sync_control` e le scritture con `_sync.writer` soltanto se dichiarano esplicitamente `consentRevision` uguale alla revisione server `active`. Un vecchio client Protocol 3 privo di tale campo non può né ri-registrare la replica né scrivere un vecchio journal. Il parser TypeScript riconosce il campo opzionale senza incrementare artificialmente il Sync Protocol 3.

**Ancora aperto e bloccante:** il nuovo client deve associare ogni pending journal alla generazione in cui è stato creato, rifiutare replay silenzioso dopo la riattivazione e conservare i vecchi journal per il recupero. Finché questo codice e i test cross-device non esistono, il re-consenso non è operativo in Production. Gli utenti con backup/pending devono poter esercitare i diritti senza aprire il protocollo a dati di una generazione precedente.

## Quarantena non distruttiva del journal locale

Il client mantiene `consentRevision` opzionale nel Local Envelope V5. All'apertura di un account riattivato, la revisione locale può avanzare solo se non esistono pending operation della revisione precedente; il passaggio è un update IndexedDB atomico. I pending precedenti restano nel loro archivio originale e impediscono l'accesso fitness (stato `recovery-required`); l'utente vede la necessità di esportare i dati, non un successo sync. Il writer `_sync` e il registro `sync_control` presentano la stessa revisione verificata dal server. Le Rules rifiutano vecchi writer/registri anche se l'account è tornato `active`.

Questa quarantena non autorizza la cancellazione dei pending originali. Serve un percorso di riconciliazione/ripresa dopo backup che distingua i dati recuperabili dai replay proibiti; la PR rimane draft finché il recovery e l'esperienza utente non hanno regressioni complete.

Anche il marker browser strict della revisione fa parte del SessionSnapshot locale, per cui una vecchia tab perde la validità della propria sessione quando la revisione cambia in un'altra tab. Il marker revoca `pending/withdrawn` è incluso nello stesso controllo; la sua mutazione invalida write in-flight senza affidarsi a React.

## Ospite (solo dispositivo)

In assenza di account Firebase, il marker `logbook:v2:guest:health-consent-withdrawal` è durevole nel browser: blocca mutazioni, nasconde tutto il fitness e invalida le sessioni delle altre schede. La sospensione lascia solo informativa, backup locale, cancellazione dati ospite, logout e nuova accettazione separata esplicita. Il re-consenso salva il documento locale prima di rimuovere il marker; nessun backend viene chiamato per il consenso ospite. Le Rules Firestore restano il confine dei soli account autenticati.

## Ripresa consapevole del journal dopo nuovo consenso (candidato)

Quando vi sono pending precedenti, non vengono spediti. La schermata `recovery-required` offre una scelta separata ed esplicita: utilizzare nuovamente le modifiche locali confrontandole con una lettura integrale e aggiornata dei documenti cloud. L'algoritmo produce un **nuovo** journal causale relativo al cloud corrente, preserva il consenso firmato dal server e conserva nell'archivio locale precedente i valori, il baseline e tutte le vecchie operazioni. Il cambio avviene in un'unica transazione IndexedDB con controllo di revisione e sessione; in caso di errore resta il vecchio journal. L'utente va avvisato dei conflitti e della necessità di scaricare un backup prima del recupero. Non si tratta di replay automatico.
