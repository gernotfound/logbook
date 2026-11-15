# TheLogBook — migrazione Cloudflare: runbook corrente

**Classificazione: CRITICAL · stato PARZIALE / NO-GO funzionale (dominio pubblico di sviluppo autorizzato).** La fonte di verità per il codice e i test è `main` GitHub; per risorse e runtime sono i rispettivi provider. Questo documento descrive **contratti correnti e blocchi**, non lo storico di commit. [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) · [registro servizi](external-services-register.md) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063).


## Coordinamento e prove correnti — 15/11/2026 (dopo v2.462.0)

**Main verificata:** `c2ebcbc670c2807f5927f632089dcdc86fa397f6`, **v2.462.0**. I sei incrementi CRITICAL dell'handoff sono **integrati**, non più draft: [#1153](https://github.com/gernotfound/logbook/pull/1153) sicurezza `minimatch`, [#1154](https://github.com/gernotfound/logbook/pull/1154) fixture D1 0001–0010, [#1152](https://github.com/gernotfound/logbook/pull/1152) fairness erasure, [#1141](https://github.com/gernotfound/logbook/pull/1141) 428/UID Kinde, [#1155](https://github.com/gernotfound/logbook/pull/1155) trasporto ADK browser e [#1143](https://github.com/gernotfound/logbook/pull/1143) aggiornamento PWA/Vite. [#1144](https://github.com/gernotfound/logbook/pull/1144) risulta **chiusa senza merge** perché assorbita dall'aggiornamento Vite di #1143. Le review tecniche sono annotate sulle PR: commenti dello stesso account autore non sono approvazioni GitHub di un soggetto distinto.

Sul nuovo `main`: [Main Release Gate/CodeQL](https://github.com/gernotfound/logbook/actions/runs/43753851256), [Firestore](https://github.com/gernotfound/logbook/actions/runs/43754055387) e [Static Assets + smoke HTTPS](https://github.com/gernotfound/logbook/actions/runs/43754087775) sono **SUCCESS** sullo SHA esatto. Il workflow **Cloudflare Isolated D1 API** era stato verificato con esito SUCCESS sul precedente main v2.461.0 ([run #43753229314](https://github.com/gernotfound/logbook/actions/runs/43753229314)); non sostituisce un nuovo collaudo sulla release connessa né prove Kinde reali.

**Readback diretto del provider Cloudflare, 15/11/2026:** `thelogbook-frontend` ha soltanto il binding `ASSETS` ed è distribuito al 100%; `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` sono privati, con binding D1 alla risorsa EU `thelogbook-cf02-eu-isolated-20261113`, service binding `AUTH_GATE` e limiter nel gate. D1 riporta `jurisdiction=eu`, read replication disabilitata. **Non** è stato osservato un binding KEK; il candidato HTTP Kinde `cloudflare/auth/kinde-http-worker.mjs` non è montato sul frontend. Il frontend ancora usa Firebase Auth/Firestore e l'helper Firebase `/__/auth/`. Non inferire login, OAuth, sync, diritti o recupero funzionanti dai deploy verdi. I conteggi D1 e il ledger 0001–0010 riportati nei checkpoint del 15/11 restano evidenza storica, non sono stati ripetuti durante questo readback.

### Gate prima di attivazione e collaudo Cloudflare/Kinde

1. **Confine HTTP ed identità:** predisporre routing deliberato e limitato al Kinde HTTP Worker per `POST /api/auth/kinde/start`, `GET /api/auth/kinde/callback`, `POST /api/auth/session` e `POST /api/auth/logout`, con binding privati e verifiche contro open redirect, replay, CSRF, sessioni scadute e rate limit. Il solo `auth-proxy.mjs` attuale intercetta `/__/auth/` per Firebase; non instrada queste route. Un codice candidato privo di route non è un sito autentificabile.
2. **Provider Kinde reale:** rileggere l'applicazione Back-end web, issuer, client ID, callback/logout registrati e metodi Password + Google; verificare policy minima **15 caratteri**, email verificata/reset, trust e unicità dell'owner. Il codice costruisce **esattamente** `https://thelogbook.me/api/auth/kinde/callback`; non sostituirlo con `/auth/callback` per analogia. La callback Google→Kinde `https://thelogbook.kinde.com/login/callback` è un flusso diverso. Senza accesso amministrativo Kinde non affermare che la callback sia configurata.
3. **Configurazione sicura server:** predisporre i binding necessari, incluso servizio privato Auth Gate, D1, limiter, client secret e KEK **solo come secret server-side**; verificare che la custodia ADK sia isolata dal vault device e che non vi siano dati salute in chiaro lato server. Non collegare un database di prova a dati reali né introdurre costi.
4. **App e recovery:** sostituire realmente `AuthContext`/azioni Firebase con l'identità Kinde, preservando guest puramente locale, consenso salute 18+, journal IndexedDB prima della rete, ADK separata, isolamento A→B→A, sessione e revoca, import/export, cancellazione e update PWA. Adapter e fixture attuali non sostituiscono questa integrazione.
5. **Prove verticali in sequenza:** test sintetici/CI exact-SHA e isolamento Worker; poi test controllati su provider con sole identità/dati sintetici autorizzati; verifica password, Google, verifica/reset, sessioni e cookie, consenso, cifratura, commit/ACK, offline/retry, diritti e cancellazione, Safari/iOS e quota CPU/D1. Ogni prova fallita o incerta deve essere NO-GO e non deve eliminare dati locali.
6. **Autorizzazioni separate:** mutazioni dell'app Kinde/Google OAuth Production, configurazioni segreti/IAM Production, esposizione di route che trattano dati sanitari, DNS e GO pubblico finale richiedono il mandato specifico del product owner previsto da AGENTS. I deploy automatici del solo frontend autorizzato non estendono tale mandato.

**Stato:** PARZIALE / NO-GO funzionale. L'audit approfondito delle prestazioni resta deliberatamente post-migrazione [#1123](https://github.com/gernotfound/logbook/issues/1123), senza rinunciare ai controlli minimi di quota e sicurezza necessari prima del GO.

## CF-03/04 — precondizione ADK e lettura candidata Kinde (15/11/2026)

La verifica **retrospettiva** della PR #1139 (annotata nella sua
conversazione GitHub) ha rilevato che gli assert `status != 200`
non distinguevano un ADK assente da un guasto transitorio. Non è una
review formalmente indipendente precedente al merge.
Nuovo contratto candidato: HTTP `428 cloud-key-required` soltanto
dopo prova D1 primary che chiave e marker mancano, revisione zero e
nessun documento cifrato, replica, receipt, mutation o erasure pendente,
con sessione/consenso tuttora validi;
`503` per guasti o stato chiave incoerente. Il client mantiene il
journal e il claim sigillato senza rebase automatico né ACK.
L'adapter read-only Kinde→consenso→controllo replica ricontrolla
UID/epoch/generazione dopo I/O **e richiede l'UID autenticato sulla
risposta stessa del controllo D1**. Questo blocca un cambio A→B→A
anche quando A e B condividono epoch e revisioni; un risultato senza
UID è rifiutato. Non abilita login reale, vault o Sync pubblici. OAuth/posta Production, KEK e dati reali restano NO-GO.
Per gli incrementi CRITICAL le review realmente indipendenti devono
essere registrate sullo SHA esatto, non dedotte dalla CI.

