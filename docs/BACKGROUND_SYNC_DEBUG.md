# Debug Background Sync

## Comportamento attuale

Il Service Worker non salva direttamente dati utente e non conserva credenziali o payload di sincronizzazione.
Quando riceve l'evento `logbook-sync`, invia `LOGBOOK_SYNC_REQUIRED` alle finestre TheLogBook aperte.
L'app risponde rieseguendo il journal durevole associato all'owner corrente.

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

## Chiavi legacy

`pending_sync_payload`, `pending_sync_token` e `sync_failed` appartengono al vecchio meccanismo di Background Sync. Il codice corrente non le usa per scrivere dati. Le chiavi IndexedDB legacy non hanno un owner verificabile: il logout e la pulizia account **non le cancellano automaticamente**. Se il residuo è già presente prima di iniziare una nuova pulizia, il preflight rifiuta il logout senza creare un fence incompleto. Se compare durante una pulizia già iniziata, quest'ultima resta incompleta e il fence continua a proteggere i dati. In entrambi i casi le chiavi legacy restano conservate anziché essere attribuite a un altro account. Serve riconciliazione esplicita; il controllo di assenza non rende atomici i writer di vecchie PWA ancora aperte.
