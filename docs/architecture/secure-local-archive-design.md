# TheLogBook — archivio sanitario locale protetto (progetto CRITICAL)

> Stato: progettazione / integrazione **non attiva**. Non usare questo documento per affermare che la cifratura sia distribuita. Baseline analizzata: `main` `b0dedd0664209c470bf1512458734e666286579b` (2026-10-12).
> Obiettivo approvato: uno sblocco locale iniziale; dopo lo sblocco PWA completamente utilizzabile offline. Nessuna perdita silenziosa di dati o downgrade delle garanzie attuali.

## 1. Modello di minaccia e limiti

Proteggere la **riservatezza dei dati a riposo** quando un terzo ottiene una copia dei file del profilo browser, backup di IndexedDB/localStorage o accesso allo storage mentre l'archivio è bloccato. Garantire anche integrità autenticata, isolamento degli owner e rilevamento della manomissione; non reinterpretare ciphertext guasto come archivio assente.

Non si promette protezione completa da XSS, estensioni malevole, compromissione del browser/OS oppure codice ostile che opera **dopo** lo sblocco: questi attori possono leggere il DOM/stato in memoria o utilizzare le funzioni di decifratura. Mantenere CSP, sanitizzazione, dipendenze e difese XSS. App Check e Firestore Rules non cifrano IndexedDB né localStorage. La soluzione **non** rende Firestore end-to-end encrypted.

Distinguere *autenticazione cloud Firebase*, *consenso al trattamento dei dati salute* e *sblocco del segreto crittografico del dispositivo*. Nessuno dei tre sostituisce gli altri. Un account revocato deve restare bloccato anche se la passphrase di archivio è corretta.

## 2. Inventario dei dati e copertura minima

| Sorgente | Dati e invarianti | Boundary corrente |
| --- | --- | --- |
| IndexedDB `logbook:v2:${owner}` | Local Envelope 5, business state, baseline, journal pending, revisioni, consent recovery, ledger chiusura workout; aggiornamento atomico | `src/lib/sync/localRepository.ts`: `get`, `update`, `readLocal`, `commitDomainOperations`, `commitLocal`, `acknowledgeThrough`, `hydrateLocal`, recovery |
| `localStorage` `logbook:v2:${owner}:*` | Workout corrente, timer, draft ed editor, bozze misurazioni/sonno/cardio, post-session, dati di recovery e segnali di lifecycle | `src/lib/sync/deviceStorage.ts`, `src/hooks/useDatedDraft.ts`, `src/lib/sync/deviceCriticalState.ts`, chiamanti workout |
| `localStorage` e altri namespace | Flags guest, consent withdrawal/generation, owner hint, account deletion receipts, telemetria e preferenze | Audit **per singola chiave**: alcune sentinelle devono restare leggibili prima dello sblocco, ma nessun payload sanitario può rimanere in chiaro |
| Backup / export / import | Raccolta recovery device, envelope, dati di origine locale e cloud, ripristino account e guest→account | `src/lib/db/backupSnapshot.ts`, `src/lib/backup.ts`, `src/lib/export.ts`, import/restore |
| Lifecycle | Auth bootstrap, guest, multi-tab, logout, purge, revoca consenso, riaccettazione, account deletion, PWA reload/required-update | `src/main.tsx`, `src/contexts/AuthContext.tsx`, `src/lib/db/db_account.ts`, `src/lib/sync/reloadBarrier.ts` |

Non conservare una seconda copia duratura in chiaro per il solo motivo che i dati sono cifrati nella prima. Le preferenze non sensibili possono restare in chiaro, dopo inventario esplicito.

## 3. Chiavi e sblocco

