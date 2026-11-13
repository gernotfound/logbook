# Cloudflare full-stack — sviluppo, verifiche e cutover TheLogBook

**Stato:** sviluppo CRITICAL / fresh start, 13 novembre 2026. Questo è il runbook operativo corrente; non è una prova di rilascio Production. Le informazioni temporali vanno aggiornate dopo ogni merge o prova provider. [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053), [registro servizi](external-services-register.md), [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041).

## Decisione di prodotto e sequenza di abbandono

**Database e account precedenti vuoti secondo il product owner.** Il sistema Cloudflare partirà con **nuove identità, chiavi, consensi e dati**, senza trasferimenti Firebase/Vercel e senza adapter o formati di compatibilità pre-lancio. Conservare invece la normale funzione import/export per i dati generati nel nuovo sistema, la durabilità locale e tutti i diritti previsti.

**Abbandonare Firebase/Vercel il prima possibile**, non lasciarli attivi per un'ipotetica migrazione di utenti. Tuttavia oggi il codice PWA richiama ancora Firebase Authentication, Firestore/App Check e le Functions Vercel; il candidato D1 non è collegato al runtime. La rimozione anticipata di questi chiamanti romperebbe login, consenso, sincronizzazione e diritti. Realizzare vertical slice coerenti e testate sul nuovo stack, poi disattivare subito il precedente percorso secondo l'autorizzazione provider pertinente. Nessun dual-write o backfill.

La dichiarazione di database vuoto non è un inventario provider e non autorizza cancellazioni/reset fisici. Il cutover del dominio `thelogbook.me`, OAuth, posta Production e la dismissione irreversibile richiedono un GO specifico, anche senza utenti da migrare.

## Stato verificato — prove separate

