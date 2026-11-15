# Registro dei servizi esterni — stato corrente TheLogBook

**Classificazione: CRITICAL.** Questo registro contiene **soltanto servizi necessari, ancora presenti nel codice oppure da validare prima del GO**. La storia delle configurazioni superate rimane nella cronologia Git e nelle PR. GitHub prova SHA e verifiche; i provider provano le rispettive risorse e il runtime. Un riscontro datato non autorizza cambi Production.

## Checkpoint GitHub — 15/11/2026

`main f10dd7089a4633096869faf88482250fe26b8edc` (v2.442.0): nove PR #1125–#1133 squash-merged, zero PR aperte al checkpoint; [Main Release Gate/CodeQL #43658661516](https://github.com/gernotfound/logbook/actions/runs/43658661516), [Firestore #43658877933](https://github.com/gernotfound/logbook/actions/runs/43658877933) e [Cloudflare Static Assets #43658905338](https://github.com/gernotfound/logbook/actions/runs/43658905338) sono SUCCESS sull'esatto SHA. Firestore non ha richiesto modifiche a Rules o indici; il frontend ha superato lo smoke. Le attestazioni provider D1/Workers sotto sono del **14/11**, non nuove letture: `0009/0010` integrate su GitHub **non equivalgono a migrations applicate** sulla D1 remota.

## Target Cloudflare / Kinde

| Servizio | Stato osservato / perimetro | Gate prima del GO |
|---|---|---|
| **Kinde Identity** | Business `thelogbook.kinde.com`, regione `Europe - Ireland` selezionata nell'onboarding; applicazione `TheLogBook` Back-end web creata, Email Password e Google ON, Email Code OFF (ulteriore screenshot diretto `TheLogBook → Authentication` del 14/11/2026); Phone Code e Username Code/Password OFF. Si tratta di stati UI, non di una prova di login reale o del salvataggio letto da API. Il proprietario conferma cancellazione della app predefinita, rotazione secret Kinde, Google social connection associata a una sola applicazione, `Email address trust = Verify, then trust`, inserimento delle credenziali Google OAuth dedicate nel pannello Kinde; nessun secret memorizzato nel repository. Google Cloud: progetto dedicato `thelogbook-oauth`, client web `TheLogBook - Kinde` creato secondo conferma. **Google Search Console (14/11):** proprietà Dominio `thelogbook.me` verificata tramite TXT DNS aggiunto dopo autorizzazione una tantum Google↔Cloudflare; conservarlo. **Google Auth Platform → Branding (14/11):** screenshot successivo conferma **«Il tuo branding è stato verificato e viene mostrato agli utenti»**, con logo ufficiale PWA, homepage `https://thelogbook.me/about` e Privacy `https://thelogbook.me/privacy` visibili. Evidenza da screenshot, nessun read-back API o login testato. Il proprietario **ha inoltre confermato di aver salvato `Application homepage URI` Kinde = `https://thelogbook.me/`** (nessun read-back indipendente). `Application login URI` e le liste callback/logout Kinde risultavano vuote nella schermata precedente, senza successivi aggiornamenti dichiarati. **Google OAuth pubblicato 14/11:** screenshot Google Auth Platform `thelogbook-oauth` conferma `In produzione`, audience `Esterno` e `Torna al test` dopo la conferma del proprietario. Le pagine `/about` e `/privacy` sono state distribuite e verificate da Cloudflare run #43616173486. Il **Branding risulta approvato secondo le schermate successive**, ma questo **non prova un login reale via Kinde**. [Guida Kinde](kinde-auth-setup.md), [pagine pubbliche e logo #1013](https://github.com/gernotfound/logbook/issues/1013). | Verificare URL pubblici reali, Privacy accurata e aggiornata che descriva l'uso dei dati Google e link dalla homepage; nessun placeholder fittizio per superare Google. Proprietario richiede pubblicazione OAuth diretta dopo i prerequisiti; non è GO della PWA. Read-back callback/credenziali e scope Google senza mostrare secret, policy password ≥15 anche nel reset, OIDC/PKCE, sessioni, email, token, revoca, erasure, antiabuso, MFA, privacy/DPA/retention, quote Free e Safari iOS ancora da collaudare. Nessun dato salute in Kinde. |
| **Cloudflare Workers Static Assets** | Ultimo provider readback 14/11: `thelogbook-frontend` su `thelogbook.me`, certificato TLS, solo binding ASSETS, `workers.dev`/preview disabilitati. [Workflow #43658905338](https://github.com/gernotfound/logbook/actions/runs/43658905338): build/deploy/smoke stesso `main f10dd7089` v2.442.0 **SUCCESS** al primo tentativo. Web Analytics non ha iniettato script nello smoke; impostazioni provider non rilette ora. | Browser/guest, aggiornamento PWA e Safari fisico, rollback; lo statico non prova Auth/D1. |
| **Cloudflare Web Analytics / RUM** | Il 14/11 il provider aveva automatic setup attivo e iniettava script nel documento, contrariamente al requisito no telemetry. Corretto senza eliminazioni: **`auto_install=false`, ruleset `enabled=false`, zona `rum=manual`** (valore restituito dopo disattivazione auto-install); nessun snippet nel build. Resta esistente la risorsa Analytics storica. | Monitorare configurazione provider e risposta byte-exact su `thelogbook.me`; non riattivare tracking né cancellare dati storici senza autorizzazione separata. |
| **Cloudflare Workers API** | Ultima lettura provider 14/11: `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` privati, binding D1 EU/`AUTH_GATE`, limiter e nessuna route pubblica. I nuovi contratti Auth/consenso/erasure sono nel codice main ma non eseguiti contro Kinde reale. | Nuova verifica provider, test HTTP Kinde/CSRF/session rights-only, ADK, quote/abuso e recovery prima di API pubbliche. |
| **Cloudflare D1** | Sandbox `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`, read replication off; ultimo readback provider 14/11 con `0001`–`0008`. SQL `0009/0010` versionato e testato su SQLite, **applicazione D1 remota non attestata**. Nessun erasure cron attivato. | Verificare ledger/schema D1 reale isolato, restore, quote, KEK e backup/anti-resurrection; `eu` non localizza Workers, OAuth e log. |
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
