# Cloudflare — quadro operativo per lo sviluppo

**Stato:** inventario provider del 22 novembre 2026; aggiornamento del solo codice candidato al 23 novembre. Questa mappa distingue codice su [`main`](https://github.com/gernotfound/logbook/tree/main), runtime pubblico, letture Cloudflare e prove funzionali. Non è una certificazione Production e non autorizza GO, billing, cancellazioni, DNS, OAuth Production o modifiche irreversibili. Le versioni e i commit dei singoli interventi sono nelle [issue CF](https://github.com/gernotfound/logbook/issues/1053); rileggere sempre l'HEAD reale.

## Implementato, montato e verificato sono cose differenti

| Percorso | Codice presente | Montaggio e prove osservati | Gate ancora aperto |
| --- | --- | --- | --- |
| PWA React e Static Assets | Guest locale, storage cifrato, app fitness legacy | Frontend Worker su `thelogbook.me`; `GuestOnlyAuthProvider` ancora montato | Installazione, aggiornamento, recovery e Safari/iOS su dispositivi reali |
| Identità Kinde | Gateway OAuth/sessione, observer React condiviso, login/logout | Il pubblico usa `KindeAccountSessionProvider` e `KindeAccountEntry identityOnly`. Il proprietario ha osservato accesso Google, logout applicativo e rientro esplicito il 21/11 ([CF-03](https://github.com/gernotfound/logbook/issues/1057)) | Verifica/reset email, policy provider, account linking, sessioni, browser e UX complete |
| Fitness account Kinde **isolato** | `KindeCandidateFitnessPanel`, realm con owner/fence, profilo biometrico, pianificazione macro, diario/storico pasti, integratori, storico allenamenti consultabile ed eliminabile, schede ed esercizi personali con recupero della bozza cifrata ([CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057)) | Disponibile come percorso candidato `candidateMode='fitness'`, non montato nel pubblico `identityOnly`; editor separati dal writer Firebase | Sessione attiva, editing storico, cicli, catalogo globale, lifecycle account completo e prove su account/dispositivi reali |
| Replica Workers/D1 | Worker API/Auth Gate, schema SQL, journal cifrato e ricevute D1; percorso candidato con commit prima della rete | Worker API privato e frontend **senza** binding `D1_API`; prove isolate sintetiche del realm | Roundtrip reale multi-device, lost ACK, concorrenza, offline, quote e fail-safe |
| Consenso, cifratura e diritti | Consenso iniziale, ADK/vault, export/restore, revoca e rights-only candidati | `CLOUD_ACCOUNT_KEK_V1` presente come `secret_text` nel Worker API privato; nessun grant fitness nel provider pubblico | Recuperabilità indipendente della KEK, consenso/revoca/restore/erasure reali, privacy e protezione anti-resurrection |
| Erasure e inattività | Registro D1, finalizzatore, runner e [manifest CF-06 candidato](../../cloudflare/jobs/README.md) | GET Cloudflare del 22/11: elenco Cron Trigger vuoto per tutti e quattro i Worker TheLogBook; runner non schedulato | Esecuzione isolata, terminazione atomica, eliminazione Kinde per ultima, inattività 12 mesi |
| Free, abuso e privacy | Rate-limit binding, verifiche statiche, smoke e test con dati sintetici | Nessun GO utenti esterni o account fitness | Quote/abuso, mail, custodia segreti e collaudo indipendente delle condizioni GDPR |

L'archivio candidato degli esercizi personali legge lo snapshot del realm
Kinde. Riusa ricerca, dettaglio ed editor della vista ospite. Creazione e
modifica possono riprendere la bozza cifrata del dispositivo. Duplicazione
ed eliminazione usano lo stesso journal verificato. La conferma di
eliminazione comprende le schede collegate e rifiuta una modifica a tali
riferimenti avvenuta prima del commit.

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
del ciclo. La consultazione non scrive dati. L'editor dei cicli e
l'avvio di una seduta dal ciclo restano da portare nel realm.
Duplicazione ed eliminazione verificano il ciclo osservato nel commit.
Se viene eliminato il ciclo attivo, la selezione passa al primo dei
rimanenti o si azzera. Schede e sedute registrate vengono conservate.

## Lettura del provider — 22 novembre 2026

Il connettore Cloudflare ha restituito quattro Worker TheLogBook: `thelogbook-frontend`, `thelogbook-api-isolated`, `thelogbook-cf03-auth-gate-isolated` e `thelogbook-cf03-kinde-http-isolated`. Il frontend ha `APP_ORIGIN`, `ASSETS`, `KINDE_HTTP` e **non** `D1_API`; l'API privata ha `DB`, `RECOVERY_DB`, `AUTH_GATE` e `CLOUD_ACCOUNT_KEK_V1` come `secret_text`. Entrambi i database D1 isolati riportano `jurisdiction=eu`. Il Worker frontend riporta modifica del 22/11; gli altri tre del 21/11. Lettura GET dei Cron Trigger con risposta `success:true`: nessuno schedulato su tutti e quattro i Worker. Questa lettura **non** certifica commit distribuito, valori di segreti, restore, rotte, Cron Trigger, sicurezza effettiva delle API, collocazione di ogni trattamento o GDPR.

La disponibilità del codice candidato non implica accessibilità pubblica. Il provider Kinde conferma l'identità; solo il boundary trusted e un consenso verificato possono autorizzare le operazioni salute. I normali editor ospite continuano a usare il loro writer fino alla sostituzione completa e collaudata.

## Prossimi passaggi, senza sovrapposizioni

1. Completare progressivamente gli editor e il lifecycle fitness nel realm Kinde isolato, preservando owner/session fence, bozza e journal cifrato durevole; regressioni su `local-pending` e ACK effettivo.
2. Provare su dispositivi e provider isolati Auth, consenso, sessioni, D1/ADK, recovery offline, perdita di ricevuta, più schede e più device; non abilitare anticipatamente il pubblico.
3. Dimostrare recupero esterno della KEK indipendente, backup/restore, revoca, cancellazione terminale e anti-resurrection.
4. Validare trigger erasure/inattività, quote Free, antiabuso, protezioni legali e browser Safari/iOS.
5. Rimuovere i chiamanti Firebase/Vercel solo a parità funzionale verificata. CF-09 e GO del proprietario restano separati dalla CI verde.

## Fonti per agenti e coordinamento

- [AGENTS.md](../../AGENTS.md) e [contratti specialistici](../../.agents/rules/) governano sicurezza, processo e verifica exact-SHA.
- [CF-EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) coordina le fasi; [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) e [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060) registrano prove puntuali e gate.
- [Runbook](cloudflare-workers-migration.md), [setup Kinde](kinde-auth-setup.md) e [registro servizi](external-services-register.md) contengono anche checkpoint storici: non dimostrano il provider live senza rilettura.

**Manutenzione:** aggiornare questa mappa soltanto quando cambia un confine o una prova materiale. Evitare copia di ogni commit, token, dati personali e risultati CI non osservati.
