# Debug Background Sync

## Comportamento attuale

Il Service Worker non salva direttamente dati utente e non conserva credenziali o payload di sincronizzazione.
Quando riceve l'evento `logbook-sync`, invia `LOGBOOK_SYNC_REQUIRED` alle finestre LogBook aperte.
L'app risponde rieseguendo il journal durevole associato all'owner corrente.

Lo stesso replay viene richiesto anche quando:

1. il browser torna online;
2. la PWA torna visibile in primo piano;
3. una registrazione Background Sync precedente si riattiva dopo un aggiornamento.

## Verifica che il replay funzioni

1. Apri DevTools > Application > Service Workers.
2. Porta LogBook offline ed esegui una modifica che resti nel journal locale.
3. Torna online oppure riporta la PWA in primo piano.
4. Verifica che la sincronizzazione riparta senza letture di token o payload dal Service Worker.
5. Se il browser supporta Background Sync, un evento `logbook-sync` deve soltanto notificare le finestre aperte.

## Compatibilità browser

Safari/iOS può non supportare Background Sync. Questo non blocca il recupero: online, riapertura e ritorno in primo piano usano comunque lo stesso journal durevole.

## Chiavi legacy

`pending_sync_payload`, `pending_sync_token` e `sync_failed` appartengono al vecchio meccanismo di Background Sync. Il codice corrente non le usa per scrivere dati; vengono soltanto ripulite nei percorsi di recupero/logout per evitare residui di installazioni precedenti.