- **Una DEK casuale da 256 bit per owner e dispositivo**, generata con CSPRNG, mai salvata in chiaro; DEK separata per guest e account e diversa per ogni device.
- Una passphrase locale indipendente dalla password Firebase sblocca la DEK usando una **KEK derivata** con KDF versionata e salt casuale unico. Prima proposta interoperabile: PBKDF2-HMAC-SHA-256 tramite Web Crypto, costo calibrato, con minimo conservativo verificato su browser supportati. Argon2id resta alternativa solo dopo prova di compatibilità e memoria reale su iOS/WebKit.
- Wrapping della DEK con AES-GCM nativo, nonce casuale, metadata autenticati, versione/owner/KDF/costo registrati e controllati per limiti plausibili, senza password in storage. La sola passphrase non viene persistita.
- Secondo wrapping indipendente tramite **codice di recupero casuale ad alta entropia** mostrato all'attivazione (non salvare mai il codice in chiaro). Richiedere esplicita presa visione; evitare di lasciare la copia del codice in un endpoint remoto non autorizzato.
- DEK disponibile soltanto nella memoria della scheda sbloccata; altre schede richiedono sblocco autonomo; non inviarla tramite BroadcastChannel/localStorage. Lock e logout devono invalidare l'epoca locale e pulire gli handle quanto possibile.
- Cifratura dei **record** con AEAD e nonce nuovo per *ogni* scrittura; AAD vincolata a owner, key/path, namespace e versione. Controllare autenticità e limiti dimensionali prima di decodificare, quindi validare envelope e business schema esistenti. Errore AEAD = blocco e recupero, mai `undefined` / seed vuoto.
- Se la DEK è compromessa, la sola sostituzione della passphrase non è sufficiente: serve vera rotazione con re-encryption verificata. Rewrapping della stessa DEK è ammesso per normale cambio passphrase.

## 4. Cifratura SINCRONA per la durabilità

`idb-keyval.update()` riceve una callback di lettura-modifica-scrittura **sincrona** nello stesso contesto transazionale IndexedDB. Le funzioni `crypto.subtle.encrypt/decrypt` restituiscono Promise: NON inserirle direttamente nella callback; una transazione può essere invalidata o chiudersi durante gli await e la semantica causale andrebbe perduta.

Anche `localStorage` conserva attualmente snapshot obbligatori **sincroni** per workout/timer/flush. Non sostituire con code asincrone non persistite né con salvataggi best-effort che perdano l'ultimo input su sospensione mobile.

Selezionare, verificare integrità e fissare versione di una libreria crittografica AEAD **sincrona, mantenuta e revisionata**, ad esempio `@noble/ciphers` con XChaCha20-Poly1305 e nonce casuale da 192 bit, previa verifica di API, bundle, licenza, audit, interoperabilità, vector test, prestazioni e compatibilità TypeScript 7/Vite 8. La derivazione/wrapping all'atto dello sblocco può rimanere nativa Web Crypto asincrona perché non si trova nel percorso critico dei commit.

Il modulo `secureArchiveStorage` dovrà mantenere la callback `update` attuale **all'interno** della transazione, decrittando il valore corrente e sigillando quello nuovo sincronicamente; vietato un `get` seguito da `set` non atomico. Sostituire tutti i `update` di `localRepository.ts` tramite una sola API versionata, senza duplicare journal né modificare l'ordine di applicazione dei delta.

Il modulo sincrono `deviceStorage.ts` dovrà proteggere tutti i payload sensibili, comprese le bozze datate. Il refactor preparatorio delle bozze su questo boundary va verificato prima dell'attivazione della cifratura.

## 5. Bootstrap e ciclo di vita

1. Determinare owner in modo strict senza trattare storage illeggibile come owner assente. Esporre uno stato `locked` prima di leggere `UserData`, workout o journal; non far partire hydration/sync/guest migration quando locked.
2. L'utente può creare passphrase e codice recovery al primo setup oppure sbloccare un vault esistente. Nessun accesso a plaintext prima dell'autorizzazione. Per un UID noto solo dopo Firebase Auth, sospendere `loadAuthenticatedData` finché non è sbloccato quell'owner.
3. Dopo unlock, inizializzare l'archivio di quell'owner prima del bootstrap normale. Conservare offline-first, readiness Firebase/App Check e fencing del consenso come oggi.
4. Logout, cancellazione e cambio owner devono invalidare immediatamente gli handle crittografici e bloccare callback stale. Account deletion **completata dal server** deve poter finalizzare la pulizia ciphertext senza chiedere la passphrase: il purge del record cifrato non necessita decrypt.
5. Consent withdrawal e generation markers devono restare verificabili mentre locked. Il ri-consenso non riattiva da solo writer, replays o archivi precedenti. Un ciphertext non leggibile non autorizza cancellazione.
6. Lock di una scheda non revoca automaticamente l'autorizzazione di un'altra senza policy esplicita, ma logout/revoca/account deletion cross-tab sì. Un nuovo epoch crittografico invalida la memoria della vecchia scheda.
7. PWA update e hard reload: nessun aggiornamento mentre vi siano dirty edit non durevoli. Il reload dopo unlock deve riproporre sblocco; non persistere DEK per eludere UX.

## 6. Migrazione *fail-closed*

