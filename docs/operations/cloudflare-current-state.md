# Cloudflare — quadro operativo per lo sviluppo

**Checkpoint 24 novembre 2026:** codice e provider riletti su `main` v2.669.0, SHA `f121548d43e80d00d7bb96f33e3e639dddc17c85` (PR #1405). Rileggere HEAD e provider prima di ogni nuovo task. Questa mappa distingue codice su [`main`](https://github.com/gernotfound/logbook/tree/main), runtime pubblico, letture Cloudflare e prove funzionali. Non è una certificazione Production e non autorizza GO, billing, cancellazioni, DNS, OAuth Production o modifiche irreversibili. Le versioni e i commit dei singoli interventi sono nelle [issue CF](https://github.com/gernotfound/logbook/issues/1053); rileggere sempre l'HEAD reale.

## Ultima integrazione verificata

- #1407 ha integrato su `main` v2.670.0 (`46725d7d8b3bb4bf3b640052ced6eb05821558ab`) l'orchestrazione post-verifica dei Worker privati e il checkout CodeQL main a profondità 1. [CI candidata](https://github.com/gernotfound/logbook/actions/runs/45447265920) riuscita; attestazioni post-merge e prestazioni effettive da rileggere separatamente. Nessuna migrazione SQL o nuova route autorizzata da questo incremento.

- [CI PR #1405](https://github.com/gernotfound/logbook/actions/runs/45440872427), [gate main e CodeQL](https://github.com/gernotfound/logbook/actions/runs/45441648072), [Static Assets e smoke byte-esatto](https://github.com/gernotfound/logbook/actions/runs/45443109699), [API D1 privata](https://github.com/gernotfound/logbook/actions/runs/45441648108), [Kinde privato](https://github.com/gernotfound/logbook/actions/runs/45441648166) e [riconciliazione Firestore legacy](https://github.com/gernotfound/logbook/actions/runs/45443109842): tutti success sullo SHA pertinente. Un workflow privato/Firestore verde non prova una scrittura provider se i passi di deploy erano skipped.
- #1386 ha integrato i diff audit FIX/TST; le checklist #1322/#1327 non certificano per questo tutti i file. Gli incrementi CF successivi #1387–#1405 sono antenati del checkpoint.
- #1391/#1393/#1397/#1399: clock primario D1, prova temporale consenso/sessione e scadenza locale conservativa. #1403: finalizzazione sanitaria vincolata al lease esatto.
- #1404: candidato cancellazione account Kinde con riferimento cifrato, riautenticazione, intento durevole, deny indipendente, pulizia owner-scoped e prova Kinde-last. #1405: marker foreground con clock D1, inattività 12 mesi calendari UTC, margine conservativo di aggregazione, selezione dry-run max 16, controllo inizialmente paused e pulizia del marker dell'owner. Nessuna nuova rotta o cron attivato.
- #1409–#1411: recupero floor consenso pending, dispatcher account e checkpoint persistente con lease SQL; su main v2.675.0 `b9ff4ba8a1c29597d86d7903ac506cf8d07e4920`, [CI candidata #1411](https://github.com/gernotfound/logbook/actions/runs/45524834759) riuscita. Migrazione candidata 0014, nessuna nuova prova di applicazione remota o schedule. L'[inventario D1](cloudflare-d1-data-inventory.json) separa cleanup e prove mantenute, con guard sullo schema in CI; non certifica retention legale.
- **Prossimo lavoro indipendente:** scanner di enqueue distinto dal dry-run, backoff per owner/quote e collegamenti mancanti del lifecycle; non ripetere le funzioni candidate già integrate. Separare i blocchi esterni (Kinde auth_time, Management, custodia KEK, test live e privacy).

## Implementato, montato e verificato sono cose differenti

| Percorso | Codice presente | Montaggio e prove osservati | Gate ancora aperto |
| --- | --- | --- | --- |
| PWA React e Static Assets | Guest locale, storage cifrato, app fitness legacy | Frontend Worker su `thelogbook.me`; `GuestOnlyAuthProvider` ancora montato | Installazione, aggiornamento, recovery e Safari/iOS su dispositivi reali |
| Identità Kinde | Gateway OAuth/sessione, observer React condiviso, login/logout | Il pubblico usa `KindeAccountSessionProvider` e `KindeAccountEntry identityOnly`. Il proprietario ha osservato accesso Google, logout applicativo e rientro esplicito il 21/11 ([CF-03](https://github.com/gernotfound/logbook/issues/1057)) | Verifica/reset email, policy provider, account linking, sessioni, browser e UX complete |
| Fitness account Kinde **isolato** | `KindeCandidateFitnessPanel`, realm con owner/fence, profilo biometrico, pianificazione macro, diario/storico pasti, integratori, misure/sonno, passi/cardio, seduta attiva, editor dei cicli, storico allenamenti consultabile, modificabile ed eliminabile, schede ed esercizi personali con recupero della bozza cifrata ([CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057)) | Disponibile come percorso candidato `candidateMode='fitness'`, non montato nel pubblico `identityOnly`; editor separati dal writer Firebase | Catalogo globale, lifecycle account completo e prove su account/dispositivi reali |
| Replica Workers/D1 | Worker API/Auth Gate, schema SQL, journal cifrato e ricevute D1; percorso candidato con commit prima della rete | Worker API privato e frontend **senza** binding `D1_API`; prove isolate sintetiche del realm | Roundtrip reale multi-device, lost ACK, concorrenza, offline, quote e fail-safe |
| Consenso, cifratura e diritti | Consenso iniziale, ADK/vault, export/restore, revoca e rights-only candidati | `CLOUD_ACCOUNT_KEK_V1` presente come `secret_text` nel Worker API privato; nessun grant fitness nel provider pubblico | Recuperabilità indipendente della KEK, consenso/revoca/restore/erasure reali, privacy e protezione anti-resurrection |
| Erasure e inattività | Finalizzatore lease-fenced, pipeline account Kinde, dispatcher e checkpoint persistente, ingresso account e alternanza candidata, marker foreground e scanner dry-run con checkpoint candidato 0016 e ingresso diagnostico opt-in con pin recovery esterno; [manifest CF-06 candidato](../../cloudflare/jobs/README.md) | GET 24/11: zero schedule sui quattro Worker; D1 applicativa 0011 e recovery 0004, migrazioni candidate 0012–0016 e 0005 non applicate alla rilettura precedente | Riautenticazione reale, route/ricevute device, enqueue atomico, montaggio runner, backoff e permessi Management, recovery, quote, privacy e prova Kinde-last |
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

## Lettura del provider — 24 novembre 2026

Cloudflare restituisce quattro Worker TheLogBook: `thelogbook-frontend`, `thelogbook-api-isolated`, `thelogbook-cf03-auth-gate-isolated` e `thelogbook-cf03-kinde-http-isolated`. Tutti hanno zero schedule. Il Custom Domain attivo `thelogbook.me` punta al frontend con soli binding `APP_ORIGIN`, `ASSETS`, `KINDE_HTTP`, **senza D1_API**. L'API privata ha `DB`, `RECOVERY_DB`, `AUTH_GATE` e `CLOUD_ACCOUNT_KEK_V1` secret_text; nessun valore letto. Entrambe le D1 isolate riportano jurisdiction eu e read replication disabled. Ledger SQL: applicativa 0001–0011, recovery 0001–0004. Il codice contiene 13 migrazioni applicative e 5 recovery; quelle mancanti richiedono workflow manuale con preflight e readback, non vengono applicate dal merge. Zona attiva, Always Use HTTPS on, DNSSEC disabled. Nessuna modifica provider da questa ricognizione.

Le prove GitHub attestano distribuzione statica del checkpoint, non account fitness o custodia effettiva dei segreti. Ultima prova manuale Google/logout/rientro: 21/11 in #1057. Nessun GO per fitness, erasure, utenti esterni o dismissione.

La disponibilità del codice candidato non implica accessibilità pubblica. Il provider Kinde conferma l'identità; solo il boundary trusted e un consenso verificato possono autorizzare le operazioni salute. I normali editor ospite continuano a usare il loro writer fino alla sostituzione completa e collaudata.

## Prossimi passaggi, senza sovrapposizioni

1. Completare i percorsi ancora mancanti (catalogo globale, lifecycle account, diritti e UX), senza riscrivere gli editor candidati già integrati, preservando owner/session fence, bozza e journal cifrato durevole; regressioni su `local-pending` e ACK effettivo.
2. Provare su dispositivi e provider isolati Auth, consenso, sessioni, D1/ADK, recovery offline, perdita di ricevuta, più schede e più device; non abilitare anticipatamente il pubblico.
3. Dimostrare recupero esterno della KEK indipendente, backup/restore, revoca, cancellazione terminale e anti-resurrection.
4. Aggiornare lo schema isolato con prove, attestare riautenticazione Kinde, enqueue atomico con marker/generazione correnti, runner e Kinde-last; validare quote, antiabuso, privacy e Safari/iOS. Tracking e cron reali richiedono autorizzazione.
5. Rimuovere i chiamanti Firebase/Vercel solo a parità funzionale verificata. CF-09 e GO del proprietario restano separati dalla CI verde.

## Fonti per agenti e coordinamento

- [AGENTS.md](../../AGENTS.md) e [contratti specialistici](../../.agents/rules/) governano sicurezza, processo e verifica exact-SHA.
- [CF-EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) coordina le fasi; [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) e [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060) registrano prove puntuali e gate.
- [Runbook](cloudflare-workers-migration.md), [setup Kinde](kinde-auth-setup.md) e [registro servizi](external-services-register.md) contengono anche checkpoint storici: non dimostrano il provider live senza rilettura.

**Manutenzione:** aggiornare questa mappa soltanto quando cambia un confine o una prova materiale. Evitare copia di ogni commit, token, dati personali e risultati CI non osservati.
