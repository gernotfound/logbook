# Debug Background Sync

## Comportamento attuale

Il Service Worker non salva direttamente dati utente e non conserva credenziali o payload di sincronizzazione.
Quando riceve l'evento `logbook-sync`, invia `LOGBOOK_SYNC_REQUIRED` alle finestre TheLogBook aperte.
L'app valuta il replay del journal durevole soltanto quando esiste una sessione attiva: guest non revocato oppure account Firebase autenticato con UID corrispondente. Dopo il logout la schermata di accesso non deve riprendere il vecchio archivio. Valgono comunque i gate di consenso, persistenza e autorizzazione cloud; una notifica non prova la conferma remota.

Lo stesso replay viene richiesto anche quando:

1. il browser torna online;
2. la PWA torna visibile in primo piano;
3. una registrazione Background Sync precedente si riattiva dopo un aggiornamento.

## Verifica che il replay funzioni

1. Apri DevTools > Application > Service Workers.
2. Porta TheLogBook offline ed esegui una modifica che resti nel journal locale.
3. Torna online oppure riporta la PWA in primo piano.
4. Verifica che la sincronizzazione riparta senza letture di token o payload dal Service Worker.
5. Se il browser supporta Background Sync, un evento `logbook-sync` deve soltanto notificare le finestre aperte.

## Compatibilità browser

Safari/iOS può non supportare Background Sync. Questo non blocca il recupero: online, riapertura e ritorno in primo piano usano comunque lo stesso journal durevole.

## Chiavi pre-lancio ritirate

`pending_sync_payload`, `pending_sync_token` e `sync_failed` appartengono a un sistema pre-lancio non supportato. TheLogBook corrente non le legge, non le scrive, non le importa e non le elimina come parte del purge di un account. Il fresh start non richiede procedure di riconciliazione di dati storici inesistenti secondo il product owner. Background Sync usa il journal durable owner-scoped; crash, reload, offline e multi-tab della release supportata restano soggetti ai gate di persistenza e consenso.
