# Cloudflare full-stack — sviluppo, verifiche e cutover TheLogBook

**Stato:** sviluppo CRITICAL / fresh start, audit branch 13 novembre 2026. Questo è il runbook operativo corrente; non è una prova di rilascio Production. Le informazioni temporali vanno aggiornate dopo ogni merge o prova provider. [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053), [registro servizi](external-services-register.md), [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041).

## Decisione di prodotto e sequenza di abbandono

**Database e account precedenti vuoti secondo il product owner.** Il sistema Cloudflare partirà con **nuove identità, chiavi, consensi e dati**, senza trasferimenti Firebase/Vercel e senza adapter o formati di compatibilità pre-lancio. Conservare invece la normale funzione import/export per i dati generati nel nuovo sistema, la durabilità locale e tutti i diritti previsti.

**Abbandonare Firebase/Vercel il prima possibile**, non lasciarli attivi per un'ipotetica migrazione di utenti. Tuttavia oggi il codice PWA richiama ancora Firebase Authentication, Firestore/App Check e le Functions Vercel; il candidato D1 non è collegato al runtime. La rimozione anticipata di questi chiamanti romperebbe login, consenso, sincronizzazione e diritti. Realizzare vertical slice coerenti e testate sul nuovo stack, poi disattivare subito il precedente percorso secondo l'autorizzazione provider pertinente. Nessun dual-write o backfill.

La dichiarazione di database vuoto non è un inventario provider e non autorizza cancellazioni/reset fisici. Il cutover del dominio `thelogbook.me`, OAuth, posta Production e la dismissione irreversibile richiedono un GO specifico, anche senza utenti da migrare.

## Incremento CF-03 integrato — gate di sessione interno (non distribuito)

