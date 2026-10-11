# Revoca consenso salute — protocollo tecnico (bozza pre-pilot)

Decisione UX del product owner (12 ottobre 2026): dopo la revoca nessuna funzione fitness è accessibile. La schermata di servizio sospeso consente informativa, diritti, esportazione, cancellazione account e nuova accettazione separata ed esplicita. Dopo la nuova accettazione, tutte le funzioni possono riattivarsi. Non esiste una modalità fitness ridotta.

## Confine autorevole

`health_consent_withdrawals/{uid}` è esclusivamente server-managed. Il backend autentica UID Firebase, verifica App Check limited-use e origini consentite. Lo stato `withdrawn` blocca tramite Security Rules tutte le nuove scritture della zona fitness e della telemetria; le letture dell'owner restano abilitate per esportazione e diritti. `active` richiede una nuova scelta esplicita con versioni legali correnti, mai un ripristino automatico da backup o da `legalConsent` client. La registrazione della revoca è idempotente. Nessuna revoca cancella dati o account in modo implicito; l'account deletion elimina il marker come parte del suo cleanup.

## Verifiche ancora richieste prima della distribuzione

- Enforcement locale e cross-tab del blocco; avvio autenticato, offline, dispositivi secondari e sospensione di writer in-flight.
- Riattivazione di un account revocato: impedire replay di journal creati prima della nuova accettazione, inclusi i client vecchi ancora aperti. Uno stato `active` da solo non basta a distinguere generazioni di consenso: **non distribuire il ripristino senza un fence di generazione verificato dalle Rules**.
- Esportazione/diritti/account deletion anche in caso di backend indisponibile, senza dichiarare successo non verificato.
- Verifica canonica, review sullo SHA candidato, deploy coordinato frontend/backend/rules e smoke autenticato.
- Validazione con avvocato: basi art. 6/9 GDPR, libertà del consenso, conseguenze del diniego, conservazione residua dopo revoca, informativa, DPIA, DPA/trasferimenti.

Questo branch non è una funzionalità Production pronta finché i punti sopra sono aperti.
