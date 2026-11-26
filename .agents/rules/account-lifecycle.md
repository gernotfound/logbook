# Ciclo account, Auth e guest — TheLogBook

**Quando leggere:** email verificata, accesso guest→account, sessioni, account deletion, logout e purge.

**Non inferire:** Auth assente, timeout o tombstone scaduto non provano cancellazione completa né autorizzano purge locale.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

**Stato:** i checkpoint datati descrivono il candidato e non certificano il runtime pubblico; usare [quadro operativo Cloudflare](../../docs/operations/cloudflare-current-state.md) per l'ultimo readback documentato.

> **Checkpoint 24/11:** gli incrementi datati nei dossier collegati descrivono anche stadi storici. La [mappa corrente](../../docs/operations/cloudflare-current-state.md) distingue le funzioni candidate già integrate da quelle mancanti. Il pubblico resta identity-only.

## Percorsi specialistici (lettura selettiva)

| Attività | Contratto pertinente |
|---|---|
| Cancellazione account/inattività Kinde, lease D1, pin recovery, Kinde-last | [CF-06 account erasure](account-cf06-erasure.md) |
| Integrazioni React/Kinde, UI e journal candidati CF-03/04/05 | [Integrazioni Kinde candidate](account-kinde-candidate.md) |
| Registrazione Firebase legacy, guest→account, verifica email e migrazione locale | [Ingresso Firebase e guest](account-legacy-entry.md) |
| Revoca sessioni, eliminazione account, logout, purge, recovery e cron | [Cancellazione e purge](account-deletion-and-purge.md) |

Questi documenti specializzano il contratto corrente; quando il task tocca uno dei percorsi, leggerne anche i failure path. Le sezioni Firebase documentano la baseline legacy ancora nei chiamanti, non il provider scelto per il target.

## Target Kinde selezionato — contratto corrente

Kinde è il provider di identità per la **nuova baseline fresh start**. Lo stack legacy Firebase descritto nelle sezioni successive documenta i chiamanti e gli invarianti ancora da sostituire; il frontend pubblico monta GuestOnlyAuthProvider e l'ingresso Kinde identity-only, **non** impone di usare Firebase dopo il cutover. Nessun dato/credenziale/UID vecchio viene migrato. Il backend Worker verifica token Kinde con RS256/JWKS, `iss` e `aud` esatti, `azp` per il solo client autorizzato e scadenze brevi; un token valido **non** costituisce da solo prova di email verificata, consenso salute, o autorizzazione D1. L'identità Kinde (`iss` + `sub`) deve essere associata all'owner interno senza collisioni e verificata tramite flusso trusted prima che `session-issuer.mjs` crei una sessione. Nessun endpoint pubblico può emettere sessioni con UID forniti dal chiamante. Il provisioner interno `cloudflare/auth/kinde-principal-provisioner.mjs`, tramite `kinde-owner-id.mjs`, deriva un owner ID `k_` dal digest SHA-256 separato per dominio di `issuer + subject` **solo dopo** verifica OIDC con email verificata e nonce dal callback trusted. Il primo insert in D1 è idempotente e una read primaria valida lo stato; login successivi non riattivano owner disabled/deleted e non reimpostano `auth_epoch`. La derivazione non è una chiave cifrante né una prova di sessione. Il candidato HTTP `kinde-oauth-flow.mjs` già consuma state e PKCE monouso, verifica nonce e token firmati e crea la sessione D1; il Worker HTTP Kinde privato è collegato al gateway frontend limitato a OAuth/sessione identity-only, non a D1 fitness. Le prove manuali di email/password e Google/logout/rientro sono registrate in CF-03; reset, revoca/email cambiata, lifecycle completo e collaudo su dispositivi reali restano da verificare. Revoca/erasure aggiornano il fence applicativo in D1 e impediscono subito accesso, indipendentemente dalla vita residua degli access token Kinde. Login, reset, signup e cambio password devono rispettare minimo 15 caratteri tramite workflow `NewPasswordProvided`, collaudato anche dopo reset. Google, emailVerified, guest→account, Safari/PWA, anti-replay, multi-tab/device e cancellazione account sono gate; audit dei test prima di ritirare i flussi Firebase.

Il candidato `acceptKindeCandidateInitialConsent()` raccoglie la decisione esplicita
(maggiore età, Termini e dati salute), invia solo il formato Server-D1 corrente
e richiede una successiva lettura autorevole di sessione e consenso con UID,
epoca e versioni legali esatte. Errori 409/503 o risposta persa non autorizzano
un retry automatico: si verifica lo stato primario senza considerare un 200
come consenso già provato. Consente la scelta esplicita anche mentre il guest
ha un archivio da migrare, ma non ne assume mai proprietà e non lo cancella.
Il componente non è ancora montato nella UX pubblica.