La [PR #1076](https://github.com/gernotfound/logbook/pull/1076), integrata su `main c2352c5e23e4daf1e71f3224fdf315ab8bfefe7b`, aggiunge migration D1 `0003_auth_session_gate.sql`,
`cloudflare/auth/session-gate.mjs` e regressioni SQL/HTTP sintetiche.
Il nuovo endpoint è **esclusivamente un service binding privato**, con cookie
`__Host-logbook_session` hashato, CSRF hashato, status/email verificata,
revoca/scadenza, generazione Auth allineata al fence del consenso e rate limiter
di sessione obbligatorio. Si usa una SELECT sulla D1 primaria per ottenere
le prove coerenti; gli errori non restituiscono dati o SQL. Mancano ancora
issuance Auth reale (password/Google), verifica/reset email, consent provision,
API live, CPU/quote e test su provider. Nessuna migrazione di account
Firebase, nessun deploy o DNS. Riferimento a [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).
La configurazione Mailjet e la sua verifica vengono svolte in un filone
separato; questo incremento non modifica provider email.

## Incremento CF-03 integrato — issuer di sessioni (non esposto)

La [PR #1078](https://github.com/gernotfound/logbook/pull/1078), integrata su `main d744f0ff1d5828329e78188396dcc4aacc6cd987` (CI PR e main riuscite), aggiunge `cloudflare/auth/session-issuer.mjs` per l'emissione di cookie
sessione/CSRF solo **dopo** una futura autenticazione trusted valida.
La creazione D1 è condizionata atomicamente a principal attivo ed email
già verificata, con `auth_epoch` corrente. Il token HttpOnly resta
indipendente dal CSRF leggibile dal frontend, che sopravvive a reload e
nuove schede senza salvare il token di sessione nel JavaScript. Con consenso
assente la sessione può esistere, ma il gate interno non autorizza
sincronizzazione. Non c'è ancora un endpoint pubblico di login/Google,
consenso o invio email, né deploy/provider; il nuovo issuer rimane un
componente interno isolato. I test di prova sono Node/SQLite sintetici.

## Incremento CF-05 integrato — primo consenso trusted (non distribuito)

La [PR #1079](https://github.com/gernotfound/logbook/pull/1079), integrata su `main fc1423cc03bc488787d218a7f13b184f4c410ae7` (2.388.0), ha aggiunto un Worker HTTP candidato per stato e accettazione iniziale, con contratto frontend `unregistered`/`revision`/`acceptedAt` ISO, input `acceptedTerms`, `acceptedHealthData`, `confirmsOver18`, versioni legali correnti e CSRF. D1 schema `0004`: prova
immutabile in una transazione insieme a subject e sync_state; il gate
interno ne richiede l'esistenza prima di qualsiasi replica. Consenso mancante, prova incompleta, versione legale superata o generazione
sfasata non autorizzano replica, anche con cookie Auth valido. La revoca e
la riaccettazione sono **NON IMPLEMENTATE**, così come issuer Auth reale
e i diritti; nessuna route pubblica o migration provider applicata.
Questo codice non abilita la PWA: serve completare l'intero ciclo di consenso
prima del rilascio. Vedi [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059).

## Audit della sessione e del contesto — candidato su branch (13/11/2026)

Durante l'audit post-PR #1081 è stata rilevata una finestra AuthGate→D1:
una revoca della sessione già confermata poteva precedere il primo INSERT
di un commit cifrato o di una mutazione replica, perché i trigger iniziali
verificavano consenso/epoch/lease/revisione ma non il **token di sessione
revocato**. La correzione candidata fa passare il digest del token attraverso
il solo service binding privato e lo ricontrolla nella stessa prima INSERT
SQL (senza cambiare il formato o le tabelle). Una revoca/scadenza, un
principal disabilitato o una generazione diversa provocano errore di
vincolo e rollback dell'intero batch. La correzione aggiuntiva **sullo stesso branch** estende il guard
anche alle SELECT che restituiscono snapshot cifrati, pagine, registro
repliche e ricevute. L'autorizzazione passa nella stessa query sulla D1
primaria, con batch SQL atomico per le pagine e per le letture composte.
Una revoca confermata *prima della transazione* blocca l'operazione;
una risposta già autorizzata e in volo dopo quella transazione non può
essere richiamata retroattivamente.

Regressioni SQL/HTTP dedicate: logout nel tratto gate→D1, perdita del
token, scadenza, epoch divergente, letture/ACK negati dopo revoca e
nessun documento/receipt fantasma. **Candidato sul branch #1083,
non distribuito**. Registrare gli esiti CI solo dopo la verifica
exact-SHA; i test Node/SQLite non dimostrano il runtime remoto.

### API unica integrata prima di questo audit (PR #1081)

Il candidato HTTP in `cloudflare/api/worker.mjs` riunisce
`/v1/sync/*`, `/v1/consent/status`, `/v1/consent/initial` e
`POST /v1/auth/logout`. Logout revoca una sola sessione; richiede
CSRF, origin e una conferma della revoca stessa prima di cancellare
i cookie HttpOnly e CSRF. Non cancella archivi locali né revoca altre
sessioni. La vecchia configurazione Wrangler separata del consenso
è stata rimossa; rimane soltanto la configurazione locale dell'API.
PR [#1081](https://github.com/gernotfound/logbook/pull/1081):
[CI PR #43488510948](https://github.com/gernotfound/logbook/actions/runs/43488510948)
e [CI main #43489162305](https://github.com/gernotfound/logbook/actions/runs/43489162305)
**SUCCESS** sul relativo SHA, senza prova Worker remoto.

## Stato verificato — prove separate

| Area | Evidenza | Non dimostra |
|---|---|---|
| Repository | [PR #1070](https://github.com/gernotfound/logbook/pull/1070), [#1072](https://github.com/gernotfound/logbook/pull/1072), [#1076](https://github.com/gernotfound/logbook/pull/1076), [#1078](https://github.com/gernotfound/logbook/pull/1078), [#1079](https://github.com/gernotfound/logbook/pull/1079) e [#1081](https://github.com/gernotfound/logbook/pull/1081) integrate. Checkpoint main letto durante l'audit: `4e25427ffbe0a4f4a7a695d25dec211b4ff16200` (2.393.0; merge della PR #1085, successivo al lavoro sui test). CI #1081 [PR #43488510948](https://github.com/gernotfound/logbook/actions/runs/43488510948) e [main #43489162305](https://github.com/gernotfound/logbook/actions/runs/43489162305) **SUCCESS**, inclusi CodeQL e gate exact-SHA | Nuovo Worker Auth/consenso, API e replica pubblicati o runtime Cloudflare verificato |
| Frontend Cloudflare | Worker `thelogbook-frontend` su `workers.dev` e [smoke Static Assets #43223911523](https://github.com/gernotfound/logbook/actions/runs/43223911523) riuscito | Auth, Safari/iOS, update PWA, API e dominio finale |
| D1 sandbox | `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`, read replication OFF: schema `0001` + `0002` applicate e indice/trigger anti-riuso riletti via Cloudflare; un UID e un documento **sintetici**, zero mutation di replica | Database reale, HTTP Worker, performance Free, conformità GDPR |
| Nuova API | `cloudflare/api/worker.mjs`, `cloudflare/auth/session-gate.mjs`, issuer e `cloudflare/api/consent-worker.mjs` e `logout-worker.mjs` integrati nel repository come ingresso unico, ma senza Auth password/Google reale, binding remoto o collegamento al client. SQL 0003/0004 solo versionate, non applicate su D1 Cloudflare | Runtime Auth, consenso, cancellazione o replica cloud utilizzabili |
| Recupero claim D1 | [PR #1072](https://github.com/gernotfound/logbook/pull/1072) **MERGED**: ristaging durevole nel vault di claim già committato quando è avanzato soltanto il clock; receipt/lease/seq/checkpoint e AEAD verificati; lease scaduto durante scan rifiutato nella transazione | Non è integrazione AuthGate o API Production; nessun ACK o grant sul ristaging |
| Email | [PR #1077](https://github.com/gernotfound/logbook/pull/1077) ancora draft parallela: record TXT Mailjet sotto `notify.thelogbook.me` confermati anche con lettura Cloudflare il 13/11; nessuna conferma SMTP/API/MIME o sessione Auth. Brevo registra tracking | Mailjet validato e collaudato su Worker, tracking e DNS definitivi, ritiro Brevo |
| Vercel | Verifica provider del 13/11: deployment backend precedente `READY` su `4e25427ffbe0a4f4a7a695d25dec211b4ff16200`; i tentativi intermedi su altri SHA risultano `CANCELED`. Non è un Worker Cloudflare | Cloudflare Production o cutover DNS |

Il vecchio Hosting Firebase `thelogbook` è disabilitato secondo il comando CLI attestato dal proprietario; il workflow GitHub Hosting risulta dichiarato disabilitato, ma non è stato letto autonomamente come `disabled_manually`. Non riattivarlo come rollback.

## Architettura già implementata nel candidato isolato

**Storage D1.** Le migration `cloudflare/api/migrations/0001_encrypted_replica.sql` e `0002_reject_reused_replica_ids.sql` creano schema per soggetto/consenso/epoch, revisione CAS, registro repliche, documenti root/mensili cifrati, mutation e receipt immutabili. Trigger e vincoli bloccano rollback di revisione/epoch, sequenza regressiva, identità storica riutilizzata dopo il cambio slot. La seconda migration contiene un indice `(uid, replica_id)` per non eseguire scansioni lineari del ledger. Le migration `0003_auth_session_gate.sql` e `0004_initial_consent.sql` sono integrate nel repository, **non applicate alla D1 sandbox Cloudflare**: modellano principal/sessioni hashate, primo consenso e proof immutabile. **La presenza dello schema non implementa erasure/restore né Auth reale.** Gli script `rollback/` sono solo per database disposable: mai su dati reali senza autorizzazione.

**Worker e protocollo.** `cloudflare/api/worker.mjs`, `replica-maintenance.mjs`, `d1-document-store.mjs`: POST con body/documenti limitati, schema Zod strict, same-origin, CSRF e claim `AUTH_GATE` verificati prima di ogni accesso, con ulteriore prova di sessione dentro il SQL di lettura/scrittura sul candidato branch. CAS D1 e mutazioni immutabili hash-bound, batch atomicamente trigger-fenced. Fino a otto documenti cifrati, massimo 950 KB per documento: body cap complessivo coerente, ma **non ancora misurato sul Worker Free**. Niente AuthGate mock in runtime reale, no trusted identity via header controllabile dal client.

**Client.** `cloudReplicaTransport.ts` verifica revisioni, epoch e pagine complete; `cloudReplicaCheckpoint.ts` apre e autentica via AEAD tutti i documenti prima dell'adozione; `cloudReplicaCommit.ts` ricostruisce un batch D1. `cloudReplicaDurableDelivery.ts` salva nel vault IndexedDB owner-scoped l'intero batch ciphertext e il prefisso journal **prima** della rete. La receipt della richiesta originale autorizza soltanto l'ACK transazionale del prefisso identico, mai un successo inventato dopo timeout. `cloudMergeEngine.ts` è il core puro condiviso con il writer Firestore ancora attivo. **La nuova rete D1 non passa ancora per `replicateJournal()`.**

**Claim e retirement.** Una richiesta di mutazione replica è resa durevole nel vault con mutationId immutabile. Il retry usa gli stessi byte e un 409 non prova l'assenza di commit. `replica/status` legge **insieme** dalla D1 primaria il ledger e la revisione: soltanto `not-committed` + revisione ormai avanzata autorizzano una nuova richiesta **persistita prima della rete**, senza ACK di business. Una ricevuta storica non è un grant di membership; adozione di claim richiede la stessa incarnazione attiva/lease/seq/checkpoint, due controlli remoti identici e full scan AEAD con clock coerente. Il retirement committato può concludere come `retired` oppure `superseded` quando nuova generazione/differente replicaId sono dimostrati; chiude **solo l'intento amministrativo**, mai journal o GC.

La PR #1072 **già integrata** implementa per claim committati con **solo clock cloud avanzato** la scansione AEAD, il doppio controllo stabile e il ristaging dell'intento con nuovo mutationId/clock, persistito prima del retry. Se il lease scade durante lo scan, la verifica ulteriore e il guard nella transazione IndexedDB impediscono l'adozione. Repliche ritirate/riusate, lease/seq/checkpoint mutati, consenso/epoch o controllo instabile restano fail-closed. Questa prova in CI non sostituisce l'integrazione HTTP Worker/Auth/PWA.

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
