# Cloudflare — quadro operativo per lo sviluppo

**Checkpoint Impostazioni/legacy, 27/11/2026:** [PR #1472](https://github.com/gernotfound/logbook/pull/1472)
integrata con squash in [`main` `91e518cf`](https://github.com/gernotfound/logbook/commit/91e518cfc01479617d2945bfcc820368c35225b7),
v2.735.0, tree identico al candidato `f86f09bd` (`33be0e40`).
[CI PR exact-SHA, Canonical, CodeQL ed E2E](https://github.com/gernotfound/logbook/actions/runs/45910003654),
[Main Release Gate/CodeQL](https://github.com/gernotfound/logbook/actions/runs/45910368351)
e [Static Assets/smoke byte-esatto](https://github.com/gernotfound/logbook/actions/runs/45910632841)
`success`. Readback diretto Cloudflare frontend: deployment
`b8771c81-85fc-4e5f-ba9e-4393ed295bfe`, versione
`36add0dc-c71e-43c7-9f19-b88a2ffe2edf` al 100%; binding
`APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`, **non `D1_API`**, zero cron frontend.
[API/Auth Gate](https://github.com/gernotfound/logbook/actions/runs/45910632869),
[Kinde](https://github.com/gernotfound/logbook/actions/runs/45910632845)
e [Firestore](https://github.com/gernotfound/logbook/actions/runs/45910632556)
`success`, ma rispettivi deploy privati/Rules/indici **skipped**.
Gli hook Impostazioni non importano più staticamente le operazioni Firebase
di account/erasure: il guest usa solo il lifecycle locale, mentre le azioni
legacy caricano i moduli su richiesta con guard sessione/epoch anche dopo
l'import asincrono. Testati import guest senza SDK e A→B→A; il build
segnala ancora import statici da `AccountCard`, `HealthConsentSuspended`,
`EmailVerificationGate` e altri ingressi. Nessuna prova di bundle/UI guest
interamente SDK-free, né attivazione fitness Kinde/D1, cutover o GO.
[Registro servizi](external-services-register.md).

**Checkpoint backup device, 26/11/2026:**
[PR #1470](https://github.com/gernotfound/logbook/pull/1470) integrata nello
SHA [`2f83df6b`](https://github.com/gernotfound/logbook/commit/2f83df6b69e62fda361c8a4c2353acc5e1ab1f92),
v2.733.0; [CI PR](https://github.com/gernotfound/logbook/actions/runs/45903802688),
[Main Release Gate/CodeQL](https://github.com/gernotfound/logbook/actions/runs/45904225106)
e [Static Assets/smoke byte-esatto](https://github.com/gernotfound/logbook/actions/runs/45904526451)
`success` sui rispettivi SHA. Readback Cloudflare frontend: deployment
`56ee8f04-8744-4a81-8893-68884061fb38`, versione
`2305567f-207c-4aff-a524-e803270c152c` al 100%, binding
`APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`, **non `D1_API`**. Quattro Worker senza
cron; le due D1 isolate hanno `jurisdiction=eu`. Workflow API/Auth Gate/Kinde
e Firestore `success`, ma passi di deploy privati/Rules saltati. Il nuovo
backup device non importa Firebase; l'export cloud legacy è caricato su richiesta
con guard di sessione/epoch. Altri import Firebase in Impostazioni e sospensione,
e la verifica runtime completa guest/fitness Kinde restano **aperte**.
Nessuna attivazione API/D1 pubblica, dati reali, cutover o GO.
[Registro servizi](external-services-register.md).

**Checkpoint applicativo post-merge, 26/11/2026:** la [PR #1468](https://github.com/gernotfound/logbook/pull/1468)
ha integrato la separazione del consenso guest/legacy da Firebase statico su
[`main` `926ccbd3`](https://github.com/gernotfound/logbook/commit/926ccbd3c9ae8d42d1595bee5e445cdf48fa3032),
v2.731.0. [CI PR](https://github.com/gernotfound/logbook/actions/runs/45896360753),
[gate main/CodeQL](https://github.com/gernotfound/logbook/actions/runs/45896852214)
e [Static Assets/smoke](https://github.com/gernotfound/logbook/actions/runs/45897147455)
sono `success`; deployment frontend `7bd7662f-36ba-4c89-a973-53d4d5b16f62`
al 100% rilevato direttamente su Cloudflare. Il frontend mantiene tre binding
(`APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`), **senza `D1_API`**; quattro Worker
ancora senza cron. I deploy API/Auth Gate/Kinde sono stati saltati, così come
Firestore Rules/indici. Il codice non abilita account fitness né costituisce
prova live di consenso/ADK/D1, diritti, browser o GO. [Registro servizi](external-services-register.md).

**Readback più recente per le D1 e i binding (26/11/2026, dopo i dispatch manuali):**
`main` GitHub [`0b331f26`](https://github.com/gernotfound/logbook/commit/0b331f26b0c8cd204e71910f76445023aa75d755)
v2.718.0; [migrazione CF-02 #4](https://github.com/gernotfound/logbook/actions/runs/45843978632)
su exact SHA, `upgrade_existing_test_db_0020=true`, con preflight
`11/20`, postflight `20/20`, controllo digest dei record sintetici e Time
Travel bookmark superati. Readback Cloudflare: D1 applicativa isolata
giurisdizione `eu`, ledger contiguo `0001–0020`, replication disabilitata;
tre principal, 29 sessioni, un subject e un documento sintetici invariati;
inattività `paused` e dispatcher/scheduler inutilizzati. La
[migrazione recovery #2](https://github.com/gernotfound/logbook/actions/runs/45823509877)
ha applicato `0005`, e il registro recovery ha ledger `0001–0005`.
Quattro Worker senza cron; il frontend `thelogbook.me` espone ancora soltanto
`APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`, **non `D1_API`**. L'API privata conserva
due D1 distinte, `AUTH_GATE` e la KEK nel solo binding `secret_text` (non ne è
stato letto il valore). **Nessun nuovo percorso fitness attivato, nessun GO**.
Il [modello delle minacce ADR-2](../architecture/cloudflare-trust-boundaries.md)
distingue i guard attuali dalle prove mancanti. I checkpoint datati sotto
restano storici e non prevalgono su questo readback.

**Candidato CF-06, 26/11/2026 — pin recovery esterno unico:** tutte le
modalità scheduled (sanità, cancellazione applicativa, alternanza e inattività)
richiedono ora `CF06_RECOVERY_GENERATION` dalla configurazione trusted, oltre
ai rispettivi opt-in; non adottano la generazione del registro D1 dopo un
restore. Un pin mancante tiene il processore in pausa; uno obsoleto blocca
l'avvio prima di lease/turni applicativi. La ripresa esige la verifica esterna
di quiescenza e continuità, non solo un nuovo numero. Modifica candidata,
non attivazione o collaudo Cloudflare: manifesti senza cron/flag e niente GO
per cancellazioni reali.

**Checkpoint CF-07, 26/11/2026 — contratto HTTP candidato:** i limiti
di lunghezza dichiarata sono ora per-route nella policy pura condivisa:
gateway, API replica e consenso leggono lo stesso budget, senza importare
Zod nel frontend. Le route che richiedono un body vuoto hanno budget
zero; il batch cifrato mantiene il limite per otto documenti. I Worker
privati continuano a verificare i byte effettivi dello stream, perché
`Content-Length` può essere assente o falso. I test sintetici attraversano
anche gateway → API con contenuto oltre soglia e gateway → Kinde con
finta lunghezza zero. Questo contratto **non pubblica** le route D1,
non attiva consenso/fitness e non misura quote CPU o righe fatturate.

**Ultima baseline remota verificata prima dell'incremento, 26/11/2026:**
`main` v2.714.0, SHA [`6381fd22`](https://github.com/gernotfound/logbook/commit/6381fd2259ccd4a3689cc2bfd76655eb3332f46a),
dopo [#1451](https://github.com/gernotfound/logbook/pull/1451). La
[CI PR](https://github.com/gernotfound/logbook/actions/runs/45787798154),
il [gate main e CodeQL](https://github.com/gernotfound/logbook/actions/runs/45788299872),
il [deploy API/AuthGate](https://github.com/gernotfound/logbook/actions/runs/45788693084)
e lo [Static Assets/smoke](https://github.com/gernotfound/logbook/actions/runs/45788693340)
sono riusciti. Kinde e Firestore hanno riconciliato senza redeploy del
Worker Kinde né delle Rules. GET Cloudflare 26/11: frontend solo
`APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`, nessun `D1_API`; quattro Worker
con zero cron; KEK API rilevata solo come binding `secret_text`. Nessuna
lettura del suo valore, migrazione D1 remota o prova fitness reale.
La CI e i deployment del successivo incremento vanno verificati sullo
SHA effettivamente integrato, non dedotti da questo checkpoint.

**CF-04 catalogo statico candidato (26/11/2026):** presenti un generatore
di pacchetti statici versionati con impronte SHA-256 e un adapter di
download/cache fail-closed con test sintetici. I due seed bundled sono
intenzionalmente vuoti. Il candidato non è montato in app e non è
pubblicato su Cloudflare: mancano contenuti/licenze verificati,
asset reali e prova HTTP sul dominio. Le letture catalogo Firestore
rimangono confinate al loader cloud legacy. Per staging, contratto
di integrità e requisiti di attivazione vedere
[operazioni catalogo](../../.agents/rules/catalog-operations.md).

**Preflight migrazioni isolate (contratto del 26/11/2026):** il workflow manuale della D1 applicativa confronta prima/dopo sia i conteggi sia le impronte SHA-256 dei record sintetici esistenti (identità, sessioni, replica, documenti cifrati e ricevute). Le letture sono bounded, i dati non vengono pubblicati nei log e il confronto blocca il gate su alterazioni con conteggi invariati. Le query sono separate, quindi non attestano uno snapshot atomico in presenza di scritture concorrenti. L'esecuzione effettiva e il ledger aggiornato sono attestati nel readback in apertura, non dalla presenza del workflow nel repository.

**Baseline remota verificata il 25 novembre 2026 prima dell'incremento quota CF-06:** `main` v2.706.0, SHA [`328796a4f72915162d084b9d7749e237e2948125`](https://github.com/gernotfound/logbook/commit/328796a4f72915162d084b9d7749e237e2948125), dopo squash [#1443](https://github.com/gernotfound/logbook/pull/1443). La [CI PR](https://github.com/gernotfound/logbook/actions/runs/45711218867) e la [CI post-merge](https://github.com/gernotfound/logbook/actions/runs/45711823585) risultano success sul rispettivo SHA; [Static Assets e smoke](https://github.com/gernotfound/logbook/actions/runs/45712176120) success sullo SHA `main`. I Worker privati API/Kinde hanno saltato il redeploy perché non pertinenti al diff; Firestore ha riconciliato senza ridistribuire Rules/indici. Lettura Cloudflare separata del 25/11: quattro Worker senza schedule, due D1 LogBook con giurisdizione EU, ledger precedentemente attestato 0011 applicativo e 0004 recovery; frontend deployment `b4d5446c-f20c-40af-b9db-c69e55fabd4b` al 100%. Le migrazioni candidate non risultavano applicate durante la lettura del ledger. I dati provider restano uno snapshot datato, non una prova del runtime dello SHA nuovo. Rileggere HEAD e provider prima di ogni nuovo task. Questa mappa distingue codice su [`main`](https://github.com/gernotfound/logbook/tree/main), runtime pubblico, letture Cloudflare e prove funzionali. Non è una certificazione Production e non autorizza GO, billing, cancellazioni, DNS, OAuth Production o modifiche irreversibili. Le versioni e i commit dei singoli interventi sono nelle [issue CF](https://github.com/gernotfound/logbook/issues/1053); rileggere sempre l'HEAD reale.

## Ultima integrazione verificata

- **#1428–#1431 su `main`**: #1428 (`ffd73118`), #1429 (`48773f70`), #1430 (`cf694c06`) e #1431 (`6f142ce5`). La [PR #1431](https://github.com/gernotfound/logbook/pull/1431) verifica che il censimento restore non accetti una lettura incompleta delle decisioni di cancellazione account nel registro indipendente; confronto dei conteggi per tutte le sorgenti e regressioni al limite 512/513. Sul candidato `b9a99599` sono passati 15 test locali mirati e [CI PR exact-SHA](https://github.com/gernotfound/logbook/actions/runs/45663118276). Sul merge `6f142ce5`, anche il [Main Release Gate e CodeQL post-merge](https://github.com/gernotfound/logbook/actions/runs/45668217803) sono riusciti; gli shard PR non sono stati ripetuti sul push. Il risultato rimane **`consistent-for-diagnostics-only`**: letture separate fra D1 non formano uno snapshot distribuito e non autorizzano restore live né GO. Le prove post-merge e provider hanno perimetro proprio e vanno registrate separatamente.
- #1424–#1427: pin anti-restore, continuità del tick sanitario, checkpoint diagnostico 0016 e ingresso esplicito con preflight pausa 0013+. #1427 [CI exact-SHA](https://github.com/gernotfound/logbook/actions/runs/45613825459) verde e squash `44cedc84`; gate e deployment successivi da rileggere. #1426 su `714b9e14`: [gate main](https://github.com/gernotfound/logbook/actions/runs/45613562087), [Static Assets](https://github.com/gernotfound/logbook/actions/runs/45614057876), [API privata](https://github.com/gernotfound/logbook/actions/runs/45614057388), [Kinde privato](https://github.com/gernotfound/logbook/actions/runs/45614057610), [Firestore](https://github.com/gernotfound/logbook/actions/runs/45614057741) tutti success. Migrazioni non applicate; nessun cron.
- Boundary HTTP candidato `/v1/account/activity` con opt-in server assente, identità/CSRF/rate gate, registry account e clock primario, con adattatore browser candidato esplicito (CSRF/session fence, visibilità, online e ricevuta stretta), collegato alla sola schermata candidata con opt-in `candidateActivityEnabled`. Il click trusted può registrare anche una consultazione. Il reporter mantiene il limite di frequenza tra aggiornamenti della stessa sessione. Il percorso pubblico `identityOnly` resta escluso. Non è tracking attivo.

- #1407 ha integrato su `main` v2.670.0 (`46725d7d8b3bb4bf3b640052ced6eb05821558ab`) l'orchestrazione post-verifica dei Worker privati e il checkout CodeQL main a profondità 1. [CI candidata](https://github.com/gernotfound/logbook/actions/runs/45447265920) riuscita; attestazioni post-merge e prestazioni effettive da rileggere separatamente. Nessuna migrazione SQL o nuova route autorizzata da questo incremento.

- [CI PR #1405](https://github.com/gernotfound/logbook/actions/runs/45440872427), [gate main e CodeQL](https://github.com/gernotfound/logbook/actions/runs/45441648072), [Static Assets e smoke byte-esatto](https://github.com/gernotfound/logbook/actions/runs/45443109699), [API D1 privata](https://github.com/gernotfound/logbook/actions/runs/45441648108), [Kinde privato](https://github.com/gernotfound/logbook/actions/runs/45441648166) e [riconciliazione Firestore legacy](https://github.com/gernotfound/logbook/actions/runs/45443109842): tutti success sullo SHA pertinente. Un workflow privato/Firestore verde non prova una scrittura provider se i passi di deploy erano skipped.
- #1386 ha integrato i diff audit FIX/TST; le checklist #1322/#1327 non certificano per questo tutti i file. Gli incrementi CF successivi #1387–#1405 sono antenati del checkpoint.
- #1391/#1393/#1397/#1399: clock primario D1, prova temporale consenso/sessione e scadenza locale conservativa. #1403: finalizzazione sanitaria vincolata al lease esatto.
- #1404: candidato cancellazione account Kinde con riferimento cifrato, riautenticazione, intento durevole, deny indipendente, pulizia owner-scoped e prova Kinde-last. #1405: marker foreground con clock D1, inattività 12 mesi calendari UTC, margine conservativo di aggregazione, selezione dry-run max 16, controllo inizialmente paused e pulizia del marker dell'owner. Nessuna nuova rotta o cron attivato.
- #1409–#1411: recupero floor consenso pending, dispatcher account e checkpoint persistente con lease SQL; su main v2.675.0 `b9ff4ba8a1c29597d86d7903ac506cf8d07e4920`, [CI candidata #1411](https://github.com/gernotfound/logbook/actions/runs/45524834759) riuscita. Migrazione candidata 0014, nessuna nuova prova di applicazione remota o schedule. L'[inventario D1](cloudflare-d1-data-inventory.json) separa cleanup e prove mantenute, con guard sullo schema in CI; non certifica retention legale.
- **SYNC-7:** #1058, limite candidato di cinque membership D1 con lease valido (incluso skew), distinto dalle 16 coordinate causali. La 0018 introduce guard SQL per insert/update, conserva history e receipt, rifiuto 409 tipizzato senza ACK o cancellazione dell'intento. La 0019 candidata aggiunge retirement esplicito con conferma esatta, modo nel ledger, CAS e staging/replay cifrato. Il candidato successivo aggiunge `replica/cancel`: avanzamento CAS della sola revisione se l'intento non ha receipt e può ancora committare; marker cifrato di annullamento prima della rete, replay normale sospeso, readback primario definitivo e rimozione del solo intento non committato con owner/epoch/session fence, senza ACK. Il bridge di registro osserva senza vault/claim con doppio control owner-bound e consenso trusted. L'incremento v2.704.0 aggiunge nel solo candidato una selezione esplicita e confermata di replica tecnica, confronto del testimone dopo la hydration AEAD di un eventuale sesto device senza claim, staging cifrato prima della rete, controllo delle ricevute e pulsante distinto di recupero dopo timeout; nessun ACK del journal. Con #1442 v2.705.0 il pannello candidato espone anche l'annullamento confermato della richiesta claim/retirement già sigillata con mutationId esatta e riconciliazione separata dal commit originale. Il controllo UID è obbligatorio anche per i lease scaduti, inclusi rebase e chiusura. Restano il rientro di un device ritirato, quote/abuse e le prove remote; il frontend pubblico resta identity-only.
- **Prossimo lavoro indipendente:** lo step candidato di scansione enqueue è distinto dal dry-run, legge una pagina bounded e tenta al massimo una decisione; lo scheduler candidato 0017 mantiene checkpoint/lease durevole separato, con lease corrente verificato nella scrittura dell'intento. L'ingresso scheduled `inactivity-enqueue` è protetto da due opt-in espliciti e pin recovery esterno, **assenti dal manifesto senza cron**; non equivale ad attivazione. La regressione candidata dei fallimenti D1 Free inietta outage persistente dopo ogni operazione SQL di entrambi i database, prova assenza di falsa conferma e ripresa senza duplicare intenti: non misura righe fatturate o CPU live. Lo scheduler account aggiunge un backoff per owner nel candidato 0020, con lease SQL e nessuna autorizzazione erasure aggiuntiva; restano budget/quote effettivi, verifica end-to-end sul provider isolato e collegamenti mancanti del lifecycle. Non ripetere le funzioni candidate già integrate. Separare i blocchi esterni (Kinde auth_time, Management, custodia KEK, test live e privacy).

## Implementato, montato e verificato sono cose differenti

| Percorso | Codice presente | Montaggio e prove osservati | Gate ancora aperto |
| --- | --- | --- | --- |
| PWA React e Static Assets | Guest locale, storage cifrato, app fitness legacy | Frontend Worker su `thelogbook.me`; `GuestOnlyAuthProvider` ancora montato | Installazione, aggiornamento, recovery e Safari/iOS su dispositivi reali |
| Identità Kinde | Gateway OAuth/sessione, observer React condiviso, login/logout | Il pubblico usa `KindeAccountSessionProvider` e `KindeAccountEntry identityOnly`. Il proprietario ha osservato accesso Google, logout applicativo e rientro esplicito il 21/11 ([CF-03](https://github.com/gernotfound/logbook/issues/1057)) | Verifica/reset email, policy provider, account linking, sessioni, browser e UX complete |
| Fitness account Kinde **isolato** | `KindeCandidateFitnessPanel`, realm con owner/fence, profilo biometrico, pianificazione macro, diario/storico pasti, integratori, misure/sonno, passi/cardio, seduta attiva, editor dei cicli, storico allenamenti consultabile, modificabile ed eliminabile, schede ed esercizi personali con recupero della bozza cifrata ([CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057)) | Disponibile come percorso candidato `candidateMode='fitness'`, non montato nel pubblico `identityOnly`; editor separati dal writer Firebase | Catalogo globale, lifecycle account completo e prove su account/dispositivi reali |
| Replica Workers/D1 | Worker API/Auth Gate, schema SQL, journal cifrato e ricevute D1; percorso candidato con commit prima della rete | Worker API privato e frontend **senza** binding `D1_API`; prove isolate sintetiche del realm | Roundtrip reale multi-device, lost ACK, concorrenza, offline, quote e fail-safe |
| Consenso, cifratura e diritti | Consenso iniziale, ADK/vault, export/restore, revoca e rights-only candidati | `CLOUD_ACCOUNT_KEK_V1` presente come `secret_text` nel Worker API privato; nessun grant fitness nel provider pubblico | Recuperabilità indipendente della KEK, consenso/revoca/restore/erasure reali, privacy e protezione anti-resurrection |
| Erasure e inattività | Finalizzatore lease-fenced, pipeline account Kinde, dispatcher e checkpoint persistente, ingresso account e alternanza candidata, marker foreground, scanner dry-run con checkpoint 0016 e ingresso diagnostico opt-in; modalità enqueue separata con checkpoint 0017 e ulteriore opt-in; backoff owner nella 0020, tutto senza schedule nel [manifest CF-06](../../cloudflare/jobs/README.md) | GET 26/11: zero schedule sui quattro Worker; D1 applicativa ledger 0001–0020 e recovery 0001–0005 applicati e riletti. Scanner `paused`, scheduler e dispatcher inattivi | Riautenticazione reale, route/ricevute device, collaudo foreground su provider e dispositivi, montaggio autorizzato runner, test backoff live e permessi Management, recovery, quote, privacy e prova Kinde-last |
| Free, abuso e privacy | Rate-limit binding, verifiche statiche, smoke e test con dati sintetici | Nessun GO utenti esterni o account fitness | Quote/abuso, mail, custodia segreti e collaudo indipendente delle condizioni GDPR |

L'archivio candidato degli esercizi personali legge lo snapshot del realm
Kinde. Riusa ricerca, dettaglio ed editor della vista ospite. Creazione e
modifica possono riprendere la bozza cifrata del dispositivo. Duplicazione
ed eliminazione usano lo stesso journal verificato. La conferma di
eliminazione comprende le schede collegate e rifiuta una modifica a tali
riferimenti avvenuta prima del commit.

L'allenamento candidato riusa il check-in, l'editor delle serie, il timer
di durata, il cronometro di recupero, il metronomo e la revisione finale.
Può avviare una seduta libera, da scheda o dalla rotazione del ciclo attivo,
riprendere la bozza cifrata sul dispositivo, sincronizzare lo stato
condiviso e chiudere la seduta nello storico o eliminarla. La bozza conserva
check-in, serie, cronometro e valutazione finale. La riconciliazione del cloud non
sostituisce la copia device. Il commit confronta lo stato condiviso
osservato e i dati rilevanti per la chiusura. In caso di conflitto conserva
la copia device e blocca una nuova scrittura da quella bozza. Il percorso
di rilascio pubblico resta solo identità.

L'editor dello storico Kinde conserva una bozza cifrata separata dalla
seduta in corso e convalida durata e valutazioni prima del salvataggio.
Verifica la copia della seduta originale nel commit IndexedDB. Se la
seduta è stata modificata o eliminata, preserva la bozza e blocca la
scrittura dello storico. Il salvataggio riguarda la sola seduta osservata.

Lo storico candidato delle rilevazioni mostra misure e sonno dallo snapshot
Kinde. Si può eliminare una misurazione dopo conferma. Il journal verifica
che i valori confermati siano ancora correnti e conserva sonno, pasti e
attività dello stesso giorno. L'editor candidato ora prepara inserimento e
modifica in una bozza cifrata owner-scoped, con data originale recuperabile,
un solo writer per volta e verifica dei campi precedenti dentro il commit
IndexedDB. La scelta US Navy viene salvata insieme agli input; un tentativo
già avviato non può essere duplicato dopo una ricevuta incerta. Il flusso
rimane non montato nel pubblico; CI e prove runtime sono gate distinti.

L'editor sonno candidato mantiene durata totale e fasi in una bozza
device AEAD distinta dalla misurazione, datata e recuperabile dopo reload.
Il `nutrition-day.patch` modifica soltanto i campi sonno ed esige che la
baseline della notte sia rimasta invariata nella transazione locale; gli
altri dati del giorno non sono toccati. Un esito offline resta un journal
durevole in attesa di ricevuta D1, non un ACK cloud. Nessun accesso
fitness pubblico è stato autorizzato da questa integrazione.

Il percorso candidato delle attività mostra il riepilogo settimanale e
usa la stessa data per passi e cardio autonomo. Le bozze e le
testimonianze cifrate vengono recuperate dopo il reload. Salvataggio e
rimozione controllano i valori di partenza dentro il commit del journal
e conservano gli altri dati del giorno. Una bozza cardio resta
consultabile dalla data anche se un altro dispositivo elimina la
sessione originale. In quel caso il salvataggio della bozza è bloccato.

Il candidato allenamento mostra i cicli e la sequenza di schede dallo
snapshot dell'account. Il cambio del ciclo attivo usa il journal e
ricontrolla nella transazione la selezione di partenza e l'esistenza
del ciclo. La consultazione non scrive dati. Il candidato può creare e
modificare un ciclo con bozza cifrata e confronto della versione osservata.
La creazione del primo ciclo lo seleziona nello stesso commit se
l'archivio è ancora vuoto. L'avvio dalla rotazione è disponibile nel candidato (#1401), con verifica di ciclo/scheda osservati nel commit e recupero del cronometro nella bozza cifrata.
Duplicazione ed eliminazione verificano il ciclo osservato nel commit.
Se viene eliminato il ciclo attivo, la selezione passa al primo dei
rimanenti o si azzera. Schede e sedute registrate vengono conservate.

## Lettura del provider — 24 novembre 2026 (storico, superato per i ledger)

Cloudflare restituisce quattro Worker TheLogBook: `thelogbook-frontend`, `thelogbook-api-isolated`, `thelogbook-cf03-auth-gate-isolated` e `thelogbook-cf03-kinde-http-isolated`. Tutti hanno zero schedule. Il Custom Domain attivo `thelogbook.me` punta al frontend con soli binding `APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`, **senza D1_API**. L'API privata ha `DB`, `RECOVERY_DB`, `AUTH_GATE` e `CLOUD_ACCOUNT_KEK_V1` secret_text; nessun valore letto. Entrambe le D1 isolate riportano jurisdiction eu e read replication disabled. Ledger SQL: applicativa 0001–0011, recovery 0001–0004. Il codice contiene 13 migrazioni applicative e 5 recovery; quelle mancanti richiedono workflow manuale con preflight e readback, non vengono applicate dal merge. Zona attiva, Always Use HTTPS on, DNSSEC disabled. Nessuna modifica provider da questa ricognizione.

Le prove GitHub attestano distribuzione statica del checkpoint, non account fitness o custodia effettiva dei segreti. Ultima prova manuale Google/logout/rientro: 21/11 in #1057. Nessun GO per fitness, erasure, utenti esterni o dismissione.

La disponibilità del codice candidato non implica accessibilità pubblica. Il provider Kinde conferma l'identità; solo il boundary trusted e un consenso verificato possono autorizzare le operazioni salute. I normali editor ospite continuano a usare il loro writer fino alla sostituzione completa e collaudata.

## Prossimi passaggi, senza sovrapposizioni

1. Completare i percorsi ancora mancanti (catalogo globale, lifecycle account, diritti e UX), senza riscrivere gli editor candidati già integrati, preservando owner/session fence, bozza e journal cifrato durevole; regressioni su `local-pending` e ACK effettivo.
2. Provare su dispositivi e provider isolati Auth, consenso, sessioni, D1/ADK, recovery offline, perdita di ricevuta, più schede e più device; non abilitare anticipatamente il pubblico.
3. Il censimento diagnostico confronta i conteggi di decisioni e blocchi indipendenti con entrambe le letture complete e ricontrolla `mode`/`generation` dopo i digest asincroni degli intenti account: un unseal/reseal durante la verifica viene rifiutato. Su SQLite il censimento accetta 512 proprietari coperti e si blocca al 513º. Restano da dimostrare recupero esterno della KEK indipendente, backup/restore, revoca, cancellazione terminale e anti-resurrection.
4. Lo schema isolato è aggiornato (readback in apertura): attestare ora riautenticazione Kinde, enqueue atomico con marker/generazione correnti, runner e Kinde-last; validare quote, antiabuso, privacy e Safari/iOS. Tracking e cron reali richiedono autorizzazione.
5. Rimuovere i chiamanti Firebase/Vercel solo a parità funzionale verificata. CF-09 e GO del proprietario restano separati dalla CI verde.

## Fonti per agenti e coordinamento

- [AGENTS.md](../../AGENTS.md) e [contratti specialistici](../../.agents/rules/) governano sicurezza, processo e verifica exact-SHA.
- [CF-EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) coordina le fasi; [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) e [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060) registrano prove puntuali e gate.
- [Runbook](cloudflare-workers-migration.md), [setup Kinde](kinde-auth-setup.md) e [registro servizi](external-services-register.md) contengono anche checkpoint storici: non dimostrano il provider live senza rilettura.

**Manutenzione:** aggiornare questa mappa soltanto quando cambia un confine o una prova materiale. Evitare copia di ogni commit, token, dati personali e risultati CI non osservati.
