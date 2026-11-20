# Cloudflare — quadro operativo per lo sviluppo

**Stato:** ricognizione del 20 novembre 2026; non è una certificazione Production. Per il codice e la CI leggere il vero HEAD di [main](https://github.com/gernotfound/logbook/tree/main); per risorse e segreti leggere il provider; per gli esiti funzionali consultare le [issue CF](https://github.com/gernotfound/logbook/issues/1053). Questo documento non autorizza GO, billing, cancellazioni o modifiche a risorse reali.

## Implementato, montato e verificato sono cose differenti

| Percorso | Codice disponibile | Runtime pubblico | Prova mancante |
| --- | --- | --- | --- |
| PWA React e Static Assets | UI, guest, vault locale | Frontend sul dominio thelogbook.me; guest locale | Install/update su browser reali Chrome e Safari/iOS |
| OAuth Kinde | Callback, sessione, Worker e componenti React | Quattro route Auth; GuestOnlyAuthProvider, ingresso Kinde identity-only | Google, verifica/reset email, cookie, logout, sessioni e ownership |
| Replica Workers/D1 | Worker API/Auth Gate, schema SQL, checkpoint, claim e journal cifrato | Worker privati; frontend senza binding D1_API | Write→ricevuta/ACK→read su secondo device, lost ACK e quota |
| Consenso e chiavi | DEK device e ADK per owner, binding KEK e rights/withdrawal candidati | Nessun grant fitness per account | Recovery indipendente della stessa KEK, consenso e revoca reali |
| Erasure/inattività | Registro D1 indipendente, runner candidato | Nessun Cron Trigger nei quattro Worker verificati | Erasure terminale, delete Kinde per ultima, inattività e anti-resurrection |
| Free/abuso/privacy | Test sintetici, controlli CI, rate-limit binding | NO-GO account fitness e utenti esterni | Quote, email, protezioni antiabuso, dati sintetici e revisione legale |

**Readback Cloudflare 20 novembre 2026:** quattro Worker TheLogBook (frontend, API, Auth Gate, Kinde HTTP) con workers.dev e preview URL disabilitati; API privata con DB, RECOVERY_DB, AUTH_GATE e CLOUD_ACCOUNT_KEK_V1 di tipo secret_text, senza leggere il valore. Due D1 isolate con jurisdiction=eu. Questo prova solo attributi di configurazione, non recuperabilità KEK, API sanitarie funzionanti, residenza di tutti i trattamenti o GDPR.

**Rilascio Static Assets:** il workflow segue il Main Release Gate e CodeQL dello SHA di main; la riconciliazione Firestore è indipendente. Un deploy verde non attesta fitness, consenso o sync.

## Ordine consigliato

1. Chiudere identità Kinde → owner → consenso → vault in fixture isolate, senza abilitare account fitness pubblico.
2. Dimostrare write D1/AEAD → receipt/ACK → secondo device; coprire crash, concorrenza, offline, quote e recovery.
3. Provare custodia e recupero KEK indipendenti, restore selettivo e fence contro reintroduzione di dati cancellati.
4. Completare cron, account deletion e inattività in sandbox, prima di qualunque attivazione reale.
5. Dopo parità verificata, eliminare chiamanti e dipendenze Firebase/Vercel; nessuna migrazione di account pre-lancio.
6. Completare CF-00…09, privacy e prove Safari/iOS prima di un GO esplicito.

## Fonti per gli agenti

- [AGENTS.md](../../AGENTS.md) e [regole specialistiche](../../.agents/rules/) disciplinano i contratti.
- [CF-EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) organizza i blocchi.
- [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059), [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060), [CF-08 #1062](https://github.com/gernotfound/logbook/issues/1062) contengono gate e prove.
- [Runbook Cloudflare](cloudflare-workers-migration.md), [setup Kinde](kinde-auth-setup.md) e [registro servizi](external-services-register.md) contengono **checkpoint storici**; i loro paragrafi datati non provano il main o il provider correnti.

**Manutenzione:** aggiornare questa mappa quando cambia un confine montato o un gate; non replicare ogni commit qui. Conservare SHA, CI, date e readback puntuali in issue e PR.