## Regressione CF-03/05 full-schema integrata (15/11/2026)

**Root cause identificata nel codice:** due test di integrazione
`cf03-kinde-http-worker.node.mjs` e
`cf05-cloud-key-http.node.mjs` applicavano ancora soltanto
`0001`–`0008`, sebbene il D1 isolato usi `0001`–`0010`.
La fixture precedente poteva ammettere una registrazione replica
dopo il solo consenso, senza mai esercitare il guard `0009` sulla
chiave cloud effettivamente custodita.

**Correzione integrata con [PR #1139](https://github.com/gernotfound/logbook/pull/1139):** fixture SQLite con tutte le dieci migrazioni,
test di rifiuto della replica prima dell'ADK e nessuna mutazione
SQL/ACK, rilascio chiave tramite percorso HTTP trusted, successiva
registrazione riuscita, separazione dei due proprietari e revoca
che rimuove il grant SQL preservando rights-export. Gli altri
test storici che verificano deliberatamente una specifica versione
di migrazione restano separati e non vengono riscritti come
baseline corrente. Sono regressioni di integrazione **sintetiche**,
non attestazioni del provider Kinde o del runtime Worker reale.
La precisione del contratto HTTP e i fence concorrenti sono ulteriori
interventi nella PR #1141, ancora non integrata; le altre otto suite
runtime sono oggetto della PR #1154.

## D1 isolata aggiornata — 10/10 migrazioni verificate (15/11/2026)

**Prova GitHub:** [workflow manuale #43702489692](https://github.com/gernotfound/logbook/actions/runs/43702489692)
**SUCCESS** su `main 5ca7afaca94e4431e298595eecdd2a023546fd21`
(v2.446.0). Il job ha verificato il target e il gate release,
poi Wrangler ha applicato `0009_require_cloud_key_for_replica_writes.sql`
e `0010_atomic_health_erasure_finalization.sql` e ha superato il
readback finale.

**Prova indipendente Cloudflare:** D1
`thelogbook-cf02-eu-isolated-20261113` (UUID
`9aa51833-8adc-495f-bdfc-93b5542e8023`), `jurisdiction=eu`,
repliche disabilitate, bookmark Time Travel disponibile.
Il ledger contiene **tutte e dieci** le migrazioni ordinate
`0001`–`0010`. Sono presenti la view
`sync_writable_cloud_key`, la tabella
`health_erasure_finalizations`, i trigger
`sync_receipt_requires_cloud_key`,
`health_erasure_finalization_fence` e
`health_erasure_finalize_atomically`, e i nuovi campi per
la finalizzazione dell'erasure su subject/job. Zero principal
Auth, sessioni, ADK cloud e job erasure; il documento cifrato e la
ricevuta **sintetici** preesistenti (uno ciascuno) sono conservati.

**Risultato limitato:** schema della sola D1 EU sintetica **COMPLETATO**;
il token dedicato `CLOUDFLARE_D1_API_TOKEN` è stato effettivamente
utilizzabile dal job, ma non è stata ispezionata la policy IAM completa,
né la scadenza/revoca. Nessuna migrazione di account/dati Firebase.
La disponibilità del bookmark non dimostra un restore provato:
restano da validare backup/restore, Auth Kinde, consenso,
KEK/cloud keys, sincronizzazione/ACK, erasure end-to-end,
quote/abuso e iOS/Safari. **NO-GO funzionale**, API Auth/Sync
pubbliche ancora escluse. Non ripetere la migration per attivare
funzioni estranee allo schema.

## Checkpoint storico credenziali D1 prima dell'esecuzione — 15/11/2026

**Nuova evidenza dichiarata dal proprietario:** creato su Cloudflare un token API
separato dedicato alle migrazioni D1 e aggiunto su GitHub Actions come repository
secret `CLOUDFLARE_D1_API_TOKEN`. L'utente ha confermato entrambe le operazioni
in chat il 15/11/2026, **senza condividere il valore del segreto**. La
presenza/accessibilità del secret al job, l'esatta policy IAM (D1 Edit,
account target, scadenza), e la variabile Actions `CLOUDFLARE_ACCOUNT_ID`
**non sono state verificate da letture indipendenti**: la conferma utente
non sostituisce un preflight del workflow.

**Readback provider indipendente, 15/11/2026:** la D1 isolata
`thelogbook-cf02-eu-isolated-20261113` è ancora in giurisdizione `eu`,
repliche disabilitate e ledger `0001`–`0008` (**8/10**). Su GitHub non
risulta ancora alcuna esecuzione del workflow manuale di migrazione.
Quindi `0009`/`0010` **non sono applicate** e nessun GO funzionale è
implicito nella creazione della credenziale.

**Prossimo gate:** verificare su GitHub che il secret esista e che
`CLOUDFLARE_ACCOUNT_ID` punti all'account atteso, poi avviare **solo su
`main`**, con autorizzazione operativa, il workflow
[`Cloudflare isolated D1 migrations`](../../.github/workflows/cloudflare-d1-isolated-migrations.yml).
Il job deve verificare exact-SHA/gate di release, token e D1 target in
preflight, applicare con Wrangler le migration autorizzate e attestare
ledger/oggetti SQL post-scrittura. In caso di errore non ripetere alla cieca;
registrare run SHA ed esito provider prima di procedere. Né questo
checkpoint né il secret autorizzano attivazione di API pubbliche, login Kinde,
dati salute reali, DNS o cancellazioni.

## B-04 — checkpoint storico precedente alla migrazione D1 (15/11/2026)

**Evidenza live successiva a `main 53f8a5562d9952c3f70c0175ee212f88e7f92d6b` (v2.445.0):**
readback Cloudflare in sola lettura sulla **sola** D1 sintetica
`thelogbook-cf02-eu-isolated-20261113`. Identità database e UUID
corrispondono a `cloudflare/api/wrangler.isolated.jsonc`;
`jurisdiction=eu`, repliche disattivate, bookmark Time Travel disponibile.
Il ledger è esattamente `0001`–`0008` (8/10), gli oggetti introdotti
da `0009`/`0010` sono assenti, principal Auth/sessioni/ADK/job di
cancellazione sono zero. Restano una riga documento e una ricevuta
**sintetiche**, da preservare. Nessuna migrazione remota è stata eseguita;
la lista GitHub dei run `workflow_dispatch` non contiene un run D1.

**Blocco esterno per l'esecuzione:** il workflow
[`cloudflare-d1-isolated-migrations.yml`](../../.github/workflows/cloudflare-d1-isolated-migrations.yml)
è già integrato, con guard exact-`main`, verifiche preflight in sola lettura,
migrazione via Wrangler ufficiale (backup/rollback), controllo post-migrazione
e test CI sul candidato. Serve il secret GitHub **dedicato**
`CLOUDFLARE_D1_API_TOKEN`; il connettore GitHub disponibile in questa
sessione non consente di creare secret né di avviare il `workflow_dispatch`.
Non aggirare il workflow eseguendo SQL/mutazioni dirette sulla D1 o riusando/
ampliando il token Worker. L'assenza del secret non è verificabile tramite
l'interfaccia del connettore: deve controllarla il proprietario su GitHub.

**Passaggio manuale minimo del proprietario (senza condividere il token):**

1. Cloudflare dashboard → account TheLogBook → **Manage Account → API Tokens**
   (oppure **My Profile → API Tokens**) → **Create Token → Custom token**.
   Concedere solo **Account → D1 → Edit** sull'account Cloudflare pertinente,
   senza Workers/DNS/altre permission, limitando durata e risorse dove
   consentito dalla UI. La policy D1 è di ambito account: non presumere
   isolamento del token a un singolo database.
2. GitHub repository `gernotfound/logbook` → **Settings → Secrets and
   variables → Actions → Secrets → New repository secret**. Nome esatto
   `CLOUDFLARE_D1_API_TOKEN`, valore uguale al token appena creato.
   Controllare inoltre che la variabile Actions `CLOUDFLARE_ACCOUNT_ID`
   sia valorizzata per l'account corretto. Mai pubblicare il valore in
   issue, chat, commit o log.
3. GitHub → **Actions → Cloudflare isolated D1 migrations (manual,
   main-only) → Run workflow**, selezionando **main**. Dopo il gate
   exact-SHA, il job applicherà solo i file consentiti `0009`/`0010`.
   Non modificare l'ambiente né riavviare su un branch separato.

**Accettazione del risultato:** richiedere run conclusa `success` e
rilettura indipendente provider su UUID/giurisdizione, dieci entry contigue
nel ledger `d1_migrations`, view `sync_writable_cloud_key`, tabella
`health_erasure_finalizations`, trigger
`health_erasure_finalization_fence`, assenza di account/chiavi/job reali
e preservazione delle fixture sintetiche. Un run fallito o un ledger parziale
resta **BLOCCATO**: conservare il checkpoint Time Travel e diagnosticare
prima di ripetere. La sola conclusione del workflow non prova restore,
Auth Kinde, cifratura, replica/ACK, revoca o erasure end-to-end; non è GO
full-stack.

## Checkpoint B-03 storico post-merge, pre-migrazione D1 — 15/11/2026

La [PR #1135](https://github.com/gernotfound/logbook/pull/1135) è stata integrata
con squash in `main ed31c42af38e065dd448308e6c7d546ae80978e6` (v2.444.0). CI PR [#43662166211](https://github.com/gernotfound/logbook/actions/runs/43662166211), [Main Release Gate/CodeQL #43696757160](https://github.com/gernotfound/logbook/actions/runs/43696757160), [Worker API e Auth Gate privati #43696757245](https://github.com/gernotfound/logbook/actions/runs/43696757245), [Firestore #43696941939](https://github.com/gernotfound/logbook/actions/runs/43696941939) e [Cloudflare Static Assets/smoke #43696964223](https://github.com/gernotfound/logbook/actions/runs/43696964223) tutti **SUCCESS** sull'esatto SHA. Firestore non ha effettuato scritture: Rules e indici erano già convergenti.

La verifica diretta D1 successiva al merge conferma ancora **otto migrazioni
applicate su dieci** (`0001`–`0008`), giurisdizione EU, repliche disabilitate,
bookmark Time Travel disponibile e nessun principal/sessione/ADK/job erasure.
Il workflow manuale per `0009`/`0010` è ora presente in `main`, ma **non è
stato eseguito**. Per avviarlo servono un token separato di minimo privilegio
in GitHub Secrets e le verifiche preflight già implementate. Il successo dei
deploy e della CI non prova l'applicazione delle migrazioni, né autorizza il
GO di Auth, sync, cifratura cloud, consenso o cancellazione completa.

## Verifica provider Cloudflare storica pre-migrazione — 15/11/2026

Readback diretto Cloudflare su D1 `thelogbook-cf02-eu-isolated-20261113`:
giurisdizione `eu`, read replication disabilitata, bookmark Time Travel
disponibile. Il ledger contiene **otto migrazioni (0001–0008)**, mentre
`main` include anche `0009` (scritture replica subordinate alla custodia
ADK) e `0010` (prova atomica di cancellazione). Nessuna delle due è attestata
come applicata al provider. Sono stati letti soltanto aggregati: zero
principal Kinde/sessioni/ADK/job di cancellazione, con una fixture sintetica
di documento e ricevuta conservata. I Worker API e Auth Gate privati hanno
entrambi binding verso questa D1 e URL workers.dev/preview disabilitati; il
Worker frontend rimane separato con solo ASSETS. Il workflow Static Assets
su `main fd6570c6` è SUCCESS, ma non prova la migrazione API.

**Incremento B-03 integrato (PR #1135; workflow ancora non eseguito):** workflow manuale **solo su main**
`.github/workflows/cloudflare-d1-isolated-migrations.yml`, con guard
sull'esatto SHA di main già verificato, identità D1, schema in allowlist,
assenza di account veri, disponibilità Time Travel, applicazione ufficiale
Wrangler con backup e controllo SQL/ledger dopo l'applicazione. Richiede
un token GitHub separato `CLOUDFLARE_D1_API_TOKEN` con scope D1 write;
l'attuale token di deploy Workers aveva restituito 401 su D1 REST e non
deve essere ampliato. **Finché il workflow non viene eseguito e verificato,
D1 resta 0008/0010.** Non sono autorizzate route API pubbliche,
operazioni su account reali, OAuth Production, DNS o GO sanitario.

## Checkpoint storico precedente al merge B-03 — 15/11/2026

**HEAD verificato GitHub:** `f10dd7089a4633096869faf88482250fe26b8edc` (v2.442.0). Tutte le nove PR #1125–#1133 sono squash-merged, con **zero PR aperte** al checkpoint: C-02 (split test UI WebKit), B-01 (`0009` fence ADK/replica), B-02 (`0010` finalizzazione erasure atomica), A-06 (prova identità OIDC separata dal login verificato), A-04 (`emailVerified` attendibile), D-01 (UID consenso e diritti), A-01 (UID client), D-02a (runner con lease e proof primaria), C-01 (regressioni IDB journal/receipt). Sul candidato D-02a gli **otto test full-schema del finalizzatore** sono stati eseguiti, zero skip.

**Gate dello stesso SHA `main`:** [Milestone/Main Release Gate e CodeQL #43658661516](https://github.com/gernotfound/logbook/actions/runs/43658661516) **SUCCESS**; [Firestore #43658877933](https://github.com/gernotfound/logbook/actions/runs/43658877933) **SUCCESS**, nessuna modifica Rules/indici necessaria; [Cloudflare Static Assets #43658905338](https://github.com/gernotfound/logbook/actions/runs/43658905338) **SUCCESS al primo tentativo** con smoke HTTP non distruttivo su `thelogbook.me`. Il codice dei Worker privati è stato verificato in CI, ma i servizi reali e la D1 richiedono lettura diretta del provider per attestare configurazione e schema attuali.

**NO-GO full-stack:** all'ultima lettura provider Cloudflare del 14/11 la D1 sandbox riportava migrazioni `0001`–`0008`. L'integrazione di `0009/0010` **non ne prova l'applicazione remota**. Non sono stati attivati cron erasure, route Auth/Sync pubbliche, login Kinde reale, KEK/cloud keys e recovery verificati, export/diritti end-to-end, backup/restore anti-resurrection o GO sanitario; restano quote Free, Safari iOS/PWA e privacy. Non trasferire account/dati Firebase pre-lancio.

## Decisioni confermate

- **Fresh start:** non esistono account/dati pre-lancio da trasferire; niente migrazioni Firebase→D1 di utenti, password, chiavi, consensi, sessioni o dati sanitari. Preservare invece tutte le funzioni approvate, il motore locale e i formati che il sistema nuovo effettivamente creerà.
- **Frontend:** Cloudflare Workers Static Assets; **backend:** API Workers e D1 SQL con giurisdizione `eu` da verificare sull'istanza effettiva. Nessun billing o upgrade autorizzato.
- **Identità:** Kinde scelto per Email e Google; questi pulsanti sono stati abilitati nell'onboarding. **Metodo email/password ≥15 caratteri, Google OAuth, reset/verifica e sessioni non sono ancora collaudati**. I messaggi Auth saranno gestiti da Kinde, senza un servizio email separato.
- **Confini di fiducia:** Kinde conferma l'identità; Workers/D1 devono autorizzare owner, stato account, consenso salute, revoca, cancellazione, sessioni e quote. Nessun dato salute in chiaro su Kinde o D1. Una sessione valida e un JWT firmato non sostituiscono consenso e owner fence.
- **Dominio di sviluppo (decisione 14/11/2026):** `https://thelogbook.me` è l'unico origin pubblico richiesto per il frontend. Il proprietario autorizza il cambio DNS/Workers per il sito e la disabilitazione dei collegamenti `workers.dev` e preview del solo Worker TheLogBook. Il deployment resta vincolato a `main` verificato, con esito runtime da osservare. Il dominio pubblico **non** certifica una release funzionale: Auth, consenso cloud, replica, chiavi e diritti rimangono non attivi finché non sono verificati.
- **Dismissione:** eliminare funzioni Firebase/Vercel solo dopo aver verificato il percorso equivalente. Non mantenere compatibilità con installazioni pre-lancio inesistenti. OAuth/posta Production, credenziali, billing e dismissioni irreversibili richiedono mandato e GO separati.

## Stato osservato e limiti delle prove

| Componente | Stato osservato | Prova ancora mancante |
|---|---|---|
| GitHub | Incrementi integrati e candidati distinti nel checkpoint sopra e nell'epic #1053; prove exact-SHA nelle PR, nessuna review indipendente CRITICAL sostituita dalla sessione autrice. | Riallineamento/review dei candidati; la CI non prova login Kinde o API live |
| Static Assets | Provider riletto 15/11: `thelogbook-frontend` su `thelogbook.me`, solo `ASSETS`, `workers.dev`/preview disabilitati. Deploy e smoke exact-SHA registrati nelle PR integrate. | Installazione/update Safari iOS, comportamento guest, rollback e Auth cloud separata |
| D1 | Readback 15/11: sandbox `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`, primaria EEUR, repliche off, ledger `0001`–`0010` applicato. Zero principal/sessioni/ADK/job; documento e receipt sintetici conservati. | Recupero, quote/CPU, custodia KEK e protezione anti-resurrection; nessun restore provato |
| Workers API/Auth | Provider riletto 15/11: Worker `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` privati, binding D1/`AUTH_GATE` e limiter; `workers.dev`/preview off e nessun binding KEK. La presenza dei servizi non è un test Auth HTTP live. | Kinde OAuth/password/Google reale, session scope, consenso/ADK, sync e recovery HTTP |
| Kinde | Business `thelogbook.kinde.com` in regione `Europe - Ireland` secondo schermate; selezionati metodi Email e Google nell'onboarding | Applicazione OAuth, codice autorizzazione + PKCE/state/nonce monouso, password, email, claim reali, retention e antiabuso |
| DNS e provider legacy | Il DNS web dell'apice serve il Worker tramite record Cloudflare originless proxied; record MX/DKIM/DMARC IONOS invariati nel controllo provider del 14/11. Hosting Firebase disabilitato secondo proprietario, Vercel `logbook` sospeso secondo precedente verifica. | HTTPS smoke della release esatta, browser guest/PWA; API e codice legacy da sostituire e verificare separatamente |

Il `jurisdiction=eu` della D1 **non garantisce** localizzazione europea di Workers, log, email, Google OAuth o tutti i subprocessori. Non dedurre conformità GDPR da un singolo flag.

**Pubblicazione frontend:** la lettura del `robots.txt` pubblico ha confermato che Bot Preference Sync inserisce una policy Content Signals prima del file applicativo; le delimitazioni effettive sono `# BEGIN Cloudflare Managed content` e `# END Cloudflare Managed Content`. Il precedente smoke della v2.407 falliva anche su output valido perché confrontava una prima riga errata. `scripts/verify-cloudflare-served-asset.mjs` mantiene il confronto byte-per-byte per tutti gli asset e ammette **solo per `/robots.txt`** un wrapper riconosciuto (max 8 KiB), con `ai-train=no` e l'intero file originario come suffisso esatto. Lo smoke prevede al massimo quattro confronti sulla stessa URL, con tre pause limitate per convergenza edge; un mismatch persistente continua a fallire con diagnostica. La stessa garanzia è estesa alla scorciatoia di navigazione `/?tab=training`: risposta HTML identica ai byte di `index.html`, tentativi limitati e diagnostica di risposta (status, cache, hash) se non converge; non basta un HTTP 200 né un corpo HTML genericamente valido. Test negativi coprono policy falsificata, suffisso alterato, route diverse ed errori del validatore. Non disabilitare la protezione bot per rendere verde la CI. Queste prove non attestano funzionamento Auth/Sync o Safari.

### Audit del rilascio frontend del 14/11/2026

- **Rilievo privacy/runtime verificato:** il provider aveva Web Analytics/RUM `on`, un sito Analytics `auto_install=true` e ruleset `enabled=true`, nonostante il divieto di telemetria client automatica. In HTTP `/?tab=training` rispondeva 200 ma con 4004 byte e SHA-256 `edeb98426beab2b88843a3f32a9bf3342c8e5a0b2e136e74396faa3305ce90e6`, contro i 3637 byte e SHA-256 `42480e612f45d5b4a16ae8dcb661fed3edd9ae7d9cfd53689eb222d58889b29c` della build. Le richieste con `Cache-Control: no-cache` restituivano il contenuto corretto, ma un purge mirato di `/?tab=training` non eliminava il mismatch. Non attribuire senza prove a un deposito statico obsoleto.
- **Correzione provider (non distruttiva):** disattivato RUM e successivamente `auto_install`; l'API rappresenta ora la zona come `rum=manual`, con `auto_install=false` e ruleset `enabled=false`, senza snippet nella build applicativa. Non sono stati eliminati il sito Analytics, dati storici, DNS, email o segreti. Ulteriore richiesta `rum=off` da modalità manual è stata rifiutata dal provider (errore 10028); il criterio operativo è **nessuna raccolta automatica e nessuna iniezione**, non imporre un valore API non applicabile.
- **Conferma indipendente:** stesso commit `2077ece8fe9f1deacc3222958b98b3a26b30ac60`, stessa build, [run #43609342261](https://github.com/gernotfound/logbook/actions/runs/43609342261) tentativo 3 **SUCCESS** dopo il cambio impostazioni, inclusa la navigazione `/?tab=training`. La CI precedente già verde non dimostrava la correttezza dei byte all'edge. Sono rimasti attivi Bot Preference Sync, i controlli CSP, il confronto SHA/byte-exact, i 404 e la restrizione a `thelogbook.me`; `workers.dev` e preview restano disabilitati.
- **Limiti:** è verificato soltanto il frontend statico pubblico, **non** Auth/email/Google, consenso cloud, D1, sync, cancellazione, browser Safari iOS, risorse reali o conformità GDPR. Confermare lo stato Analytics presso Cloudflare dopo ogni cambiamento del provider; il controllo HTTP è il gate di regressione automatico. Dati eventualmente già raccolti dal sito Analytics non sono stati inventariati né eliminati.

### Incremento CF-04 — stato di un commit D1 non confermato

Il codice candidato espone `commit/status` sotto AuthGate e CSRF di sessione. Una SELECT SQL sulla D1 primaria controlla **insieme** la revisione corrente e la presenza di una receipt hash-bound del batch. Senza ricevuta e senza avanzamento della revisione l'esito è `inconclusive`, non autorizza nuova write; dopo avanzamento senza ricevuta è `not-committed`, che può servire a un futuro rebase. La risposta `committed` non sostituisce il controllo `receipt()` né autorizza un ACK. Test isolati verificano conflitti, receipt storica, CSRF/sessione revocata, hash alterato e limite HTTP. Il client candidato aggiunge ora `restageUncommittedCloudflareDelivery()` dopo un `409`: usa `commitOutcome`, scansione completa autenticata con ADK e due letture del registro coerenti, quindi ricalcola il merge causale e sostituisce l'intento in un solo update IndexedDB. Il nuovo intento resta `retry-staged`: il batch non viene inviato né ACKato nella stessa chiamata. In assenza di prove, o con stessa replica già avanzata, conserva i ciphertext originali e il journal. **Non è ancora integrato nel runtime PWA, né pubblicata alcuna API Worker.**

### Incremento CF-04 — composizione del journal D1 isolata (14/11/2026)

`src/lib/sync/cloudflareJournalCandidate.ts` compone il controllo replica e la lettura dei documenti con lo staging cifrato `stageCloudflareDelivery()` e il recupero della ricevuta `resumeCloudflareDelivery()`. Legge prima un eventuale intento già durevole, riutilizzandolo immutato; non sostituisce il writer Firestore nel frontend. I test isolati coprono ACK verificato, perdita della risposta, revisione mutata, cambio sessione, guest e CSRF assente. **Restano da integrare e collaudare** il candidato di recovery dopo 409 non committato, bootstrap/hydration e integrazione con Kinde/ADK reali: il candidato non va distribuito come sync funzionante. CI e merge hanno prove separate dal runtime Workers/D1.

### Incremento CF-05 — chiavi ADK/KEK su Workers/D1 (candidato isolato)

`cloudflare/api/cloud-key-crypto.mjs` è il codec WebCrypto AES-256-GCM di una ADK random per UID con AAD owner-bound, IV casuale, formato v1 stretto. `cloud-key-store.mjs` legge e rilascia la chiave wrappata solo attraverso claims fidati del private AuthGate e una nuova verifica SQL primaria di sessione, consenso, epoch e scopo. La creazione condizionale richiede consenso appena accettato, nessun documento/replica/ricevuta o job attivo e registro issuance assente per quella generazione; il trigger della migration `0007_cloud_key_custody.sql` crea la prova `cloud_key_issuance` **nella stessa transazione**. Anche senza la riga wrapped, un marker issuance persistente impedisce rigenerazione sopra dati orfani. I concorrenti leggono il winner salvato, senza credere a un ACK perso. Dopo revoca `rights-export` legge soltanto una ADK già presente, senza provisioning. Update della chiave vietato; DELETE richiede un job di erasure lease-fenced in fase `awaiting-keys`.

**Non attivato:** nessuna route API delle chiavi, secret Cloudflare o integrazione browser; la migration 0007 è installata nella D1 isolata ma non rilascia chiavi. La KEK v1 di Cloudflare richiede provisioning autorizzato, custodia esterna indipendente e prova di restore/rotation senza perdere ADK. Il SQL `0010` e il finalizzatore D-02a ora codificano cancellazione ADK e prova terminale atomiche, testate su SQLite sintetico; il job non è attivo sulla D1 remota. CF-08 deve ancora bloccare restore anti-resurrection. I test SQLite/fake AuthGate non certificano il runtime D1 Free, Kinde reale o GDPR.

## Integrazioni candidate presenti nel repository

**Provider OAuth/Kinde — configurazione amministrativa osservata, non login operativo (14/11/2026):** nel progetto Google Cloud `thelogbook-oauth` il pannello Audience mostra **Esterno / In produzione**; il proprietario conferma credenziali Google proprie impostate nella social connection Kinde `TheLogBook`, con **Email Password e Google attivi, Email Code/Phone/Username disattivati** come da screenshot. La schermata Kinde Details mostrava inizialmente tutti gli URI vuoti; il proprietario ha poi confermato **Application homepage URI = `https://thelogbook.me/` salvato**, senza read-back indipendente. **Application login URI, Allowed callback URLs, Allowed logout redirect URLs** non risultano configurati. L'indirizzo homepage Google OAuth è invece `https://thelogbook.me/about`; la callback `https://thelogbook.kinde.com/login/callback` appartiene a **Google→Kinde**, non a **Kinde→Workers**. Le pagine statiche `/about` e `/privacy` sono state verificate con smoke Cloudflare [#43616173486](https://github.com/gernotfound/logbook/actions/runs/43616173486). Implementazione callback OAuth Code+PKCE con state/nonce monouso, sessione trusted, browser/Safari, password ≥15 anche reset ed email reale restano **NO-GO**. [Guida dettagliata Kinde](kinde-auth-setup.md), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Google Branding / Search Console — provider verificati da screenshot del proprietario (14/11/2026):** Search Console ha mostrato **«Proprietà verificata»** per la nuova proprietà Dominio `thelogbook.me`, dopo che l'integrazione con Cloudflare ha autorizzato l'inserimento di un TXT DNS. Il TXT non va rimosso. La prima richiesta di verifica Branding aveva segnalato la homepage `https://thelogbook.me/about` non registrata al proprietario; dopo la verifica dominio, il pannello Google OAuth `thelogbook-oauth` mostra **«Il tuo branding è stato verificato e viene mostrato agli utenti»**. Logo PWA, homepage `/about` e informativa `/privacy` sono visibili nel pannello. Questo chiude il gate amministrativo **proprietà dominio/Branding Google**, non il test OAuth, il controllo di scope e redirect client, i Termini pubblici o la revisione legale della Privacy. Non certifica login Kinde, API Worker, sessioni D1, sicurezza Auth o GO della release.

**Auth (CF-03):** `cloudflare/auth/kinde-token-verifier.mjs` verifica firma JWKS RS256, issuer, audience API, client/azp, scadenza e subject. `kinde-login-proof.mjs` verifica in più ID token, audience distinta, `email_verified`, nonce, corrispondenza del soggetto e `at_hash` se presente. `kinde-principal-provisioner.mjs` è un candidato **interno, non un endpoint**: dopo quella verifica deriva un UID D1 stabile da SHA-256 con separazione di dominio su `(issuer, subject)` e inserisce una sola volta un principal verificato; una lettura primary-sequential conferma l'esito, senza riattivare principal disabled/deleted né azzerare epoch. Non importa dati Firebase e non salva email o salute. Il callback **candidato** crea e consuma `state` monouso server-side, effettua code exchange PKCE e passa il nonce originale a provisioner e `session-issuer.mjs` dopo prova autorevole; non è pubblicato né testato col tenant Kinde reale. In caso di risposta D1 ambigua non si emette una sessione. Resta da verificare revoca Kinde e modifica successiva dello stato email. `session-gate.mjs` controlla sessione e autorizzazioni per gli accessi successivi. Mai accettare UID o nonce direttamente dal client come prova sufficiente. [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Replica (CF-01/02/04):** `cloudflare/api/worker.mjs`, `d1-document-store.mjs` e `replica-maintenance.mjs` definiscono il trasporto D1 con SQL CAS, session/consent fence e receipt. `cloudReplicaDurableDelivery.ts` e i moduli contigui persistono il batch ciphertext e il prefisso journal in IndexedDB **prima** della rete; una ricevuta originale verificata autorizza solo l'ACK di quel prefisso, mai un successo su timeout o stato ambiguo. È vietato esporre un'API con AuthGate sintetico o collegare D1 a `replicateJournal()` prima del percorso identità/consenso reale. [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058).

**Consenso, cifratura e cancellazione (CF-05/06):** migrazioni `0003`–`0010`, custodia ADK, job e runner D-02a sono integrate. Dopo il drain bounded, una sola istruzione SQL `0010` finalizza ADK, prova terminale e job `complete` con lease valido; un ACK ambiguo richiede readback D1 primaria e `awaiting-keys` da solo non basta. Gli 8 test di finalizzazione sono passati sullo schema SQLite sintetico. Lo schema è applicato sulla D1 isolata; mancano esecuzione trusted end-to-end dei job, cron, export, account Kinde, retention e restore anti-resurrection. La DEK device e la chiave cloud account rimangono indipendenti. Non promettere E2EE/zero-knowledge né recupero impossibile. [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) · [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060).

**Sicurezza perimetrale (CF-07):** il candidato `cloudflare/api/worker.mjs` applica budget JSON **per route**, prima del parsing: `control` 128 B, `read` 512 B, `scan` e `receipt` 256 B, membership `claim/retire/status` 4 KiB; il commit mantiene il budget di otto documenti cifrati (~7,6 MB). Lo stream viene limitato anche senza `Content-Length`; URL di sync con query non sono alias validi. Questi limiti sono verificati su fixture HTTP/SQLite e **non dimostrano ancora** CPU/abuso su Workers Free. Turnstile, quando usato, deve avere Siteverify server-side con hostname/action e token monouso; Cloudflare WAF non protegge automaticamente gli endpoint hosted Kinde. Limitare richieste, CPU, query e abuso di email/login; verificare anche accessi diretti tramite `workers.dev`, version/preview e custom domain. Un limite Free o un errore del provider devono fallire in sicurezza senza perdere journal o concedere ACK fittizi. [CF-07 #1061](https://github.com/gernotfound/logbook/issues/1061).

## Sequenza di completamento

1. Su tenant Kinde isolato: verificare policy password ≥15 su registrazione e reset, login Google, email verificata, MFA, logout/revoca, erasure via API nel Free, privacy/retention e redirect Safari/iOS. Non trascrivere token, chiavi o dati personali nel repo.
2. Implementare callback OAuth code + PKCE/state/nonce server-owned monouso, mappatura account D1 e sessione applicativa con cookie Secure/HttpOnly/SameSite + CSRF; prova multi-tab/multi-device e revoca effettiva.
3. Collegare ADK/device vault e consenso prima della replica; provare D1 su dati sintetici, ACK, offline, conflitti, crash, lost-response e owner isolation, sempre senza salute plaintext lato server.
4. Completare export/delete, revoca salute, cancellazione account (identità Kinde compresa), inattività 12 mesi, backup/restore e job bounded; errori e retry devono lasciare ricevute verificabili.
5. Misurare quote Free, CPU/storage, denial-of-service, privacy e sicurezza; verificare UX per viewport/theme/accessibilità, update PWA e rollback su Safari. Il dominio è autorizzato **solo per lo sviluppo pubblico**; il GO funzionale completo resta vincolato ai gate GitHub, provider e prodotto. Non usare il cutover del dominio come prova di funzionalità o di continuità dati.

Le parti indipendenti possono avanzare in parallelo a CF-00, ma **nessuna dipendenza non validata può essere attivata nel percorso reale**. Non eseguire deploy non-main su risorse Production o test su dati Production.

### CF-07 — preflight economico delle API candidate (14/11/2026)

Il Worker API controlla Content-Type JSON e Content-Length dichiarato prima di chiamare il service binding privato AuthGate. Le richieste chiaramente invalide ricevono 415/413 senza consumare il rate limiter né la verifica di sessione/consenso; il corpo streaming resta limitato e letto soltanto dopo Auth, per non fare parsing costoso di payload non fidati. Un test Node/SQLite attraversa il vero handler del Worker e verifica che AuthGate non venga chiamato nei casi respinti. Il controllo degli header **non** sostituisce WAF, Turnstile, quota CPU/D1, dimensione streaming né hard cap globali. Nessun Worker API è pubblicato.

## Contratti e tracciamento

[AGENTS](../../AGENTS.md) · [Account](../../.agents/rules/account-lifecycle.md) · [Archivio cifrato](../../.agents/rules/secure-storage.md) · [Storage/sync](../../.agents/rules/storage-and-sync.md) · [Consenso](../../.agents/rules/health-consent.md) · [CI](../../.agents/rules/ci-verification.md) · [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063) · [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041). Lo storico degli incrementi è consultabile nella cronologia Git e nelle PR, non copiato come checklist nel runbook corrente.


### CF-05 — precisione dell'orologio SQL per sessioni e lease (14/11/2026)

Il codice delle transazioni D1 candidate confrontava timestamp del Worker
`Date.now()` con
`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`.
La sottrazione su floating point seguita da troncamento poteva produrre
un millisecondo in meno del timestamp intero, causando rifiuti
intermittenti della sessione appena emessa. Il candidato utilizza
un'espressione condivisa basata su
`strftime('%s','now')` più i millisecondi frazionari, senza
conversione Julian floating point, nei gate di custodia ADK, fence
sessione e worker erasure. Il test SQL verifica valori fissi, limite
di secondo e sessioni appena emesse, oltre alle regressioni CF-05.

**Distinzione schema/provider:** la vecchia espressione è ancora presente
nelle migration storiche `0001_encrypted_replica.sql` e
`0007_cloud_key_custody.sql` (trigger D1): non riscrivere
migration già applicate; gli eventuali trigger da correggere richiedono
una nuova migration verificata su database sintetico/restore e un
separato gate Provider. Nessuna modifica al D1 remoto è compresa
in questo fix; la CI SQLite non certifica il runtime Cloudflare.

### CF-03 — composizione HTTP Auth (solo codice candidato, 14/11/2026)

Dopo l'integrazione della PR #1111 (Kinde Code+PKCE), il modulo candidato
`cloudflare/auth/kinde-http-worker.mjs` prepara l'accesso
HTTP HTTPS same-origin, introspezione della sessione D1 tramite
`AUTH_GATE` e logout della singola sessione CSRF-bound.
Nuovi test Node/SQLite/Jose e config Wrangler locale, senza collegamento
al frontend o pubblicazione API. Kinde Audience, callback, Free,
password/Google/email reali, rollout UI, provider DNS, consenso/recovery
e browser Safari restano NO-GO. La presenza del file o il suo test
non costituiscono prova di runtime Cloudflare.


### CF-03 — Service Worker: navigazioni Auth fuori dall'app shell (14/11/2026)

La registrazione Workbox della PWA intercettava ogni navigazione GET
non esclusa e poteva restituire `index.html` al posto della
callback OAuth, anche dopo un futuro deployment del Worker API. Il
perimetro condiviso `src/lib/pwaHttpNavigationBoundary.ts` esclude
dal fallback `/api/auth` e `/v1` (inclusi i figli), così
un codice di autorizzazione Kinde non viene scambiato per un documento
offline, e un endpoint API mancante fallisce attraverso HTTP invece di
mostrare la pagina applicativa. Le shortcut
`/?tab=training` e le pagine pubbliche non cambiano. La
suite Vitest esercita la regex production e verifica l'integrazione
nel vero `src/sw.ts`; restano da verificare il comportamento
di WebKit/iOS installato, il rilascio PWA e l'API Auth effettivamente
montata. Nessuna route Auth pubblica viene abilitata da questo diff.


### CF-05 — accesso HTTP alle chiavi ADK, solo candidato (14/11/2026)

Il Worker API candidato `cloudflare/api/worker.mjs` integra due nuove route
`POST /v1/cloud-key/sync` e
`POST /v1/cloud-key/rights-export`. Richiedono sessione Kinde
verificata e D1 corrente tramite `AUTH_GATE`, token CSRF,
origin esatto, nessun corpo e guardia di consenso specifica. Una chiave
viene restituita al browser soltanto dopo controlli D1 primari pre/post
decifratura; dopo la revoca rights-only è lettura di ADK preesistente,
mai nuova emissione. Risposta in formato compatibile con
`thelogbook-account-data-key`, senza cache o telemetria.
Test integrati in M7 su SQLite sintetica con API e AuthGate autentici.

**Non attivo in rete:** `cloudflare/wrangler.jsonc` non espone
queste route né contiene binding D1/KEK. Le migrazioni 0001–0010 sono installate **solo nella sandbox D1 EU** (readback 15/11);
non sono stati configurati segreti KEK né collaudata la route;
 servono ancora custodia e
recupero KEK indipendenti, completo contratto erasure/rights, consenso
client, journal e session lifecycle Kinde, WAF/quote e prove reali
iOS/Workers/D1. I test Node e la CI non attestano runtime cloud.

### CF-02 — D1 schema e binding API privato (14/11/2026)

Read-back diretto Cloudflare: sandbox D1
`thelogbook-cf02-eu-isolated-20261113` con `jurisdiction=eu`,
primaria `EEUR`, read replication disattivata e registro
`d1_migrations` da 0001 a 0008. Le tabelle di principal/sessioni,
consenso/revoca/cancellazione, custodia ADK e tentativi OAuth sono presenti.
L'identità, i documenti e la ricevuta **sintetici** precedenti non sono stati
alterati; nuove tabelle Auth/OAuth vuote. Un bookmark Time Travel precedente
alle migrazioni è stato acquisito, ma nessun restore è stato eseguito.
Il provider rifiuta `PRAGMA integrity_check` via REST: prova non eseguita.

Il Worker frontend live resta distinto dal backend. Le configurazioni
`cloudflare/api/wrangler.isolated.jsonc` e
`cloudflare/auth/wrangler.isolated.jsonc` vincolano il D1 isolato
a due servizi privati senza URL pubblici e senza DNS. La pipeline
`.github/workflows/cloudflare-api-isolated.yml` distribuisce solo
da una `main` verificata e controlla i binding live dopo il deploy.
La presenza della pipeline non è prova di esecuzione: per dichiarare
"binding collegato" servono run riuscita e readback provider.
Non certifica Auth Kinde, HTTP runtime, sincronizzazione o release PWA.

### CF-02 — worker privati collegati, distinzione token D1 (14/11/2026)

Il merge [#1117](https://github.com/gernotfound/logbook/pull/1117)
su `main f3fc9b138e62bfc1fc6beb22ce6f2c7ba5d4e2f0` ha superato
Canonical Verification e Main Release Gate; CodeQL sul push main è verde.
La [run privata #43638837192](https://github.com/gernotfound/logbook/actions/runs/43638837192)
ha compilato e caricato i Worker, confermando in Wrangler binding D1 e
service e **nessuna route pubblica**. Readback indipendente del provider
Cloudflare: due Worker privati presenti, `DB` collegata alla stessa D1 EU
`9aa51833-8adc-495f-bdfc-93b5542e8023`, `AUTH_GATE` corretto,
rate limiter presente, workers.dev e preview disabilitati. Frontend live
rimane con solo `ASSETS`. **Non equivale a chiamata API autenticata,
session issuance Kinde, consenso browser o sync funzionante.**

Il passo finale della run ha fallito HTTP 401 sul **read D1** con il
token di deploy GitHub; le permissions di D1 non vanno aggiunte a un token
Workers destinato alla pubblicazione. La lettura del ledger 0001–0008 e
la giurisdizione EU è stata svolta direttamente con il plugin Cloudflare,
con autorizzazione indipendente. Una PR correttiva rende il readback CI
least-privilege sui binding Worker (negativi su 401, DB sbagliata, route
pubbliche e gate assente); non presenta la sola CI come prova di schema.

### CF-03 — test verticale Kinde → consenso → D1 (solo sintetico)

La suite `tests/cloudflare/cf03-kinde-http-worker.node.mjs` attraversa insieme i **moduli reali** di callback OAuth, emissione cookie sessione, AuthGate, primo consenso e replica D1. Applica lo schema corrente `0001`–`0010` a SQLite e usa token RS256 firmati localmente, mai credenziali del provider. Verifica rifiuto prima del consenso, CSRF, accettazione esplicita, accesso ADK prima dell'iscrizione della replica, isolamento di due owner, revoca con job ancora `pending` e logout con revoca sessione. La registrazione della replica **non** attesta cifratura AEAD, commit documenti, ACK o restore.

Questo è un test **Node/SQLite sintetico**, non un collaudo HTTP del Worker live, una prova Kinde reale, email/password/Google, Safari, sincronizzazione cross-device o recupero dei dati. Il candidato HTTP Kinde resta **non pubblicato**; gli URL e secret provider devono essere riletti e verificati prima della pubblicazione. CI/SHA e limitazioni sono tracciati in [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

### CF-03 — adapter client sessione/consenso e POST OAuth (candidato isolato)

Il modulo `src/lib/auth/kindeCandidateClient.ts` prepara il **confine di applicazione** per Kinde senza modificare l'attuale `AuthContext` Firebase e senza avviare fetch automatiche. La lettura consultiva usa solo endpoint HTTP same-origin (`/api/auth/session` e `/v1/consent/status`), credenziali cookie, no-store, controllo dei campi e ricontrollo finale UID/epoch/revisione, con guard del chiamante per cambi di generazione. Rifiuta errori trasporto, app shell HTML, redirect e inconsistenze; `signed-out` è distinto da `unavailable`. Non pubblica dati sanitari, non tocca IndexedDB, non riconosce il consenso guest e non avanza ACK.

L'avvio OAuth è predisposto come navigazione HTML `POST /api/auth/kinde/start` **senza body applicativo**; `fetch` non può leggere in sicurezza un redirect 303 cross-origin opaque. Il candidato `cloudflare/auth/kinde-http-worker.mjs` ora ammette una form POST con stream di **zero byte**, verificando dimensione effettiva prima del rate limiter e del salvataggio dello state; ogni byte non vuoto è rifiutato. Test sintetici Node + Vitest coprono la forma di navigazione, i rifiuti e la lettura client con fence. Il Worker HTTP Kinde e l'adapter **non sono montati nel frontend pubblico**: non hanno route reali e non attestano login/email/Google, quota, consenso browser, ADK, sync o recovery. Attivazione, UX guest→account e integrazione `AuthProvider` rimangono gate separati e non possono riutilizzare Firebase `User` come identità Kinde.

### CF-03/04 — precondizione ADK e revoca concorrente

Il claim distingue `428 cloud-key-required` dalla custodia incoerente o dal guasto D1 (`503`), dalla revoca (`403`) e dal conflitto CAS (`409`). Dopo un fallimento SQL per ADK assente, sessione, consenso, revisione e assenza di dati/chiavi sono letti **nella stessa SELECT primaria**: una revoca o un claim concorrente intervenuti prima di quella lettura non possono diventare una nuova autorizzazione al provisioning. Il client conserva intent e journal; la precondizione non è un ACK né una concessione della chiave. La suite ADK usa tutte le migrazioni canoniche e il finalizzatore atomico effettivo, con regressioni su sessione/revoca intercalate, claim vincente concorrente e guasto della lettura primaria. Sono prove sintetiche, non login Kinde, custodia KEK o sync live.