La nuova composizione candidata `deliverKindeCandidateJournal()` richiede una prova HTTPS
Kinde di sessione, prima accettazione, revisione e stato attivo, e una
verifica continua della generazione in memoria e del cookie CSRF casuale per
impedire A→B→A con lo stesso owner. Blocca una modalità guest ancora marcata
in storage. **Non** crea account, consenso o vault; la progressione del client
AuthContext/guest è ancora un gate distinto. Nessun dato pre-lancio da trasferire.

Il candidato browser `revokeKindeCandidateSession()` chiede al backend solo la revoca
della **sessione D1 corrente** con cookie host-only e token CSRF letto dal cookie
non-HttpOnly; non effettua logout SSO Kinde, purge IndexedDB, migrazione guest
o navigazione. La risposta HTTP 200 `signed-out` non basta da sola: serve
un nuovo status HTTP 401 con payload `unauthorized` validato. Se rete,
sessione, CSRF o generazione UI cambiano durante l'operazione, il client
mantiene la condizione indeterminata e il chiamante non può liberare il vault
o scartare il journal sulla sola promessa di logout. Il modulo resta
**non collegato** ad AuthContext fino al porting completo di identità,
consenso e recovery.

Kinde è responsabile delle email Auth; non sono previsti fornitori transazionali separati nel nuovo percorso. Per **cancellazione account** prima completare e provare revoca e cancellazione D1/chiavi, poi eliminare identità Kinde con ricevuta autorevole, senza dichiarare `complete` su timeout o errore. La revoca del solo consenso sanitario non elimina necessariamente l'identità Kinde. Nessuna Kinde console/configurazione è stata letta o attivata in questo incremento.

## Perimetro e contratti collegati

**MUST:** applicare il fresh start definito in `AGENTS.md`. Non è necessario recuperare account o backup pre-lancio e non si introducono nuovi percorsi per importare o migrare chiavi ownerless. Il purge di ogni account deve agire solo sull'archivio owner-scoped e sui marker tecnici/Auth con proprietà verificabile; i vecchi nomi business/IndexedDB globali non sono letti, attribuiti o cancellati. Restano obbligatori Web Locks e fence, verifica del journal, consenso, cancellazione server-complete, recupero da crash e protezione dei dati **della baseline corrente**. Nessun reset automatico di provider o storage di altri account.

Leggere [Consenso salute](health-consent.md) per primo consenso, offline, revoca/riaccettazione, export diritti e cancellazione dei soli dati; [Portabilità](backup-and-portability.md) per backup/import/CSV. Non assimilare questi percorsi alla cancellazione dell'account.

> La tabella descrive il contratto della baseline legacy Firebase e le protezioni trasversali, non una decisione di adottare Firebase nel target Kinde.

## Mappa delle transizioni di identità

| Transizione | Prova necessaria | Comportamento in caso di blocco |
|---|---|---|
| Registrazione → account verificato | Firebase Auth, email verificata e sessione corrente | Niente hydration account; dati guest e account separati |
| Guest → account | Scelta esplicita, origine dell'esito Auth, generazione guest e journal | Non attribuire dati guest al nuovo UID sulla sola notifica Auth; conservare l'intento |
| Logout ordinario | Owner e gate di persistenza/integrità | Non eliminare ciphertext o journal non verificati |
| Revoca di tutte le sessioni | Recent Auth, token non revocato, App Check e prova server | Esito ambiguo non è successo; niente purge forzato |
| Cancellazione account | Job trusted `complete`, lease e assenza dei residui | Conservare copie locali e ricevuta fino alla prova di completamento |
| Cancellazione dei soli dati salute | Revoca trusted, job sanitario `complete`, revisione e chiave verificate | Firebase Auth resta; niente purge anticipato ([Consenso salute](health-consent.md)) |

La tabella è un indice delle decisioni, non sostituisce i guard di transazione, i dettagli di recovery né i requisiti dei paragrafi seguenti.


## Aggiornamenti PWA

Il contratto completo è in [Storage e sync](storage-and-sync.md): flush, attivazione Service Worker e seconda barriera prima della navigazione. I controlli di questa regola su owner, consenso, logout e purge si applicano anche durante un update.

## Evidenze e fonti

Fonti principali: `src/contexts/AuthContext.tsx` e `src/contexts/auth/` orchestrano il lifecycle; `src/lib/auth/` gestisce provenienza e marker; `src/lib/db/db_account.ts` e `src/lib/db/ownerLocalPurge.ts` sono boundary infrastrutturali; `server/accountDeletion/` e gli endpoint `api/account-deletion*` gestiscono il job trusted.

I test devono attraversare questi boundary secondo [Verification hardening](verification-hardening.md), con il gate [CI](ci-verification.md). Le configurazioni live sono prove separate.