- Nessuna migrazione distruttiva all'avvio del frontend. Individuare prima vecchio record/plaintext e snapshot device, creare metadata di key wrapping e avviare una **transizione durable**, tracciata per owner e versionata. Non committare dati parzialmente migrati come `active`.
- Preservare la copia originale fino al completamento verificato di ogni categoria di record. Migrare l'envelope dentro una sola `idb-keyval.update`, con validazione precedente e verifica authenticated decrypt. Per snapshot device definire journal di progresso e recovery idempotente che sopravviva a tab crash/quota e interruzioni.
- **Non lasciare indefinitamente una copia in chiaro** dopo l'attivazione: termine della migrazione deve verificare scansione dei namespace e rimozione delle copie precedenti. Un failure arresta le scritture e preserva gli originali, senza rendere falsa la classificazione come cifrato.
- Le schede PWA obsolete possono tentare writes in chiaro: la strategia deve prevedere fencing *misurabile* su owner/epoca anche in presenza di tab sospese; non assumere che BroadcastChannel basti o che tutti i client legacy rispettino una nuova sentinella. Verificare che un vecchio `update` non possa sostituire l'archivio cifrato e come rilevare/gestire una vecchia write device.
- No conversione/sovrascrittura di ciphertext con versioni ignote, owner divergente, nonce/tag invalidi, key metadata corrotti o KDF parametrizzata fuori limiti. Trattare il crash come transizione riprendibile, non come archivio perso.

## 7. Backup e recupero

- Il backup esplicito conserva i dati in formato ripristinabile validato, non una miscela di ciphertext e vecchi device snapshot. Richiede unlock per includere la copia locale. Il backup in chiaro va identificato chiaramente all'utente; una successiva opzione di backup cifrato è separata e richiede propria progettazione/test.
- Se si perde la passphrase ma si possiede il codice di recupero, riaprire la DEK e impostare una nuova passphrase **senza riscrivere arbitrariamente i dati o il journal**.
- Se si perdono **entrambi**, non esiste recupero crittografico dei dati solo-device: gli account possono recuperare dati **già sincronizzati** dal cloud creando un nuovo archivio, ma **non** modifiche offline/pending rimaste cifrate. Non cancellare automaticamente il vecchio ciphertext: occorre una scelta esplicita con avvertenza del limite, esercizio dei diritti e backup disponibile.
- Guest→account: mantenere l'origine guest cifrata e validare entrambe le identità; migrare dati *decrittati in memoria* attraverso il protocollo esistente, con salvataggio nel vault destinazione senza perdere il guest in failure.
- Account deletion/recovery: la receipt non può sparire perché il vault è locked; i marker separati mantengono la prova dell'esito server e il wipe procede solo dopo `complete`.
- Non confondere la revoca consenso e la cancellazione account: nessuna cancellazione silenziosa dovuta al solo lock.

## 8. Matrice minima di verifica prima di una release

- Vettori AEAD/KDF, nonces unici, wrong passphrase, wrong recovery code, wrong owner/path, tampering, bitflip, truncation, crypto/KDF versions future, malformed KDF, quota/access denied.
- Verifica su **bytes reali** che peso, frequenza cardiaca, sonno, note, workout, pending journal e snapshot device non compaiano in chiaro negli storage esaminati **dopo** migrazione.
- Concorrenza multi-tab e cross-owner: due domain operation simultanee mantengono entrambi gli intenti; consent epoch e replica generation non subiscono regressioni; nessuna desincronizzazione baseline/data/pending.
- Crash dopo ogni fase: creazione metadata, before/after IDB commit, migrazione device key, update in corso, guest→account, ack cloud, delete receipt, required-update, chiusura improvvisa offline.
- Browser refresh/nuova scheda offline, WebKit mobile, import/export backup, restore, account deletion anche con vault locked e revoca consenso da altra scheda/dispositivo.
- CI `verify:m8` / exact-SHA + CodeQL / security-static / npm audit / review su candidato esatto, regressioni negative sui gate, verifica visiva dark/light e viewport, deploy frontend Firestore senza Rules/config nuove salvo evidenze, smoke Production **dopo** merge.
- Il branch rimane **draft/non mergeable come prodotto** finché il perimetro end-to-end non è coperto. Non spostare il finding CodeQL a false positive e non indebolire SAST.

## Riferimenti tecnici

- [OWASP — Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [OWASP — Key Management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
- [OWASP — HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- [MDN — Web Crypto deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- [noble-ciphers — API, test e audit](https://github.com/paulmillr/noble-ciphers)
