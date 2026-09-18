# Piano remediation strutturale — 18 settembre 2026

Baseline: `d4056e64c89969a003898056dee75a68b683f287`.
Stato: approvato dall'utente con richiesta esplicita di procedere.

## Obiettivo

Correggere i finding confermati dagli audit del 18 settembre privilegiando cause strutturali rispetto a fix locali. Il lavoro procede per lotti isolati, con gate canonico `npm run verify:m8` sull'esatto HEAD, review finale, merge e verifica post-merge GitHub/Vercel.

## Ordine

1. Security/cloud boundary: App Check, account deletion, Firestore metadata.
2. Persistenza sincrona e timer atomico.
3. Semantica offline/replay e rimozione di false garanzie basate su lifecycle browser.
4. Browser reali, UX boundary e accessibilità.
5. Telemetria, retention e CSP.
6. PWA cache/performance e lifecycle Service Worker.
7. Modernizzazione toolchain e lazy loading.
8. Dipendenze/configurazione residue.

## Lotto corrente — security/cloud boundary

### App Check

- Inizializzare il provider App Check prima di inizializzare Firestore.
- Separare provider inizializzato, token disponibile, token fallito e fallback locale.
- Non considerare App Check attivo quando il token iniziale manca.
- Adottare `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` come nome canonico mantenendo fallback temporaneo ai nomi storici.

### Account deletion

- Il client non può cancellare direttamente `/users/{uid}`: il root viene eliminato soltanto dal backend trusted del job account-deletion.
- Preservare la barriera `account_deletions/{uid}` per tutti i path privati.

### `_sync`

- Rafforzare gli invarianti top-level esprimibili nelle Rules senza duplicare il parser TypeScript.
- Aggiungere test emulator per payload avversariali e per il divieto di delete del root.

## Invarianti

- Offline/local-first resta operativo anche quando App Check è disabled, unsupported o in errore.
- Nessuna modifica alle versioni Data Schema, Sync Protocol, Local Envelope o Backup Schema.
- Nessun client può bypassare il job server-side di cancellazione account.
- Le normali mutazioni business restano sul boundary Domain Operations corrente.
- Nessun branch di sviluppo deve produrre Preview Vercel; `vercel.json` mantiene `main: true` e `**: false`.

## Verifica

- Test mirati App Check e Firestore Rules emulator.
- Gate canonico completo `npm run verify:m8` tramite `Milestone Verification / Canonical Verification` sull'esatto HEAD.
- Review finale del diff.
- Dopo merge: workflow su `main` verde e deployment Vercel production sullo stesso SHA in stato READY.

## Rollback

Le modifiche non introducono migrazioni dati persistite. In caso di regressione il lotto può essere revertito come unità; le Rules precedenti devono essere ripristinate solo insieme al codice client compatibile.