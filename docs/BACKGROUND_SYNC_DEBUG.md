# Debug ripresa sincronizzazione

## Comportamento corrente

Il journal owner-scoped rimane persistito localmente e il client gestisce i tentativi di replica. Il Service Worker non legge credenziali, stato utente o journal e non invia comandi di replay.

La ripresa può partire quando il browser torna online o quando TheLogBook torna visibile in primo piano. Inoltre, se il journal è ancora `local-pending` e la sessione autorizzata resta in primo piano e online, il client pianifica nuovi tentativi con backoff da 20 secondi fino a 5 minuti. Il timer non replica journal rifiutati o bloccati e non aggira i controlli di consenso, ownership e integrità.

Il replay resta subordinato alla sessione e ai controlli di ownership, consenso, integrità e autorizzazione. I dati locali non vengono scartati a seguito di un errore remoto. L'assenza della Background Sync API su Safari/iOS non impedisce i due percorsi di ripresa.

## Verifica

1. Apri la PWA con una sessione valida e registra una modifica offline, accertando che sia stata persistita.
2. Riattiva la rete oppure riporta la PWA in primo piano.
3. Verifica che il client ritenti la replica soltanto per l'owner autorizzato, senza inventare conferme cloud in caso di errore.
4. Dopo logout, revoca o cambio di sessione, verifica che il vecchio journal non venga replicato.

Non viene registrato alcun evento Background Sync `logbook-sync`. Il precedente handler serviva solo a notificare un browser con una registrazione pre-lancio; in assenza di installazioni storiche da supportare, è stato rimosso.
