# Registro dei servizi esterni — stato corrente TheLogBook

## CF-03 · durata access token Kinde vs callback monouso (17/11/2026, v2.501.0 candidata)

**Evidenza browser dopo v2.500.0:** `503 phase=access-token-lifetime`, che nasce da `exp-iat>86400` nella prova access JWT firmata e non da token scaduto. La durata esatta e l'impostazione live *Tokens* nel tenant Kinde non sono state lette: non concludere una TTL specifica. Kinde documenta access JWT predefinito 24h, configurabile, e sconsiglia un valore maggiore. [Fonte ufficiale](https://docs.kinde.com/build/tokens/configure-tokens/).

La patch proposta evita di applicare la policy **API credential** al token ottenuto e scartato durante il code exchange fidato una tantum. Mantiene RS256, audience/issuer/client, nonce, emailVerified, `exp` reale, ID token max1h, D1 session e revoca. **La policy API JWT max15min resta invariata.** Nessun cambiamento provider, Secret, quote, DNS o ambiente; il D1 sanitario rimane privato. Prima del rilascio completo, rileggere il token TTL sul tenant e verificare una durata conforme al rischio dei *veri* token API, senza modificare ora l'identità utente. Collaudo login reale e rimozione diagnostiche restano gate separati.


## CF-03 · readback Kinde e diagnostica access JWT (17/11/2026, candidato v2.500.0)

**Provider Cloudflare prima della modifica:** `thelogbook-cf03-kinde-http-isolated` distribuito al 100% con versione `d90cb9a8-c645-4349-8633-058b897551ca` e binding `APP_ORIGIN`, `DB`, `AUTH_GATE`, `AUTH_RATE_LIMITER`, più cinque Secret OAuth presenti come tipo `secret_text` (nessun valore letto). Il frontend espone esclusivamente `KINDE_HTTP` e static assets, mai `D1_API`. La callback reale dell'owner sulla v2.499.0 mostra `503 phase=access-token`, **non** una sessione confermata. Non sono autorizzati cambi di token, API audience, IAM, DNS, email o billing.

**Incompatibilità del codice dimostrata:** il verifier locale non distingueva le diverse cause del rifiuto JWT, e confrontava `gty` solo come stringa quando Kinde documenta anche array per i token M2M; la patch candidata rende il rifiuto esplicito senza modificare issuer/audience/JWKS o i cinque Secret. La successiva verifica provider deve essere fatta sul nuovo deployment, separatamente dalla CI e dal collaudo hosted. Il codice legacy Firebase/AuthContext/App Check/Firestore/Vercel rimane un perimetro di migrazione **distinto** dalla callback Kinde. Non riattivare hosting o backend sospesi e non sbloccare API sanitaria fino al GO.


## CF-08 — candidato binding runtime privato sul Worker sync (17/11/2026, PR #1191)

**GitHub, non ancora prova di deploy provider:** il candidato v2.497.0 collega soltanto `thelogbook-api-isolated` alla D1 indipendente CF-08 via binding `RECOVERY_DB`, lasciando il binding `DB` originale, AuthGate, Kinde e frontend invariati. Ogni `/v1/sync/*` richiede evidenza aggiornata da entrambe le D1 primarie, con verifica prima delle operazioni e delle risposte positive, comprese ricevute e replay. Il provider deve essere verificato *dopo* il merge: il controllo locale dei manifest e i test con SQLite sintetico non provano che Wrangler abbia distribuito il binding.

**Readback precedente al lavoro:** la seconda D1 EU `thelogbook-cf08-fence-eu-isolated-20261116` ha migrazioni 0001+0002, `mode=sealed`, generation 1 e 0 proprietari. Nessun soggetto reale può superare il gate. La protezione resta **PARZIALE / NO-GO** fino all'integrazione di registrazione/consenso, deny durevole prima della revoca, ADK/rights/erasure e collaudo. Nessun cambio Kinde, login pubblico, DNS, billing o dati applicativi in questo incremento.

## CF-08 — D1 di isolamento recupero creata, non attiva (16/11/2026)

**Cloudflare, letto direttamente sul provider:** oltre alla D1 applicativa di test `thelogbook-cf02-eu-isolated-20261113`, esiste la D1 `thelogbook-cf08-fence-eu-isolated-20261116` (`jurisdiction=eu`, read replication disabilitata), creata senza upgrade o billing. È un registro futuro di floor per negare il ripristino di consensi revocati dopo Time Travel della prima D1. **Stato ACTIVE-ISOLATED per la sola risorsa, NON ATTIVO per il runtime applicativo:** schema 0001 e ledger migrazioni applicati via Cloudflare REST e riletti; tabelle e cinque trigger presenti; controllo globale `sealed`, generazione 1, zero owner. La correzione additiva 0002 contro bypass `INSERT OR REPLACE` è presente come candidato software, **non ancora applicata** a questo provider: non abilitare il binding o l'accesso finché i due trigger aggiuntivi non saranno verificati. I due test negativi provider sono stati rifiutati, senza modifiche di stato. Nessun binding ai Worker né route pubblica o record utente. Questa prova non equivale a Wrangler migration/rollback, IAM separato o restore D1 collaudato. Il codice e la migrazione sono nel percorso `cloudflare/recovery/`; la copertura del sistema reale e il restore sicuro rimangono NO-GO. Non usare la D1 come copia del database principale né estendere retroattivamente la prova GDPR all'esecuzione Workers.



