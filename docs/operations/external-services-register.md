# Registro dei servizi esterni — stato operativo TheLogBook

**Ultima revisione:** 13 novembre 2026. **Scopo:** inventario sintetico e verificabile dei servizi, dei confini e delle attività residue. GitHub documenta codice, gate e merge; ogni provider certifica il proprio stato runtime. Le verifiche storiche non sono una fotografia live.

**Archivio:** il precedente registro di circa 130 KB aggregava verifiche datate di OAuth, Hosting, IAM, Vercel, App Check, Search Console e vecchi cutover. Queste evidenze restano accessibili nella [versione Git precedente al consolidamento](https://github.com/gernotfound/logbook/blob/8f6625a9100ef96c391a816e5639e8e83ffcc4d5/docs/operations/external-services-register.md), nella cronologia PR/issue e nei contratti di [AGENTS](../../AGENTS.md). Non usarle come istruzioni concorrenti.

## Decisione vigente

Il product owner conferma **database e account applicativi precedenti vuoti**, senza dati da trasferire. **Fresh start:** costruire nuove funzionalità Cloudflare senza import di account/chiavi/consensi/journal da Firebase, senza dual-write, backfill o supporto a versioni pre-lancio inesistenti.

**Priorità:** abbandonare Firebase e Vercel quanto prima, una volta che le funzionalità equivalenti siano realmente collaudate. Questo non autorizza dismissioni, cancellazioni, reset, DNS o credenziali Production senza inventario live e autorizzazioni specifiche. Il codice della PWA attuale richiama ancora Firebase Auth, Firestore/App Check e Vercel: eliminare quei chiamanti prima di completare gli adapter Workers/D1 romperebbe le funzioni, anche senza utenti.

## Inventario corrente

| Sistema | Stato e prova disponibile | Gate / azione residua |
|---|---|---|
| Cloudflare Workers Static Assets | Worker `thelogbook-frontend` su `workers.dev`. [Smoke storico #43223911523](https://github.com/gernotfound/logbook/actions/runs/43223911523) riuscito su asset. Il Worker pubblicato espone un binding `assets`, non D1 | Verifiche aggiornamenti PWA, cache, Safari iOS, login e public origin |
| Cloudflare D1 + Worker API | **Candidato, non pubblicato.** D1 isolata `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu` e read replication OFF, con un UID e documento **sintetici**. Migration SQL `0001` e `0002` applicate; indice `sync_replica_history_identity` e trigger `sync_replica_id_no_reuse` riletti sul provider. [PR #1070](https://github.com/gernotfound/logbook/pull/1070) mergiata su `main 8f6625a` | Worker API HTTP/AuthGate/ADK, CPU/quote Free, prove reali sync e backup/erasure. Non utilizzare la D1 sintetica come DB utente |
| Cloudflare DNS `thelogbook.me` | Zona Free e SSL osservati in schermate storiche; **nessun cutover del dominio** autorizzato. Certificato, routing effettivo, NS/DS e posta richiedono verifica live | GO CF-09 separato, DNS/TLS/OAuth/mail e anti-bypass del Workers.dev |
| Firebase Hosting `thelogbook` | Disabilitato secondo output CLI del proprietario 12/11; workflow Hosting GitHub dichiarato disabilitato. Stato `disabled_manually` non verificato indipendentemente | **Non riattivare**; rollback del futuro stack solo verso release Cloudflare valida |
| Firebase Authentication / Firestore / App Check | **Dipendenze ancora presenti nel runtime attuale**, non una necessità di conservazione di utenti pre-lancio. Controlli Auth/Rules/consenso preesistenti non provano equivalenza Workers | Rimuovere dopo test Auth, consenso, replica, logout, cancellazione ed offline sul nuovo stack; non abbassare enforcement intanto |
| Vercel Functions/Cron + Firebase Admin | Backend trusted legacy ancora attivo nel codice. Vercel ha creato automaticamente il deployment Production `READY` sul commit merge [#1070](https://github.com/gernotfound/logbook/commit/8f6625a9100ef96c391a816e5639e8e83ffcc4d5); **non** è un deployment Cloudflare | Porting API/cron in Workers + revoca diritti, erasure, inattività; ritiro tempestivo dopo prove e permesso specifico |
| Email transazionale | **Mailjet Free SELEZIONATO come candidato, non ancora attivato/testato.** Brevo Free ha inviato e consegnato a Gmail/Proton con API, ma il MIME Gmail contiene pixel e il log Brevo registra `Prima apertura` 16:08 e `Aperta` 16:08/16:09, tutte `Anonimizzato`. **Non soddisfa privacy zero tracking**; provider da ritirare solo dopo collaudo del sostituto. [Guida Mailjet e ritiro Brevo](transactional-email-provider-evaluation.md), CF-00 #1054/CF-03 #1057 | Configurare Mailjet senza pixel/click, verificare MIME e headers reali, quota 200/giorno, privacy/DPA e flussi Auth; DNS e account Brevo invariati per ora |
| OAuth Google, link di verifica/reset email | Le precedenti allowlist e i callback Firebase sono checkpoint del vecchio sistema, **non configurazione valida per il nuovo Auth Workers** | Test cookie HttpOnly/Secure/SameSite, CSRF, callback, code-verifier/replay, origine, rate limit e browser senza toccare Production prima del GO |
| GitHub Actions / CodeQL | Ruleset `protect main branch` attivo, `Canonical Verification` richiesto, squash/linear history, review threads risolti. [CI main #43424078257](https://github.com/gernotfound/logbook/actions/runs/43424078257) e [Firestore reconcile #43424472309](https://github.com/gernotfound/logbook/actions/runs/43424472309) riuscite | Ogni PR necessita CI exact-SHA, CodeQL, gate main post-merge distinti dal runtime |
| Snyk / Dependabot | Supplementari; CodeQL resta il SAST bloccante | Non aggirare i controlli per quota Snyk |
| Google Search Console / SEO | Canonical, sitemap e proprietà storiche riferite al vecchio frontend Firebase; niente passaggio di dominio completato | Adeguare canonical, sitemap, robots e proprietà GSC al cutover Cloudflare con esito verificato |
| Analytics e monitoraggio esterno | GA4, Vercel Analytics/Speed Insights e SDK di segnalazione automatica ritirati dal frontend, secondo decisione di prodotto e codice | Non reintrodurre tracking senza una decisione esplicita |
| Test cloud Firebase/Vercel separati | Dismessi nell'ottobre 2026; non sono infrastruttura da recuperare | Test locali/CI, emulatori e sandbox Cloudflare isolata con dati sintetici |

## Protezioni non rinunciabili nel fresh start

Le nuove chiavi device/cloud sono casuali e indipendenti; salute cifrata sul client, niente dati sanitari in chiaro in D1. Owner/consenso/fence e sessione trusted autorizzano la rete; journal locale durevole prima della richiesta, commit cloud e ACK IndexedDB distinti; multi-tab, multi-device, iOS Safari, offline, lost-ACK, restore, revoca, esportazione e cancellazione sono requisiti correnti. Nessun PIN/codice di recupero ordinario e nessuna promessa E2EE o recovery non dimostrata. Password minima 15 caratteri, Google, email verifica/reset, maggiore età, policy di inattività e diritti utenti.

La giurisdizione `eu` di D1 **non garantisce** localizzazione di Workers, log, OAuth, email o conformità GDPR. Quota Free, CPU, limite giornaliero, abuso, rate limiting, privacy del provider email, backup e restore sono prove distinte. Niente billing, upgrade o fallback insicuri.

## Conclusioni operative

**Prodotto nuovo:** una vertical slice completa alla volta, senza aspettare che tutti i componenti indipendenti siano già validati. Priorità: Auth + email + consenso/chiavi, poi adapter D1 e journal, quindi deletion/rights/cron e rilascio PWA. Collegare realmente i percorsi prima di rimuovere Firebase/Vercel; **non mantenere i vecchi provider per ipotetiche migrazioni**. La dismissione fisica è un atto separato e necessita controllo di risorse/credenziali/routing e autorizzazione specifica.

**Fonti:** [runbook Cloudflare](cloudflare-workers-migration.md), [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053), [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054), [CF-02 #1056](https://github.com/gernotfound/logbook/issues/1056), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059), [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060), [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063), [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041), [servizi esterni](../../.agents/rules/external-services.md), [CI](../../.agents/rules/ci-verification.md).

Non committare segreti, token, credenziali, email personali, valori env Production, dati salute o URL con parametri sensibili. Il contratto pubblico delle variabili è `.env.example`; il loro valore e scope sono nel provider.
