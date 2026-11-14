# Registro dei servizi esterni — stato operativo TheLogBook

**Ultima revisione:** 14 novembre 2026 (verifica provider: Vercel paused, cutover Cloudflare NO-GO). **Scopo:** inventario sintetico e verificabile dei servizi, dei confini e delle attività residue. GitHub documenta codice, gate e merge; ogni provider certifica il proprio stato runtime. Le verifiche storiche non sono una fotografia live.

**Archivio:** il precedente registro di circa 130 KB aggregava verifiche datate di OAuth, Hosting, IAM, Vercel, App Check, Search Console e vecchi cutover. Queste evidenze restano accessibili nella [versione Git precedente al consolidamento](https://github.com/gernotfound/logbook/blob/8f6625a9100ef96c391a816e5639e8e83ffcc4d5/docs/operations/external-services-register.md), nella cronologia PR/issue e nei contratti di [AGENTS](../../AGENTS.md). Non usarle come istruzioni concorrenti.

## Decisione vigente

Il product owner conferma **database e account applicativi precedenti vuoti**, senza dati da trasferire. **Fresh start:** costruire nuove funzionalità Cloudflare senza import di account/chiavi/consensi/journal da Firebase, senza dual-write, backfill o supporto a versioni pre-lancio inesistenti.

**Priorità:** abbandonare Firebase e Vercel quanto prima, una volta che le funzionalità equivalenti siano realmente collaudate. Questo non autorizza dismissioni, cancellazioni, reset, DNS o credenziali Production senza inventario live e autorizzazioni specifiche. Il codice della PWA attuale richiama ancora Firebase Auth, Firestore/App Check e Vercel: eliminare quei chiamanti prima di completare gli adapter Workers/D1 romperebbe le funzioni, anche senza utenti.

## Inventario corrente

| Sistema | Stato e prova disponibile | Gate / azione residua |
|---|---|---|
| Cloudflare Workers Static Assets | Worker `thelogbook-frontend` su `workers.dev`. [Smoke storico #43223911523](https://github.com/gernotfound/logbook/actions/runs/43223911523) riuscito su asset. Il Worker pubblicato espone un binding `assets`, non D1 | Verifiche aggiornamenti PWA, cache, Safari iOS, login e public origin |
| Cloudflare D1 + Worker API | **Candidato, non pubblicato.** D1 isolata `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu` e read replication OFF, con un UID e documento **sintetici**. Migration SQL `0001` e `0002` applicate; SQL `0003`/`0004` solo nel repository, nessuna API D1 pubblicata; indice `sync_replica_history_identity` e trigger `sync_replica_id_no_reuse` riletti sul provider. [PR #1070](https://github.com/gernotfound/logbook/pull/1070), [#1079](https://github.com/gernotfound/logbook/pull/1079) e [#1081](https://github.com/gernotfound/logbook/pull/1081) integrate; fence SQL sessione/consenso **integrato** nella [PR #1083](https://github.com/gernotfound/logbook/pull/1083), main `2d4c9d5b` v2.394.0; non distribuito su Worker API | Worker API HTTP/AuthGate/ADK, CPU/quote Free, prove reali sync e backup/erasure. Non utilizzare la D1 sintetica come DB utente |
| Cloudflare DNS `thelogbook.me` | Zona **active** letta sul provider il 14/11; A/AAAA apex ancora IONOS (217.160.0.9 / 2001:8d8:100f:f000::200, proxy Cloudflare), nessuna Workers Route o Custom Domain, DNS invariato. Sono presenti i TXT `mailjet._b360c0fc.notify.thelogbook.me` e `mailjet._domainkey.notify.thelogbook.me` (TTL 3600); la presenza del DNS **non** certifica validazione Mailjet, MIME, SPF/DKIM/DMARC né autorizza cutover | GO CF-09 separato, DNS/TLS/OAuth/mail, certificati e anti-bypass del Workers.dev |
| Firebase Hosting `thelogbook` | Disabilitato secondo output CLI del proprietario 12/11; workflow Hosting GitHub dichiarato disabilitato. Stato `disabled_manually` non verificato indipendentemente | **Non riattivare**; rollback del futuro stack solo verso release Cloudflare valida |
| Firebase Authentication / Firestore / App Check | **Dipendenze ancora presenti nel runtime attuale**, non una necessità di conservazione di utenti pre-lancio. Controlli Auth/Rules/consenso preesistenti non provano equivalenza Workers | Rimuovere dopo test Auth, consenso, replica, logout, cancellazione ed offline sul nuovo stack; non abbassare enforcement intanto |
| Vercel Functions/Cron + Firebase Admin | **Vercel `logbook` PAUSED il 14/11/2026** su richiesta specifica del proprietario, evento provider `project-paused` confermato. Traffico Production bloccato, operazione reversibile; nessun progetto, segreto o dato eliminato e nessun altro progetto toccato. Ultimo backend legacy READY `4e25427f`; tentativo su main `2d4c9d5b` CANCELED (ignored build). Functions e cron sono ancora nel repository, non migrati. GitHub main `bc4a6296` aveva status esterno `Vercel` = `failure` da deployment bloccato; la configurazione candidato imposta `vercel.json.git.deploymentEnabled=false` per tutti i branch. Il ruleset main richiede invece soltanto `Canonical Verification`; i vecchi status non sono cancellabili dal repository. Non è stato ispezionato lo stato live di eventuali job di cancellazione o dati residui | Convertire API/cron, rights, erasure e inattività nel nuovo backend prima del GO; non dismettere definitivamente risorse/credenziali prima di inventario e permessi |
| Email transazionale | **Mailjet Free selezionato; la PR parallela #1077 riporta con screenshot del 14/11 il dominio `notify.thelogbook.me` Active e SPF/DKIM OK nel pannello Mailjet, ma non prova ancora invio/MIME reali, header ricevuti, tracking persistente né integrazione Auth Workers.** Brevo Free ha inviato e consegnato a Gmail/Proton con API, ma il MIME Gmail contiene pixel e il log Brevo registra `Prima apertura` 16:08 e `Aperta` 16:08/16:09, tutte `Anonimizzato`. **Non soddisfa privacy zero tracking**; provider da ritirare solo dopo collaudo del sostituto. [Guida Mailjet e ritiro Brevo](transactional-email-provider-evaluation.md), [PR #1077](https://github.com/gernotfound/logbook/pull/1077) draft parallela con prove dell'intervento DNS, CF-00 #1054/CF-03 #1057 | Configurare Mailjet senza pixel/click, verificare MIME e headers reali, quota 200/giorno, privacy/DPA e flussi Auth; Non rimuovere DNS né account Brevo prima dell'inventario e del GO pertinente |
| OAuth Google, link di verifica/reset email | Le precedenti allowlist e i callback Firebase sono checkpoint del vecchio sistema, **non configurazione valida per il nuovo Auth Workers** | Test cookie HttpOnly/Secure/SameSite, CSRF, callback, code-verifier/replay, origine, rate limit e browser senza toccare Production prima del GO |
| GitHub Actions / CodeQL | PR #1083 [CI exact SHA](https://github.com/gernotfound/logbook/actions/runs/43538181345) SUCCESS; [main #43538480775](https://github.com/gernotfound/logbook/actions/runs/43538480775) SUCCESS su `2d4c9d5b` (Main Release Gate + CodeQL); [Firestore reconcile #43538760086](https://github.com/gernotfound/logbook/actions/runs/43538760086) SUCCESS. Nessuno di questi check prova Worker runtime Cloudflare | CI exact-SHA, CodeQL e gate post-merge rimangono obbligatori |
| Snyk / Dependabot | Supplementari; CodeQL resta il SAST bloccante | Non aggirare i controlli per quota Snyk |
| Google Search Console / SEO | Canonical, sitemap e proprietà storiche riferite al vecchio frontend Firebase; niente passaggio di dominio completato | Adeguare canonical, sitemap, robots e proprietà GSC al cutover Cloudflare con esito verificato |
| Analytics e monitoraggio esterno | GA4, Vercel Analytics/Speed Insights e SDK di segnalazione automatica ritirati dal frontend, secondo decisione di prodotto e codice | Non reintrodurre tracking senza una decisione esplicita |
| Test cloud Firebase/Vercel separati | Dismessi nell'ottobre 2026; non sono infrastruttura da recuperare | Test locali/CI, emulatori e sandbox Cloudflare isolata con dati sintetici |

## Evidenze dopo merge #1083 e stop Vercel (14/11/2026)

La [PR #1083](https://github.com/gernotfound/logbook/pull/1083) è
**MERGED** su main `2d4c9d5b` (v2.394.0). Il fence SQL ripete la
verifica di sessione e consenso sanitario dentro D1 per letture, commit
e ricevute. Le verifiche CI PR e main sono riuscite; **nessuna API Cloudflare
è stata pubblicata e nessun frontend reale è collegato a D1**.

Il solo progetto Vercel `logbook` è stato **messo in pausa** in modo
reversibile su richiesta del proprietario; l'evento `project-paused`
è presente sul provider. Cloudflare conferma zona `thelogbook.me` attiva,
A/AAAA web ancora IONOS, nessuna route/custom-domain Workers, unico Worker
`thelogbook-frontend` e sandbox D1 `eu`.
Nessun DNS, SSL, OAuth, dati, credenziali o risorsa reale è stato cancellato.
La PWA non è pronta al GO. La PR Mailjet #1077 resta parallela e non va
sovrascritta.

## Protezioni non rinunciabili nel fresh start

Le nuove chiavi device/cloud sono casuali e indipendenti; salute cifrata sul client, niente dati sanitari in chiaro in D1. Owner/consenso/fence e sessione trusted autorizzano la rete; journal locale durevole prima della richiesta, commit cloud e ACK IndexedDB distinti; multi-tab, multi-device, iOS Safari, offline, lost-ACK, restore, revoca, esportazione e cancellazione sono requisiti correnti. Nessun PIN/codice di recupero ordinario e nessuna promessa E2EE o recovery non dimostrata. Password minima 15 caratteri, Google, email verifica/reset, maggiore età, policy di inattività e diritti utenti.

La giurisdizione `eu` di D1 **non garantisce** localizzazione di Workers, log, OAuth, email o conformità GDPR. Quota Free, CPU, limite giornaliero, abuso, rate limiting, privacy del provider email, backup e restore sono prove distinte. Niente billing, upgrade o fallback insicuri.

## Conclusioni operative

**Prodotto nuovo:** una vertical slice completa alla volta, senza aspettare che tutti i componenti indipendenti siano già validati. Priorità: Auth + email + consenso/chiavi, poi adapter D1 e journal, quindi deletion/rights/cron e rilascio PWA. Collegare realmente i percorsi prima di rimuovere Firebase/Vercel; **non mantenere i vecchi provider per ipotetiche migrazioni**. La dismissione fisica è un atto separato e necessita controllo di risorse/credenziali/routing e autorizzazione specifica.

**Fonti:** [runbook Cloudflare](cloudflare-workers-migration.md), [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053), [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054), [CF-02 #1056](https://github.com/gernotfound/logbook/issues/1056), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058), [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059), [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060), [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063), [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041), [servizi esterni](../../.agents/rules/external-services.md), [CI](../../.agents/rules/ci-verification.md).

Non committare segreti, token, credenziali, email personali, valori env Production, dati salute o URL con parametri sensibili. Il contratto pubblico delle variabili è `.env.example`; il loro valore e scope sono nel provider.
