# API private — erasure CF-06 e attività identity-only candidate

**Quando leggere:** job di erasure, stato/progresso cancellazione, activity marker, lease, retry e recovery.

**Non inferire:** un job o marker D1 non prova Kinde-last, cleanup completo, presenza utente né scheduler live.

**Autorità:** [indice API](README.md), [CF-06 account](../../.agents/rules/account-cf06-erasure.md), [Consenso candidato](../../.agents/rules/health-cloudflare-candidate.md) e [stato Cloudflare](../../docs/operations/cloudflare-current-state.md).

## CF-06 — bounded erasure progress candidate (not deployed)

Migration `0006_health_erasure_progress.sql` adds a durable lease epoch, a
cryptographically random 32-byte internal lease token, expiry, and a
`data → awaiting-keys` phase to `health_erasure_jobs`. Schema triggers
prevent premature `complete`, lease regression, cross-owner reparenting,
early reacceptance and direct SQL writes to withdrawn documents/replicas.
The first consent acceptance and owner tombstone remain durable.

`cloudflare/jobs/health-erasure-worker.mjs` implements a **private
`scheduled` handler only**, with no public fetch, cron configuration or
provider deployment. One invocation leases at most one eligible withdrawn
owner, selected by original request time across **both** phases. A continuing
stream of newer data jobs cannot overtake an older eligible key finalization;
an unexpired lease remains excluded. The key-only lease helper retains its
explicit phase filter. One data step deletes no more than **four rows from
one table**. The fixed,
server-side table order is encrypted documents, commit receipts, replica
mutation history and replica membership. Each SQL DELETE rechecks the
still-valid lease, withdrawn consent revision and epoch within that same
statement. An expired or stolen lease cannot continue; SQL/DB failures
throw without producing completion. After every known table is proven
empty in one conditional UPDATE, the job moves to `awaiting-keys`,
remaining `processing`, **not** `complete`. After lease expiry it remains
eligible for the next bounded invocation in the same request order.
The `0010`-backed finalizer then performs one atomic terminal INSERT and
verifies the durable primary proof before reporting `complete`; see the
SQL contract above. Selection does not bypass the per-job lease CAS.

The candidate scheduled entry point requires separate `DB` and `RECOVERY_DB`
bindings and recovery migration `0004_health_erasure_cutoffs.sql`. It
checks the exact withdrawn generation before any deletion and persists
an independent export cutoff before the atomic terminal INSERT. The
cutoff survives an application D1 restore. Only primary terminal evidence
can advance the independent floor and finish the cutoff's retry record.
Each tick also reserves at most one due reconciliation. If the primary
proof is missing or publication fails, the cutoff still blocks rights
release and a later tick can retry. An unresolved cutoff blocks the
operator restore census and the API requires both databases before
returning the newer terminal consent generation.

Reissuing `POST /v1/consent/withdraw` while a job is processing returns
only an owner/session-verified `deletionStatus: "processing"` (rather
than a false `pending`). A lost response to a DELETE is reconciled by
a future bounded scan after lease expiry, never by an invented ACK.
SQLite fixture tests cover concurrent leases, lost response, takeover
before DELETE, owner isolation, bounded batches, no resurrection,
rollbacks and prevention of premature completion. Both runner and finalizer
suites apply every canonical migration, require the terminal schema and seed
ordinary encrypted data only after wrapped ADK issuance. The former
pre-integration branch skip is no longer supported. This does **not**
constitute provider Free-tier CPU/limits evidence.

**Key boundary:** ADK custody and terminal key erasure exist in the candidate
code, not as an activated lifecycle. Cloud KEK custody/recovery, end-to-end
rights-only export, account deletion, retention and reacceptance still need
their separate verification and integration. In particular,
`awaiting-keys` means *the known replica tables were drained*, **not**
that the owner's health data, keys or backups have been fully deleted.
Rights-only key release also requires a matching `withdrawn` generation in
the open independent registry, before and after unwrapping. An older
application snapshot cannot release the key once that registry has advanced.
The subject fence can predate a valid renewed Auth session and stays distinct
from the Auth epoch echoed to the caller.
Never expose this worker through a route or schedule it on a real database
until those steps and their recovery tests are complete.

## CF-06 — osservazione attività identity-only (candidato)

`POST /v1/account/activity` è una mutazione con body JSON `{}` (128 byte massimi), sessione corrente e CSRF/rate gate privato. Non esige consenso sanitario e non accetta UID, timestamp o altro dato dal browser. Verifica il registro account indipendente aperto e la generazione recovery prima/dopo il marker; rifiuta la risposta quando cambia. `CF06_FOREGROUND_ACTIVITY_ENABLED=enabled` è opt-in trusted assente dalle configurazioni; il frontend pubblico non ha `D1_API`. La chiamata esplicita è candidata, non prova la presenza umana e non è invocata da login, refresh o background. Il client candidato esplicito `reportKindeCandidateForegroundActivity` accetta soltanto esiti `recorded`/`observed` e verifica la continuità del cookie CSRF, generazione chiamante, visibilità e connessione prima/dopo la richiesta; non avvia listener o timer di reporting. Il reporter candidato limita una richiesta in-flight per istanza/sessione, cooldown monotono 10 min dopo ricevuta e 1 min dopo fallimento, solo su invocazioni esplicite: nessun timer o replay. Nessun esito skipped/unavailable attesta un marker. La sola schermata candidata con `candidateActivityEnabled` invoca il reporter da click trusted, anche in consultazione. Il session observer limita i tentativi tra refresh della stessa sessione. Restano quota e collaudo provider/restore; niente nuova rotta pubblica o tracking attivo.