| Area | Evidenza | Non dimostra |
|---|---|---|
| Repository | [PR #1070](https://github.com/gernotfound/logbook/pull/1070) squash merged su `main 8f6625a9100ef96c391a816e5639e8e83ffcc4d5`; [Main Release Gate/CodeQL #43424078257](https://github.com/gernotfound/logbook/actions/runs/43424078257) e [Firestore reconcile #43424472309](https://github.com/gernotfound/logbook/actions/runs/43424472309) SUCCESS | Nuovo Worker API pubblicato |
| Frontend Cloudflare | Worker `thelogbook-frontend` su `workers.dev` e [smoke Static Assets #43223911523](https://github.com/gernotfound/logbook/actions/runs/43223911523) riuscito | Auth, Safari/iOS, update PWA, API e dominio finale |
| D1 sandbox | `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`, read replication OFF: schema `0001` + `0002` applicate e indice/trigger anti-riuso riletti via Cloudflare; un UID e un documento **sintetici**, zero mutation di replica | Database reale, HTTP Worker, performance Free, conformità GDPR |
| Nuova API | `cloudflare/api/worker.mjs` e adapter SQL presenti nel repository, `AUTH_GATE` trusted assente, nessun binding D1 al Worker frontend | Runtime Auth o replica cloud utilizzabili |
| Recupero claim D1 | [PR #1072](https://github.com/gernotfound/logbook/pull/1072): ristaging nel vault di claim committato con clock remoto avanzato; verificare stato merge/CI da GitHub | Non è integrazione AuthGate o API Production; nessun ACK o grant sul ristaging |
| Email | [PR draft #1071](https://github.com/gernotfound/logbook/pull/1071) documenta consegna test Brevo Gmail/Proton, ma eventi apertura «Anonimizzato» ancora presenti | Email Auth senza tracking e provider definitivo |
| Vercel | Deployment backend Production `READY` dello SHA `8f6625a` avviato automaticamente dopo merge | Cloudflare Production o cutover DNS |

Il vecchio Hosting Firebase `thelogbook` è disabilitato secondo il comando CLI attestato dal proprietario; il workflow GitHub Hosting risulta dichiarato disabilitato, ma non è stato letto autonomamente come `disabled_manually`. Non riattivarlo come rollback.

## Architettura già implementata nel candidato isolato

**Storage D1.** Le migration `cloudflare/api/migrations/0001_encrypted_replica.sql` e `0002_reject_reused_replica_ids.sql` creano schema per soggetto/consenso/epoch, revisione CAS, registro repliche, documenti root/mensili cifrati, mutation e receipt immutabili. Trigger e vincoli bloccano rollback di revisione/epoch, sequenza regressiva, identità storica riutilizzata dopo il cambio slot. La seconda migration contiene un indice `(uid, replica_id)` per non eseguire scansioni lineari del ledger. **La presenza dello schema non implementa erasure/restore né Auth.** Gli script `rollback/` sono solo per database disposable: mai su dati reali senza autorizzazione.

**Worker e protocollo.** `cloudflare/api/worker.mjs`, `replica-maintenance.mjs`, `d1-document-store.mjs`: POST con body/documenti limitati, schema Zod strict, same-origin, CSRF e claim `AUTH_GATE` verificati prima di ogni accesso, CAS D1 e mutazioni immutabili hash-bound, batch atomicamente trigger-fenced. Fino a otto documenti cifrati, massimo 950 KB per documento: body cap complessivo coerente, ma **non ancora misurato sul Worker Free**. Niente AuthGate mock in runtime reale, no trusted identity via header controllabile dal client.

**Client.** `cloudReplicaTransport.ts` verifica revisioni, epoch e pagine complete; `cloudReplicaCheckpoint.ts` apre e autentica via AEAD tutti i documenti prima dell'adozione; `cloudReplicaCommit.ts` ricostruisce un batch D1. `cloudReplicaDurableDelivery.ts` salva nel vault IndexedDB owner-scoped l'intero batch ciphertext e il prefisso journal **prima** della rete. La receipt della richiesta originale autorizza soltanto l'ACK transazionale del prefisso identico, mai un successo inventato dopo timeout. `cloudMergeEngine.ts` è il core puro condiviso con il writer Firestore ancora attivo. **La nuova rete D1 non passa ancora per `replicateJournal()`.**

**Claim e retirement.** Una richiesta di mutazione replica è resa durevole nel vault con mutationId immutabile. Il retry usa gli stessi byte e un 409 non prova l'assenza di commit. `replica/status` legge **insieme** dalla D1 primaria il ledger e la revisione: soltanto `not-committed` + revisione ormai avanzata autorizzano una nuova richiesta **persistita prima della rete**, senza ACK di business. Una ricevuta storica non è un grant di membership; adozione di claim richiede la stessa incarnazione attiva/lease/seq/checkpoint, due controlli remoti identici e full scan AEAD con clock coerente. Il retirement committato può concludere come `retired` oppure `superseded` quando nuova generazione/differente replicaId sono dimostrati; chiude **solo l'intento amministrativo**, mai journal o GC.

La PR #1072 implementa per claim già committati e con **solo clock cloud avanzato** una nuova scansione AEAD, doppio controllo stabile e ristaging dell'intento con nuovo mutationId/clock. Altri casi non riconciliabili (replica ritirata/riusata, lease, seq, consenso/epoch o controllo instabile) devono fallire chiuso.

**Causalità Protocol 3:** `writer.seq` è globale al batch, non il dot di ciascun documento. Il documento deve mantenere un dot positivo del writer nel range `1..writer.seq`. Nessuna falsificazione di frontier per uniformare i clock.

I test Node/SQLite transazionali e fake-IndexedDB/AEAD di CI verificano **candidati isolati**, non API/provider reale, concorrenza cross-device, browser iOS o resilienza alle quote.

## Percorso critico per lo spegnimento rapido del vecchio stack

1. **CF-03 + CF-00:** completare Workers Auth/Session con email/password minimo 15 caratteri, Google, email verifica/reset, maggiorenne, issuer/CSRF, limite tentativi, anti-bot, session recovery e privacy email. Provider email definitivo richiede prova API Workers e assenza tracking non richiesto.
2. **CF-05:** collegare consenso sanitario trusted e revoca, ADK/cloud KEK + DEK device indipendente, cifratura solo client, erase/export e anti-replay. Il server non deve conoscere plaintext salute.
3. **CF-04 + CF-02:** collegare journal D1 e hydration a identità e consenso reali, con commit/ACK verificabili, offline, multitab/multi-device, crash/lost ack/GC, Safari/iOS e protezioni quote Free. Mai mutare una replica sulla base di un mock non trusted.
4. **CF-06 + CF-08:** convertire Vercel Functions/Cron, cancellazione account e soli dati, inattività, diritti, backup/restore, retention, supporto failure/retry/rollback senza perdita.
5. **CF-07 + CF-09:** misurare CPU, query, storage e rate su Cloudflare Free e sicurezza/abuso; verificare worker/static hosting, URL alternativi, DNS, TLS, mail, Google OAuth, privacy, legal/GDPR, accessibilità, PWA update/rollback su dispositivi reali. **GO separato** per dominio e dismissioni; nessun billing/upgrade implicito.

Le componenti indipendenti possono procedere in parallelo a CF-00. Una dipendenza non verificata non può essere attivata in un percorso reale. Non aspettare il completamento di tutta la piattaforma per realizzare incrementi isolati, ma **non mantenere il vecchio provider per proteggere account pre-lancio inesistenti**.

## Gate non negoziabili

- **CI:** branch dal vero GitHub main, PR draft, exact-SHA suite e CodeQL, review dove richiesta, squash merge, gate main/post-merge e smoke provider separati. Un test verde non prova Production.
- **D1/provider:** utilizzare risorse e dati **sintetici isolati**; binding, route/preview/hostname e account verificati prima di qualsiasi deployment. Misurare costi/Free e recupero quando una quota termina: errore chiaro, nessun ACK fictizio, journal preservato.
- **Privacy:** `eu` di D1 non certifica la residenza di Workers, log, OAuth o email. Verificare regioni, DPA/retention e flussi; nessun dato sanitario in chiaro o chiave nel repository.
- **Rilascio:** il cutover `thelogbook.me`/OAuth/posta richiede il GO esplicito del product owner. Verificare Auth, consenso, export/delete, cifratura, sync, cron, backup/restore, offline/Safari, sicurezza, PWA update e rollback. Dismissione provider/chiavi e cancellazioni irreversibili richiedono ulteriore mandato specifico e inventario live.
- **Rollback:** solo verso una release **Cloudflare valida** della nuova baseline; non riattivare il precedente Firebase Hosting. Proteggere i dati creati dopo il fresh start, non riadattare formati pre-lancio.

## Tracciamento

[AGENTS](../../AGENTS.md), [Storage e sync](../../.agents/rules/storage-and-sync.md), [Crash consistency](../../.agents/rules/crash-consistency.md), [Cifratura](../../.agents/rules/secure-storage.md), [Consenso](../../.agents/rules/health-consent.md), [CI](../../.agents/rules/ci-verification.md); [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053), [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054), [CF-01 #1055](https://github.com/gernotfound/logbook/issues/1055), [CF-02 #1056](https://github.com/gernotfound/logbook/issues/1056), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059), [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060), [CF-07 #1061](https://github.com/gernotfound/logbook/issues/1061), [CF-08 #1062](https://github.com/gernotfound/logbook/issues/1062), [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063) e [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041). Dettagli dei vecchi cutover nella cronologia Git, **non istruzioni attive**.