## CF-03 — gateway Kinde OAuth-only distribuito; login completo ancora NO-GO (16/11/2026)

**GitHub (fonte del codice):** `main` v2.484.0, SHA `dd93ad16fa47f795f1690a31cec4e20c146f29e6`, integra con squash la [PR #1175](https://github.com/gernotfound/logbook/pull/1175) con ingressi esclusivi `/api/auth/kinde/start`, `/api/auth/kinde/callback`, `/api/auth/session` e `/api/auth/logout`. [CI candidata exact-SHA](https://github.com/gernotfound/logbook/actions/runs/43873755312), [Main Release Gate/CodeQL](https://github.com/gernotfound/logbook/actions/runs/43879661972), [Firestore](https://github.com/gernotfound/logbook/actions/runs/43880098527), [Worker isolati](https://github.com/gernotfound/logbook/actions/runs/43879661927) e [deploy Static Assets + smoke HTTPS](https://github.com/gernotfound/logbook/actions/runs/43880148635) tutti SUCCESS sullo SHA pertinente. I test automatizzati non certificano il login reale Kinde.

**Cloudflare (readback diretto dopo deployment):** il frontend `thelogbook-frontend` espone soltanto `ASSETS`, `APP_ORIGIN` e il service binding `KINDE_HTTP` verso `thelogbook-cf03-kinde-http-isolated`, senza alcun binding pubblico all'API dati salute. Versione frontend `2b19b304-f82f-44e4-b751-5edd1831b661` al 100% (16/11/2026 13:54:51 UTC). Il Worker Kinde resta privato, con `DB` D1 sintetica, `AUTH_GATE` e limiter, senza URL workers.dev/preview o Custom Domain propri; sono presenti tutti e **cinque** i Secret OAuth di tipo `secret_text`: `KINDE_ISSUER`, `KINDE_CLIENT_ID`, `KINDE_CLIENT_SECRET`, `KINDE_API_AUDIENCE` e `KINDE_ID_TOKEN_AUDIENCE`. Versione Kinde `c2eb32a4-cbc7-478c-9ba9-5f556a17621f` 100% (16/11/2026 13:36:43 UTC). Nessun valore Secret è stato letto o trascritto.

**Kinde (lettura in sola lettura della scheda Details nel browser collegato):** application Back-end web `TheLogBook`; `Allowed callback URLs` contiene esattamente `https://thelogbook.me/api/auth/kinde/callback`, `Application homepage URI` è `https://thelogbook.me/`; `Application login URI` e `Allowed logout redirect URLs` sono vuoti. Il logout implementato revoca la sessione D1 dell'app, **non** la sessione SSO Kinde. La schermata owner ha mostrato l'API `TheLogBook API` con audience `https://thelogbook.me/api` autorizzata per l'app e workflow password minimo 15 code point `Live`; mancano test di iscrizione/reset, claim reali `aud`/`iss`/`azp`, email verificata, Google e prova operativa di callback.

**Perimetro:** OAuth-only pubblico per collaudo controllato; `AuthContext` React ancora Firebase, nessuna API sanitaria o sincronizzazione D1 esposta, nessun consenso/ADK/erasure sbloccato. **CF-03 rimane PARZIALE / NO-GO funzionale**. Non confondere il deploy e gli smoke fail-closed con la prova di autenticazione o il GO dell'applicazione.

---

## Worker Kinde HTTP PRIVATO — distribuito e attestato 16/11/2026

**GitHub:** `main` v2.479.0 `44c294bf69261c31e37c2cdb3f78432941ae6aba`, [PR #1173](https://github.com/gernotfound/logbook/pull/1173); CI candidata [#43830350700](https://github.com/gernotfound/logbook/actions/runs/43830350700) SUCCESS, Main Release Gate/CodeQL [#43830734390](https://github.com/gernotfound/logbook/actions/runs/43830734390) SUCCESS, [workflow privato #43830734570](https://github.com/gernotfound/logbook/actions/runs/43830734570) SUCCESS. SHA esatti non intercambiabili.

**Cloudflare (readback STORICO della prima pubblicazione, non stato attuale dei secret):** Worker `thelogbook-cf03-kinde-http-isolated` **ACTIVE-ISOLATED** (deploy 16/11/2026 08:25:57 UTC; version ID `593d695d-b9f3-44b3-bf4b-422074ff1e01`, 100%). Esattamente quattro binding: `DB` alla D1 sintetica EU `9aa51833-8adc-495f-bdfc-93b5542e8023`, `AUTH_GATE` a `thelogbook-cf03-auth-gate-isolated`, `AUTH_RATE_LIMITER` namespace `31004`, `APP_ORIGIN=https://thelogbook.me`. `workers.dev` e preview disabilitati; **zero Worker Routes o Custom Domains** assegnati nella zona `thelogbook.me`; **nessun Kinde secret**. Nessun dato D1 scritto né modifica a OAuth, DNS, IAM, posta, billing, frontend, API o Auth Gate.

**Stato:** Worker privato **COMPLETATO**, ma Kinde provider/hosted login **VERIFY-LIVE / NO-GO**, `AuthContext` ancora Firebase, niente ingresso pubblico Auth/D1; mancano policy password >=15 anche nel reset, callback/Google/email, segreti server-side, consenso/ADK e client/Sync/diritti con test reali. Il deploy Worker non costituisce GO applicativo.

**Classificazione: CRITICAL.** Questo registro contiene **soltanto servizi necessari, ancora presenti nel codice oppure da validare prima del GO**. La storia delle configurazioni superate rimane nella cronologia Git e nelle PR. GitHub prova SHA e verifiche; i provider provano le rispettive risorse e il runtime. Un riscontro datato non autorizza cambi Production.


## Ricognizione provider — 16/11/2026 (baseline v2.474.0)

**Fonte GitHub:** `main` `519f80c077b8ca40e8f3630ea4f110ffb342e012`, v2.474.0; PR #1168 solo documentazione/versione. Workflow `Milestone Verification` [#43771473060](https://github.com/gernotfound/logbook/actions/runs/43771473060), Firestore [#43771679958](https://github.com/gernotfound/logbook/actions/runs/43771679958), Static Assets [#43771707785](https://github.com/gernotfound/logbook/actions/runs/43771707785) con conclusione `success` sullo stesso SHA. La CI non prova i flussi Auth/Sync/erasure.

**Fonte Cloudflare:** Worker `thelogbook-frontend` con unico binding `ASSETS`; Worker privati `thelogbook-api-isolated` (`DB`, `AUTH_GATE`) e `thelogbook-cf03-auth-gate-isolated` (`DB`, rate limiter). `workers.dev` e preview disabilitati sui tre script; D1 sintetica `thelogbook-cf02-eu-isolated-20261113` ancora `jurisdiction=eu`. Lo script `thelogbook-cf03-kinde-http-isolated` **non figura nell'elenco dei Worker attivi**. Nessun readback di schema/ledger, dati sanitari, secret o configurazione Kinde in questa sessione, e nessuna mutazione Cloudflare.

**Stato servizi:** frontend `ACTIVE` soltanto per Static Assets; API e Auth Gate `ACTIVE-ISOLATED`, non equivalenti a endpoint applicativi pubblici; HTTP Kinde `CANDIDATE` non distribuito; Kinde `VERIFY-LIVE`; percorso Firebase nel browser `LEGACY-ACTIVE`; GO Auth/D1 e rilascio completo `NO-GO`. Non inferire localizzazione dell'intero trattamento da `jurisdiction=eu`.

## Checkpoint storico dei servizi — v2.473.0, 15/11/2026

**GitHub main:** `2702a5898004451028201d872112e58a5a800ab0` (v2.473.0). La baseline v2.464.0 descritta sotto è storica. Le [PR #1166](https://github.com/gernotfound/logbook/pull/1166) e [#1167](https://github.com/gernotfound/logbook/pull/1167) hanno introdotto soltanto chiamanti **candidati** browser per sessione Kinde → consenso → ADK → journal D1 e prima accettazione sanitaria D1. Non sono montati su `AuthContext`, né sono state attivate route o credenziali provider. CI PR [#43769436716](https://github.com/gernotfound/logbook/actions/runs/43769436716) e [#43770249310](https://github.com/gernotfound/logbook/actions/runs/43770249310) SUCCESS.

**Gate v2.473.0:** [Main/CodeQL #43770520566](https://github.com/gernotfound/logbook/actions/runs/43770520566), [Firestore #43770738175](https://github.com/gernotfound/logbook/actions/runs/43770738175) e [Static Assets + smoke HTTPS #43770785236](https://github.com/gernotfound/logbook/actions/runs/43770785236) SUCCESS sullo SHA esatto. Rilettura provider Cloudflare: `thelogbook-frontend` **ACTIVE** e solo binding `ASSETS`; `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` **ACTIVE ma privati**; `thelogbook-cf03-kinde-http-isolated` **NON distribuito**; database `thelogbook-cf02-eu-isolated-20261113` con giurisdizione `eu`. La presenza del database non prova l'intera residenza dei dati o GDPR.

**Mappa stati:** Kinde **VERIFY-LIVE**, nessun login/Google/password/reset live validato e workflow ≥15 non sincronizzato né collaudato; Firebase Auth/Firestore/App Check **LEGACY ma ancora chiamati dal browser**; Vercel backend **sospeso secondo evidenze precedenti**, con codice residuale e nessuna riattivazione autorizzata. Nessuna KEK o segreto Cloudflare attivo verificato in questo passaggio; nessun cambiamento al tenant Kinde, OAuth Google, DNS, servizi di posta o billing. API sanitaria pubblica e cutover restano **NO-GO**. Il [runbook](cloudflare-workers-migration.md) documenta i blocchi verificabili prima del GO.

## Checkpoint storico — 15/11/2026 (baseline v2.464.0)

**Baseline verificata prima di questo aggiornamento documentale:** `547915c1d98c9566d0951ccc04aeb2b7a32e69f6`, **v2.464.0**. L'HEAD effettivo e il suo SHA si leggono su GitHub. Sono integrati gli incrementi CRITICAL [#1153](https://github.com/gernotfound/logbook/pull/1153), [#1154](https://github.com/gernotfound/logbook/pull/1154), [#1152](https://github.com/gernotfound/logbook/pull/1152), [#1141](https://github.com/gernotfound/logbook/pull/1141), [#1155](https://github.com/gernotfound/logbook/pull/1155) e [#1143](https://github.com/gernotfound/logbook/pull/1143). Anche [#1157](https://github.com/gernotfound/logbook/pull/1157) e [#1158](https://github.com/gernotfound/logbook/pull/1158) sono integrate; Vite #1144 è chiusa senza merge perché assorbita. I loro controlli non dimostrano il GO applicativo.

**Verifiche separate sullo SHA v2.464.0:** [Main Release Gate / CodeQL 43757321851](https://github.com/gernotfound/logbook/actions/runs/43757321851), [D1/API/Auth Gate privati e compilazione Wrangler dry-run Kinde 43757321827](https://github.com/gernotfound/logbook/actions/runs/43757321827), [Firestore 43757550476](https://github.com/gernotfound/logbook/actions/runs/43757550476) e [Cloudflare Static Assets/smoke 43757573970](https://github.com/gernotfound/logbook/actions/runs/43757573970) **SUCCESS**. La compilazione di un candidato non costituisce deployment né test OAuth.

**Readback diretto Cloudflare (15/11/2026):** `thelogbook-frontend` presenta soltanto il binding `ASSETS`, al 100% e con `workers.dev`/preview disabilitati. `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` sono privati, hanno D1 EU isolata con read replication disabilitata, service binding Auth Gate e limiter dedicato. Il Worker `thelogbook-cf03-kinde-http-isolated` **non risulta distribuito** (HTTP 404 nel readback); nessuna KEK è presente nei binding osservati. OAuth Kinde, email/password/Google reali e il frontend Kinde non sono funzionanti; l'AuthContext pubblico usa ancora Firebase.

**Stati:** frontend Cloudflare Static Assets **ACTIVE**; due Worker D1/AuthGate **ACTIVE privati**; codice del Worker Kinde HTTP **CANDIDATO non distribuito**. Firebase Auth/Firestore/App Check e il proxy `/__/auth/` rimangono **LEGACY attualmente chiamati dal browser**; la scelta architetturale non li rende dismessi. Kinde è **VERIFY-LIVE**: redirect del tenant, policy password minima 15 caratteri, verifica/reset email, Google, quota e client secret server-side vanno riletti nell'applicazione Back-end web senza esporre credenziali. È vietato interpretare la D1 EU come garanzia sulla localizzazione degli altri servizi. Nessuna variazione DNS/OAuth Production, secret, billing o cancellazione dati in questo checkpoint.

**Preflight v2.464.0:** `cloudflare/auth/wrangler.kinde.isolated.jsonc` è solo una configurazione senza credenziali e senza route pubbliche. Il workflow ne ha verificato isolamento, test negativi e compilazione `--dry-run`, ma non ha creato un terzo Worker Kinde. La sequenza necessaria prima del GO è nel [runbook](cloudflare-workers-migration.md) e nella [guida Kinde](kinde-auth-setup.md).

**Gate password Kinde da verificare prima del GO:** Kinde per default richiede 8 caratteri, TheLogBook 15; servono workflow `user:new_password_provided` e collaudi di registrazione/reset sul provider. [Guida Kinde](kinde-auth-setup.md) · [docs ufficiali](https://docs.kinde.com/authenticate/authentication-methods/password-authentication/). Nessuna modifica al tenant né alla password policy effettuata.

## D1 EU isolata — schema remoto 10/10 verificato (15/11/2026)

**Readback ripetuto il 15/11, dopo gli incrementi di manutenzione:**
UUID invariato, `jurisdiction=eu`, primaria EEUR, read replication
disabilitata e ledger `0001`–`0010`. Conteggi: zero principal, sessioni,
ADK e job erasure; un documento e una receipt sintetici conservati.
Le sole SELECT hanno scritto zero righe. Non ripetere il provisioning
del token o le migrazioni sulla base dei checkpoint storici sotto.

**COMPLETATO limitatamente allo schema D1 isolato.** Il
[workflow manuale #43702489692](https://github.com/gernotfound/logbook/actions/runs/43702489692) è terminato
**SUCCESS** sullo SHA `5ca7afaca94e4431e298595eecdd2a023546fd21`
di `main` (v2.446.0). Wrangler ha applicato `0009` e
`0010`. La lettura diretta successiva di Cloudflare conferma
il ledger **`0001`–`0010`**, `jurisdiction=eu`, repliche
disabilitate, Time Travel bookmark disponibile, view
`sync_writable_cloud_key`, tabella
`health_erasure_finalizations`, relativi trigger e colonne
erasure. Zero account/sessioni/ADK/job erasure reali;
**un documento e una ricevuta sintetici preservati**.
Nessun dato Firebase trasferito.

Il token GitHub `CLOUDFLARE_D1_API_TOKEN` ha funzionato
nel workflow: disponibilità e permessi sufficienti verificati
per questa esecuzione, **non** policy IAM esatta, scadenza
o eventuale revoca. Non sono stati eseguiti restore, prove
end-to-end Auth/Sync/consenso/cifratura/erasure, né verifiche
prestazionali o di quote. **NO-GO full-stack**; Worker API
e Auth Gate non sono resi pubblici dalla migration.

## Checkpoint storico credenziali prima dell'esecuzione — 15/11/2026

**Stato dichiarato dal proprietario (non attestato mediante lettura IAM):**
creato un API token Cloudflare distinto da quello Worker e salvato nel repository
GitHub Actions con il nome **`CLOUDFLARE_D1_API_TOKEN`**. Nessun valore del
secret è stato ricevuto né salvato nel codice. Scope D1 Edit, durata, account
autorizzato, accessibilità del secret al workflow e valore della variabile
`CLOUDFLARE_ACCOUNT_ID` devono ancora essere convalidati al gate manuale.

**Stato D1 verificato separatamente:** provider EU isolato
`thelogbook-cf02-eu-isolated-20261113`, ledger ancora a
**`0008/0010`**, repliche disabilitate. Non risulta ancora un
`workflow_dispatch` per la migrazione remota; nessuna modifica SQL è stata
eseguita in questo aggiornamento. Il prossimo intervento è il dispatch
main-only della procedura Wrangler già versionata, con controllo successivo
diretto di schema e ledger. Il registro non dà GO ad Auth, Sync, consenso,
cifratura o erasure. Dettagli nel
[runbook operativo](cloudflare-workers-migration.md).

## Verifica D1 storica precedente a token e migrazione — 15/11/2026

Sul `main 53f8a5562d9952c3f70c0175ee212f88e7f92d6b` (v2.445.0)
la lettura diretta Cloudflare della D1 EU isolata, UUID fissato dal
`wrangler.isolated.jsonc`, ha restituito otto migrazioni su dieci e
nessuno degli oggetti nuovi di `0009`/`0010`. Time Travel è disponibile,
read replicas sono disattivate; nessun principal, sessione, ADK o job reale,
ma un documento e una ricevuta sintetici esistono. Non è stato eseguito
un workflow D1 manuale su GitHub.

**Stato: VERIFY-LIVE / BLOCCATO sull'esecuzione delle due migration remote.**
Le credenziali GitHub `CLOUDFLARE_D1_API_TOKEN` sono di disponibilità
non verificabile dal connettore; il workflow ha comunque bisogno del
permesso minimo **D1 Edit** su un token diverso da quello Workers e di
avvio manuale `workflow_dispatch` su `main`. Nessun SQL eseguito via
connettore Cloudflare per bypassare backup, preflight o audit del workflow.
I passaggi operativi e i criteri di accettazione sono riportati nel
[runbook Cloudflare](cloudflare-workers-migration.md). Nessun nuovo
permesso provider, costo, deploy pubblico o GO Auth/Sync è stato attivato.

## Checkpoint B-03 storico precedente alla migrazione D1 — 15/11/2026

La [PR #1135](https://github.com/gernotfound/logbook/pull/1135) è stata
squash-merged in `main ed31c42af38e065dd448308e6c7d546ae80978e6` (v2.444.0). CI PR [#43662166211](https://github.com/gernotfound/logbook/actions/runs/43662166211), [Main Release Gate/CodeQL #43696757160](https://github.com/gernotfound/logbook/actions/runs/43696757160), [Worker API e Auth Gate privati #43696757245](https://github.com/gernotfound/logbook/actions/runs/43696757245), [Firestore #43696941939](https://github.com/gernotfound/logbook/actions/runs/43696941939) e [Cloudflare Static Assets/smoke #43696964223](https://github.com/gernotfound/logbook/actions/runs/43696964223) tutti **SUCCESS** sull'esatto SHA. Firestore non ha effettuato scritture: Rules e indici erano già convergenti.

La D1 sintetica EU resta al ledger remoto `0001`–`0008` (otto su dieci),
verificato direttamente dopo il merge: non sono presenti identità, sessioni,
chiavi cloud o job reali. Il workflow di migrazione D1 isolata è disponibile
soltanto per dispatch manuale dopo preflight/CI, ma non eseguito; richiede
`CLOUDFLARE_D1_API_TOKEN` separato in GitHub Secrets. Non è stato autorizzato
il GO funzionale dei Worker, della sincronizzazione o di OAuth/posta Production.

## Verifica provider Cloudflare storica pre-migrazione — 15/11/2026

Readback diretto del provider: la D1 isolata ha giurisdizione `eu`,
repliche disabilitate e Time Travel bookmark disponibile, ma il ledger
attesta solo `0001`–`0008` su dieci migration SQL in `main`.
Sono presenti soltanto fixture sintetiche (un record documento e una
ricevuta); non risultano principal Kinde, sessioni, ADK cloud o job
erasure. API e Auth Gate Workers sono privati, entrambi legati a questa
D1, senza workers.dev né preview, e non sono pubblicati agli utenti.
Il frontend su `thelogbook.me` rimane un percorso distinto.

Il workflow main-only integrato in PR #1135 attende l'attivazione manuale per l'applicazione delle
migrazioni `0009`/`0010` con Wrangler ufficiale, backup, allowlist
SQL, preflight dell'identità e post-readback del ledger. **Non è stato
ancora eseguito**. È necessario un secret GitHub separato
`CLOUDFLARE_D1_API_TOKEN` con permesso D1 write minimo, senza
ampliare il token Workers già esistente. Nessuna modifica a DNS, OAuth,
Cloudflare pubblica o dati Production; nessun GO Auth/Sync/erasure/restore.
Conservare il checkpoint storico del 14/11 come tale.

## Checkpoint GitHub storico precedente al merge B-03 — 15/11/2026

`main f10dd7089a4633096869faf88482250fe26b8edc` (v2.442.0): nove PR #1125–#1133 squash-merged, zero PR aperte al checkpoint; [Main Release Gate/CodeQL #43658661516](https://github.com/gernotfound/logbook/actions/runs/43658661516), [Firestore #43658877933](https://github.com/gernotfound/logbook/actions/runs/43658877933) e [Cloudflare Static Assets #43658905338](https://github.com/gernotfound/logbook/actions/runs/43658905338) sono SUCCESS sull'esatto SHA. Firestore non ha richiesto modifiche a Rules o indici; il frontend ha superato lo smoke. Le attestazioni provider D1/Workers sotto sono del **14/11**, non nuove letture: `0009/0010` integrate su GitHub **non equivalgono a migrations applicate** sulla D1 remota.

## Target Cloudflare / Kinde

| Servizio | Stato osservato / perimetro | Gate prima del GO |
|---|---|---|
| **Kinde Identity** | Business `thelogbook.kinde.com`, regione `Europe - Ireland` selezionata nell'onboarding; applicazione `TheLogBook` Back-end web creata, Email Password e Google ON, Email Code OFF (ulteriore screenshot diretto `TheLogBook → Authentication` del 14/11/2026); Phone Code e Username Code/Password OFF. Si tratta di stati UI, non di una prova di login reale o del salvataggio letto da API. Il proprietario conferma cancellazione della app predefinita, rotazione secret Kinde, Google social connection associata a una sola applicazione, `Email address trust = Verify, then trust`, inserimento delle credenziali Google OAuth dedicate nel pannello Kinde; nessun secret memorizzato nel repository. Google Cloud: progetto dedicato `thelogbook-oauth`, client web `TheLogBook - Kinde` creato secondo conferma. **Google Search Console (14/11):** proprietà Dominio `thelogbook.me` verificata tramite TXT DNS aggiunto dopo autorizzazione una tantum Google↔Cloudflare; conservarlo. **Google Auth Platform → Branding (14/11):** screenshot successivo conferma **«Il tuo branding è stato verificato e viene mostrato agli utenti»**, con logo ufficiale PWA, homepage `https://thelogbook.me/about` e Privacy `https://thelogbook.me/privacy` visibili. Evidenza da screenshot, nessun read-back API o login testato. Il proprietario **ha inoltre confermato di aver salvato `Application homepage URI` Kinde = `https://thelogbook.me/`** (nessun read-back indipendente). `Application login URI` e le liste callback/logout Kinde risultavano vuote nella schermata precedente, senza successivi aggiornamenti dichiarati. **Google OAuth pubblicato 14/11:** screenshot Google Auth Platform `thelogbook-oauth` conferma `In produzione`, audience `Esterno` e `Torna al test` dopo la conferma del proprietario. Le pagine `/about` e `/privacy` sono state distribuite e verificate da Cloudflare run #43616173486. Il **Branding risulta approvato secondo le schermate successive**, ma questo **non prova un login reale via Kinde**. [Guida Kinde](kinde-auth-setup.md), [pagine pubbliche e logo #1013](https://github.com/gernotfound/logbook/issues/1013). | Verificare URL pubblici reali, Privacy accurata e aggiornata che descriva l'uso dei dati Google e link dalla homepage; nessun placeholder fittizio per superare Google. Proprietario richiede pubblicazione OAuth diretta dopo i prerequisiti; non è GO della PWA. Read-back callback/credenziali e scope Google senza mostrare secret, policy password ≥15 anche nel reset, OIDC/PKCE, sessioni, email, token, revoca, erasure, antiabuso, MFA, privacy/DPA/retention, quote Free e Safari iOS ancora da collaudare. Nessun dato salute in Kinde. |
| **Cloudflare Workers Static Assets** | Provider riletto 15/11: `thelogbook-frontend` su `thelogbook.me`, solo binding ASSETS, `workers.dev`/preview e preview del Custom Domain disabilitati. Release e smoke exact-SHA sono tracciati nelle PR #1146/#1148/#1149. Lo smoke byte-exact verifica anche l'assenza di script iniettati; le impostazioni Web Analytics sono una prova provider separata, non rilette in questo checkpoint. | Browser/guest, aggiornamento PWA e Safari fisico, rollback; lo statico non prova Auth/D1. |
| **Cloudflare Web Analytics / RUM** | Il 14/11 il provider aveva automatic setup attivo e iniettava script nel documento, contrariamente al requisito no telemetry. Corretto senza eliminazioni: **`auto_install=false`, ruleset `enabled=false`, zona `rum=manual`** (valore restituito dopo disattivazione auto-install); nessun snippet nel build. Resta esistente la risorsa Analytics storica. | Monitorare configurazione provider e risposta byte-exact su `thelogbook.me`; non riattivare tracking né cancellare dati storici senza autorizzazione separata. |
| **Cloudflare Workers API** | Provider riletto 15/11: `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` privati, stessa D1 EU, `AUTH_GATE` e limiter; `workers.dev`/preview disabilitati e nessun binding secret KEK. I contratti Auth/consenso/erasure nel codice main non sono stati eseguiti contro Kinde reale. | Worker HTTP Kinde e frontend ancora da collegare, test Kinde/CSRF/session rights-only, ADK, quote/abuso e recovery prima di API pubbliche. |
| **Cloudflare D1** | Sandbox `thelogbook-cf02-eu-isolated-20261113` EU, repliche off: **`0001`–`0010` applicate e verificate**, [workflow #43702489692](https://github.com/gernotfound/logbook/actions/runs/43702489692) SUCCESS + readback Cloudflare indipendente su ledger, view, tabella, trigger e colonne; fixture sintetiche conservate, zero account/chiavi/job reali. Nessun cron erasure attivo. | Test restore, quote/CPU, custodia KEK, Auth/consenso/sync/erasure end-to-end e anti-resurrection. D1 EU non localizza Workers, OAuth o log. |
| **Cloudflare DNS / IONOS** | Zona attiva; il web apicale è instradato al Worker tramite DNS proxied originless; MX, DKIM, DMARC e altri record email IONOS rimasti invariati alla verifica provider del 14/11/2026. | Certificato assegnato e route attiva non sostituiscono smoke HTTPS e test browser sulla versione rilasciata; OAuth/posta Production e backend rimangono esclusi da questa autorizzazione. |

## Dipendenze del codice legacy da sostituire

| Servizio | Stato verificato / limite | Prossima azione tecnica |
|---|---|---|
| **Firebase Authentication / Firestore / App Check** | Import e chiamanti frontend/Rules sono ancora nel repository; l'Hosting Firebase storico è disabilitato secondo attestazione del proprietario. L'assenza di account/dati da migrare non dimostra equivalenza del nuovo runtime. | Portare login, autorizzazione, consenso, sync, cifratura, logout, diritti ed erasure e rimuovere codice/config/test obsoleti **solo dopo prove equivalenti**; non riattivare Hosting. |
| **Vercel Functions/Cron + Firebase Admin** | Il progetto `logbook` risultava sospeso dall'ultima lettura del provider. `vercel.json.git.deploymentEnabled=false` per ogni branch; Functions/Cron e test di supporto sono ancora presenti nel repository. | Convertire ogni endpoint e cron con limiti CPU Workers Free, poi rimuovere chiamanti, credenziali e provider con inventario/mandato specifico. Nessun deploy Vercel per inerzia. |

## Sistemi tecnici e privacy

- **GitHub:** repository, PR, `Canonical Verification`, CodeQL, gate post-merge e review. CI verde non certifica provider o runtime.
- **Google OAuth — pagine pubbliche verificate:** su `main 23987f2dde6059e1d5357b79ba137f9effb1924a` sono state integrate le pagine `https://thelogbook.me/about` (homepage informativa) e `https://thelogbook.me/privacy` (informativa pubblica iniziale), con CSS locale e senza avvio Auth o storage. Cloudflare Workers Static Assets workflow [#43616173486](https://github.com/gernotfound/logbook/actions/runs/43616173486) **SUCCESS** e smoke HTTPS HTTP 200/MIME/byte-exact dei documenti; il login `/` resta invariato. Google OAuth `thelogbook-oauth` è pubblicato (Audience Esterno / In produzione) e il **Branding è verificato e visibile** secondo screenshot successivi del proprietario; né queste schermate né il deploy provano il flusso account completo. Le pagine pubbliche vanno riconciliate con i testi legali in-app e con i trattamenti Kinde/Cloudflare effettivi prima di GO Auth/GDPR; issue [#1013](https://github.com/gernotfound/logbook/issues/1013), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).
- **Ricerca e indicizzazione:** proprietà Dominio `thelogbook.me` **verificata su Search Console il 14/11/2026** (screenshot Google; TXT DNS aggiunto tramite integrazione Cloudflare, da conservare). URL canonico, `robots.txt`, `sitemap.xml` e indicizzazione dopo cutover vanno verificati separatamente; Search Console non è il backend fitness.
- **Analytics ed error monitoring:** nessun SDK esterno né auto-iniezione Cloudflare RUM sul client; il provider Web Analytics è attualmente inattivo per questo dominio (riletto 14/11). I dati storici di Analytics non sono stati censiti/eliminati. Log tecnici provider da valutare per minimizzazione e retention.
- **Fornitori email dismessi:** nessuna dipendenza operativa nel target. Gli account sono stati dichiarati chiusi dal proprietario e i record DNS dedicati sono stati eliminati e verificati su Cloudflare; l'eventuale retention delle vecchie console non è stata controllata indipendentemente. Nessuna riattivazione o attività di collaudo del vecchio percorso.

## Verifiche e confini

**Decisione 14/11/2026:** `thelogbook.me` è autorizzato come unico dominio di sviluppo pubblico del frontend, con `workers.dev` e preview disabilitati. Questa eccezione esplicita riguarda solo il web/DNS, **non** il GO funzionale. Il rilascio completo richiede conferme distinte per **Auth/email/Google, consenso sanitario, owner isolation, cifratura e chiavi, sync/ACK e offline, import/export, cancellazione e inattività, quote/rate, privacy, backup, PWA iOS, CI e rollback**. Niente spese, upgrade, dati Production, OAuth/posta Production o eliminazioni irreversibili senza autorizzazione appropriata.

**Fonti:** [runbook Cloudflare](cloudflare-workers-migration.md), [AGENTS](../../AGENTS.md), [servizi esterni](../../.agents/rules/external-services.md), [CI](../../.agents/rules/ci-verification.md), [epic #1053](https://github.com/gernotfound/logbook/issues/1053), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063), [hosting #1041](https://github.com/gernotfound/logbook/issues/1041).

### CF-02 — checkpoint D1 e API private, 14/11/2026

Cloudflare readback su D1 sandbox conferma `eu`, primaria `EEUR`,
repliche lettura disabilitate e tutte le otto migrazioni applicate.
Nessun principal, sessione o OAuth attempt reale; vecchie fixture cifrate
preservate. Time Travel bookmark acquisito, restore non eseguito,
`PRAGMA integrity_check` non autorizzato nell'API REST. Al checkpoint iniziale, prima del deploy privato della PR #1117, il
provider registrava soltanto `thelogbook-frontend` (binding `ASSETS`).
La successiva verifica provider del 14/11 ha confermato anche i due
Worker API/Auth Gate privati, senza alcuna route pubblica. Non dichiarare
completato login, sessioni, consenso o sincronizzazione.

### CF-02 — verifica provider Workers API e permessi minimi (14/11/2026)

[#1117](https://github.com/gernotfound/logbook/pull/1117) merged,
`main f3fc9b138e62bfc1fc6beb22ce6f2c7ba5d4e2f0`; post-merge
CI e CodeQL main passati. Run di deploy privato
[#43638837192](https://github.com/gernotfound/logbook/actions/runs/43638837192):
due upload Worker riusciti, nessun target pubblico, ma step finale D1
REST **401** dal token GitHub Workers (run complessivamente rossa).
Provider readback Cloudflare separato conferma tre Worker totali:
frontend con solo ASSETS; i due servizi privati con binding alla D1
EU corretta, gate privato, limiter e URL di preview disabilitati.
Nessuna operazione su DNS/dati live/KEK o attivazione OAuth.
Correzione CI: verificare con lo stesso token meno privilegiato solo
le settings dei Worker; ledger D1 e `eu` restano attestazioni
Cloudflare indipendenti. Ciò non prova l'esecuzione delle API.

## Ritiro incrementale dei collegamenti di rete Firebase (18/11/2026)

Il frontend Cloudflare smette di inoltrare /__/auth/* a Firebase Hosting:
il proxy pubblico mantiene solo le quattro route Auth/session Kinde, senza
D1 fitness esposta e senza fallback esterno. Questo **non dismette il
progetto Firebase o i suoi dati/provider**; tali operazioni sono irreversibili
e richiedono inventario live e autorizzazione separata. AuthProvider,
Firestore, App Check e backend Vercel legacy restano nel codice; la loro
sostituzione è ancora parte delle issue CF-03/04/05/06/09. I workflow
Firestore non vanno disabilitati finché i dati e le responsabilità live non
sono stati verificati. Non utilizzare questo incremento come prova del GO
funzionale o della revoca delle autorizzazioni del provider.

## CF-08 recovery schema — verifiche provider 18/11/2026 (VERIFY-LIVE)

D1 recovery EU: migrations 0001-0002, stato sealed, generation 1, owner 0,
Time Travel bookmark presente. D1 applicativa EU: migrations 0001-0010,
2 identities e 24 sessions, ma zero chiavi dati cloud e zero erasure jobs.
Questi record non autorizzano un reset ne' una riqualificazione come
sintetici senza inventario. Il workflow operativo recovery D1 manual-only
prepara la verifica e migrazione 0003-0004 in via indipendente e chiusa;
non attiva automaticamente trattamenti dati o nuovi endpoint.
